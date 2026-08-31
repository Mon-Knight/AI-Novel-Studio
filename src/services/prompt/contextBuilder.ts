import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - 上下文构建器（v0.7.0 增强版）
 */
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { volumeRepository } from '../database/volumeRepository';
import { styleProfileService } from '../styles/styleProfileService';
import { buildStylePromptProjection } from '../styles/styleProfilePromptProjection';
import { outputProfileService } from '../styles/outputProfileService';
import { characterService } from '../characters/characterService';
import { chapterCharacterService } from '../characters/chapterCharacterService';
import { chapterEventService } from '../characters/chapterEventService';
import { characterStateService } from '../context/characterStateService';
import {
  getContextForChapterTask,
  buildContextPromptSection,
  type ContextReadResult,
} from './contextReaderService';
import {
  masterOutlineService,
  volumeOutlineService,
  chapterOutlineService,
} from '../outlines/outlineService';
import { chapterRepository } from '../database/chapterRepository';
import { getCachedChapterOutlineDraft } from './chapterOutlineDraftCache';
import { buildOutlineChecklistText, extractOutlineKeyPoints } from './outlineKeyPointExtractor';
import type { ChapterCharacterContext, ChapterGenerationContext } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { Character, CharacterState } from '../../types/character';
import type { OutputProfile } from '../../types/output';
import type { RuleSystem, WorldSetting } from '../../types/setting';
import type { Volume } from '../../types/volume';

function extractText(summary: string | undefined | null): string | undefined {
  return summary?.trim() || undefined;
}

function parseTimestamp(value?: string): number {
  if (!value) return NaN;
  const normalized = value.replace(/\.(\d{3})\d+/, '.$1');
  return Date.parse(normalized);
}

type WorldSettingSelectionCandidate = Pick<WorldSetting, 'content' | 'isActive'> &
  Partial<Pick<WorldSetting, 'id' | 'createdAt' | 'updatedAt'>>;

function worldSettingRecency(setting: WorldSettingSelectionCandidate): [number, number] {
  const updatedAt = parseTimestamp(setting.updatedAt);
  const createdAt = parseTimestamp(setting.createdAt);
  return [
    Number.isFinite(updatedAt) ? updatedAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY,
  ];
}

export function selectPrimaryWorldSettingForWriter<T extends WorldSettingSelectionCandidate>(
  worldSettings: readonly T[],
): T | undefined {
  return worldSettings
    .filter((setting) => setting.isActive && extractText(setting.content))
    .reduce<T | undefined>((selected, candidate) => {
      if (!selected) return candidate;
      const [candidateUpdatedAt, candidateCreatedAt] = worldSettingRecency(candidate);
      const [selectedUpdatedAt, selectedCreatedAt] = worldSettingRecency(selected);
      if (candidateUpdatedAt !== selectedUpdatedAt) {
        return candidateUpdatedAt > selectedUpdatedAt ? candidate : selected;
      }
      if (candidateCreatedAt !== selectedCreatedAt) {
        return candidateCreatedAt > selectedCreatedAt ? candidate : selected;
      }
      return candidate.id && selected.id && candidate.id.localeCompare(selected.id) > 0
        ? candidate
        : selected;
    }, undefined);
}

export function resolveWorldBackgroundForWriter(
  worldSettings: readonly WorldSettingSelectionCandidate[],
  legacyWorldBackground?: string | null,
): string | undefined {
  const activeWorld = selectPrimaryWorldSettingForWriter(worldSettings);
  return extractText(activeWorld?.content) || extractText(legacyWorldBackground);
}

function ruleForbiddenItems(value?: string): string[] {
  const normalized = value?.trim();
  if (!normalized) return [];
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
  } catch {
    // Legacy records may store a plain-text rule instead of JSON.
  }
  return [normalized];
}

export function formatRuleSystemForWriter(
  rule: Pick<RuleSystem, 'title' | 'content' | 'forbiddenRules'>,
): string {
  const title = rule.title.trim();
  const content = rule.content.trim();
  const sections = [`【${title || '未命名规则'}】${content}`];
  const forbidden = ruleForbiddenItems(rule.forbiddenRules);
  if (forbidden.length > 0) {
    sections.push(`禁止规则：\n${forbidden.map((item) => `- ${item}`).join('\n')}`);
  }
  return sections.join('\n');
}

function isSameOrNewer(left?: string, right?: string): boolean {
  const leftTime = parseTimestamp(left);
  const rightTime = parseTimestamp(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime >= rightTime;
}

export type CoreContextSource =
  'chapter' | 'novel' | 'world_setting' | 'rule_system' | 'protagonist' | 'chapter_outline';

export interface CoreContextSourceReadError extends Error {
  code: 'GENERATION_CORE_SOURCE_READ_FAILED';
  source: CoreContextSource;
}

export async function loadCoreContextSource<T>(
  source: CoreContextSource,
  label: string,
  loader: () => Promise<T>,
): Promise<T> {
  try {
    return await loader();
  } catch (cause) {
    const error = new Error(`无法读取${label}，已停止生成。`) as CoreContextSourceReadError & {
      cause?: unknown;
    };
    error.code = 'GENERATION_CORE_SOURCE_READ_FAILED';
    error.source = source;
    error.cause = cause;
    throw error;
  }
}

async function safeLoad<T>(
  loader: Promise<T>,
  fallback: T,
  onFailure?: (error: unknown) => void,
): Promise<T> {
  try {
    return await loader;
  } catch (error) {
    onFailure?.(error);
    return fallback;
  }
}

export interface ChapterProtagonistRequirementCandidate {
  name: string;
  goal?: string;
  isPrimary?: boolean;
}

export interface ChapterProtagonistContextSource extends ChapterProtagonistRequirementCandidate {
  characterId: string;
  identity?: string;
  faction?: string;
  personality?: string;
  behaviorLimits?: string;
  forbiddenBehaviors?: string;
}

function normalizeRequirementText(value?: string): string {
  return (value ?? '').replace(/[\s，。；、！？,.!?;:："'“”‘’（）()《》【】]+/gu, '');
}

function protagonistGoalMatchesChapter(goal: string | undefined, chapterText: string): boolean {
  const normalizedGoal = normalizeRequirementText(goal);
  if (normalizedGoal.length >= 4 && chapterText.includes(normalizedGoal)) return true;
  return (goal ?? '')
    .split(/[\s，。；、！？,.!?;:：]+/u)
    .map(normalizeRequirementText)
    .some((fragment) => fragment.length >= 4 && chapterText.includes(fragment));
}

export function inferRequiredProtagonistNames(input: {
  chapterTitle?: string;
  chapterOutline?: string;
  chapterGoal?: string;
  protagonists: readonly ChapterProtagonistRequirementCandidate[];
}): string[] {
  const protagonists = [
    ...new Map(
      input.protagonists
        .filter((candidate) => candidate.name.trim())
        .map((candidate) => [candidate.name.trim(), candidate]),
    ).values(),
  ];
  if (protagonists.length === 0) return [];
  const rawChapterText = [input.chapterTitle, input.chapterOutline, input.chapterGoal]
    .filter(Boolean)
    .join('\n');
  const chapterText = normalizeRequirementText(rawChapterText);
  if (!chapterText) return [];

  const matched = protagonists.filter((candidate) => {
    const name = normalizeRequirementText(candidate.name);
    return (
      (name.length >= 2 && chapterText.includes(name)) ||
      protagonistGoalMatchesChapter(candidate.goal, chapterText)
    );
  });
  if (matched.length > 0) return matched.map((candidate) => candidate.name.trim());

  const mentionsDualProtagonists = /(?:双主角|两位主角|二位主角)/u.test(rawChapterText);
  if (mentionsDualProtagonists) return protagonists.map((candidate) => candidate.name.trim());
  if (!/(?:主角|主人公|protagonist)/iu.test(rawChapterText)) return [];
  if (protagonists.length === 1) return [protagonists[0].name.trim()];
  const primary = protagonists.filter((candidate) => candidate.isPrimary);
  return primary.length > 0 ? primary.map((candidate) => candidate.name.trim()) : [];
}

export function reconcileChapterProtagonistRequirements(input: {
  novelId: string;
  chapterId: string;
  contexts: readonly ChapterCharacterContext[];
  protagonists: readonly ChapterProtagonistContextSource[];
  requiredNames: ReadonlySet<string>;
}): ChapterCharacterContext[] {
  const contexts = input.contexts.map((item) =>
    item.isProtagonist && input.requiredNames.has(item.name)
      ? {
          ...item,
          roleInChapter: 'main',
          mustAppear: true,
          note: '章纲、章节目标或主角目标要求该主角直接行动（旧绑定读取修正）',
        }
      : { ...item },
  );
  for (const source of input.protagonists) {
    if (
      !input.requiredNames.has(source.name) ||
      contexts.some((item) => item.name === source.name)
    ) {
      continue;
    }
    contexts.push({
      id: `inferred:${input.chapterId}:${source.characterId}`,
      novelId: input.novelId,
      chapterId: input.chapterId,
      characterId: source.characterId,
      name: source.name,
      roleInChapter: 'main',
      roleType: 'protagonist',
      identity: source.identity,
      faction: source.faction,
      goal: source.goal,
      personality: source.personality,
      behaviorLimits: source.behaviorLimits,
      forbiddenBehaviors: source.forbiddenBehaviors,
      note: '根据章纲、章节目标或主角目标推断的直接出场要求',
      mustAppear: true,
      isProtagonist: true,
    });
  }
  return contexts;
}

export function isLegacyConservativeProtagonistBinding(item: ChapterCharacterContext): boolean {
  return (
    Boolean(item.isProtagonist) &&
    item.roleInChapter === 'hidden' &&
    !item.mustAppear &&
    item.note?.includes('章纲未明确直接出场；仅保留幕后关联') === true
  );
}

export function hasContextPromptMaterial(
  result: Pick<ContextReadResult, 'chapterSummaries' | 'volumeContexts' | 'manualContexts'>,
): boolean {
  return (
    result.chapterSummaries.length > 0 ||
    result.volumeContexts.length > 0 ||
    result.manualContexts.length > 0
  );
}

function orderChaptersForStateContinuity(chapters: Chapter[], volumes: Volume[]): Chapter[] {
  const volumeOrder = new Map(volumes.map((volume) => [volume.id, volume.orderIndex]));
  return [...chapters].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      left.orderIndex - right.orderIndex ||
      left.chapterNumber - right.chapterNumber ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function latestStateBeforeChapter(
  states: CharacterState[],
  previousChapterIds: ReadonlySet<string>,
): CharacterState | undefined {
  return states.find((state) => !state.chapterId || previousChapterIds.has(state.chapterId));
}

function formatCharacterState(character: Character, state: CharacterState): string {
  const parts = [`- ${character.name}`, `  当前状态：${state.stateSummary}`];
  if (state.location) parts.push(`  所在位置：${state.location}`);
  if (state.healthState) parts.push(`  身体状态：${state.healthState}`);
  if (state.knowledgeState) parts.push(`  已知信息：${state.knowledgeState}`);
  if (state.relationshipChanges) parts.push(`  关系变化：${state.relationshipChanges}`);
  if (state.goalChanges) parts.push(`  目标变化：${state.goalChanges}`);
  return parts.join('\n');
}

export function buildCharacterStatePromptContext(input: {
  histories: Array<{ character: Character; states: CharacterState[] }>;
  chapters: Chapter[];
  volumes: Volume[];
  currentChapterId: string;
}): {
  summary?: string;
  sources: NonNullable<ChapterGenerationContext['characterStateSources']>;
} {
  const orderedChapters = orderChaptersForStateContinuity(input.chapters, input.volumes);
  const currentChapterIndex = orderedChapters.findIndex(
    (chapter) => chapter.id === input.currentChapterId,
  );
  const previousChapterIds = new Set(
    currentChapterIndex > 0
      ? orderedChapters.slice(0, currentChapterIndex).map((chapter) => chapter.id)
      : [],
  );
  const sources: NonNullable<ChapterGenerationContext['characterStateSources']> = [];
  const sections: string[] = [];
  for (const { character, states } of input.histories) {
    const state = latestStateBeforeChapter(states, previousChapterIds);
    if (state) {
      sections.push(formatCharacterState(character, state));
      sources.push({
        id: state.id,
        characterId: character.id,
        characterName: character.name,
        chapterId: state.chapterId,
        origin: 'character_state',
      });
      continue;
    }
    const currentState = states.length === 0 ? extractText(character.currentState) : undefined;
    if (!currentState) continue;
    sections.push(`- ${character.name}\n  当前状态：${currentState}`);
    sources.push({
      id: character.id,
      characterId: character.id,
      characterName: character.name,
      origin: 'character_current_state',
    });
  }
  return { summary: sections.join('\n') || undefined, sources };
}

function roleLabel(roleInChapter?: string, roleType?: string, isProtagonist?: boolean): string {
  if (isProtagonist || roleType === 'protagonist') {
    if (roleInChapter === 'mentioned') return '主角（仅提及）';
    if (roleInChapter === 'hidden') return '主角（幕后影响）';
    return '主角';
  }
  if (roleInChapter === 'main') return '主要出场';
  if (roleInChapter === 'supporting') return '辅助出场';
  if (roleInChapter === 'mentioned') return '仅提及';
  if (roleInChapter === 'hidden') return '幕后影响';
  if (roleType === 'antagonist') return '反派';
  if (roleType === 'neutral') return '中立';
  return roleInChapter || roleType || '配角';
}

function buildChapterCharacterSummary(characters: ChapterCharacterContext[]): string | undefined {
  if (characters.length === 0) return undefined;
  return characters
    .map((item, index) => {
      const parts = [
        `${index + 1}. ${item.name}`,
        `- 角色定位：${roleLabel(item.roleInChapter, item.roleType, item.isProtagonist)}`,
        `- 本章要求：${
          item.mustAppear
            ? '必须直接出场'
            : item.roleInChapter === 'mentioned'
              ? '仅提及，不要求直接出场'
              : item.roleInChapter === 'hidden'
                ? '仅作幕后影响，不要求直接出场'
                : '可出场，不设硬性要求'
        }`,
      ];
      if (item.identity) parts.push(`- 身份/背景：${item.identity}`);
      if (item.faction) parts.push(`- 所属阵营：${item.faction}`);
      if (item.personality) parts.push(`- 性格：${item.personality}`);
      if (item.goal) parts.push(`- 目标：${item.goal}`);
      if (item.behaviorLimits) parts.push(`- 行为限制：${item.behaviorLimits}`);
      if (item.forbiddenBehaviors) parts.push(`- 禁止行为：${item.forbiddenBehaviors}`);
      if (item.note) parts.push(`- 本章备注：${item.note}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function buildRequiredCharactersSummary(characters: ChapterCharacterContext[]): string | undefined {
  if (characters.length === 0) return undefined;
  return characters
    .map((item) => `- ${item.name}：必须在正文中直接出现，并参与本章剧情`)
    .join('\n');
}

export async function buildFreshChapterGenerationContext(params: {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  userInstruction?: string;
  styleId?: string;
  outputId?: string;
  targetWordCount?: number;
  draftContent?: string;
}): Promise<ChapterGenerationContext> {
  const freshChapter = await loadCoreContextSource('chapter', '当前章节', () =>
    chapterRepository.getById(params.chapterId),
  );
  if (!freshChapter) {
    throw new Error('无法读取当前章节最新配置，生成已停止。');
  }
  const effectiveChapter: Chapter = {
    ...freshChapter,
    volumeId: freshChapter.volumeId || params.volumeId,
    targetWordCount:
      params.targetWordCount && params.targetWordCount > 0
        ? params.targetWordCount
        : freshChapter.targetWordCount,
  };
  return buildChapterContext(
    params.novelId,
    effectiveChapter,
    params.userInstruction,
    params.styleId,
    params.outputId,
    params.draftContent,
  );
}

export async function buildChapterContext(
  novelId: string,
  chapter: Chapter,
  userInstruction?: string,
  styleId?: string,
  outputId?: string,
  draftContent?: string,
): Promise<ChapterGenerationContext> {
  const contextWarnings = new Set<string>();
  const optionalReadFailed = (label: string) => () => {
    contextWarnings.add(`${label}读取失败，本轮已按无可用来源降级。`);
  };
  const [novel, worldSettings, ruleSystems, protagonist, allCharacters, allChapters, allVolumes] =
    await Promise.all([
      loadCoreContextSource('novel', '作品基础信息', () => novelRepository.getById(novelId)),
      loadCoreContextSource('world_setting', '世界设定', () =>
        settingRepository.getWorldSettings(novelId),
      ),
      loadCoreContextSource('rule_system', '规则设定', () =>
        settingRepository.getRuleSystems(novelId),
      ),
      loadCoreContextSource('protagonist', '主角设定', () =>
        protagonistRepository.getByNovelId(novelId),
      ),
      safeLoad(characterService.getByNovelId(novelId), [], optionalReadFailed('人物资料')),
      safeLoad(chapterRepository.getByNovelId(novelId), [], optionalReadFailed('卷章顺序')),
      safeLoad(volumeRepository.getByNovelId(novelId), [], optionalReadFailed('分卷资料')),
    ]);

  const [activeMasterOutline, activeVolumeOutline, activeChapterOutline] = await Promise.all([
    safeLoad(masterOutlineService.getActive(novelId), null, optionalReadFailed('全书大纲')),
    chapter.volumeId
      ? safeLoad(
          volumeOutlineService.getActive(novelId, chapter.volumeId),
          null,
          optionalReadFailed('分卷大纲'),
        )
      : Promise.resolve(null),
    chapter.id
      ? loadCoreContextSource('chapter_outline', '当前章节大纲', () =>
          chapterOutlineService.getActive(novelId, chapter.id),
        )
      : Promise.resolve(null),
  ]);

  const activeSettings = worldSettings.filter((setting) => setting.isActive);
  const activeWorld = selectPrimaryWorldSettingForWriter(worldSettings);
  const worldBackground = resolveWorldBackgroundForWriter(worldSettings, novel?.worldBackground);
  const activeRules = ruleSystems.filter((r) => r.isActive);

  // 正文生成优先使用“当前采用”的总纲/分卷大纲/章节大纲，字段草稿只作为降级来源。
  const activeMasterOutlineText = extractText(activeMasterOutline?.content);
  const novelFieldOutline = extractText(novel?.outline);
  const novelDescription = extractText(novel?.description);
  const novelOutline = activeMasterOutlineText || novelFieldOutline || novelDescription;
  const masterOutlineSource: ChapterGenerationContext['masterOutlineSource'] =
    activeMasterOutlineText
      ? 'active_outline'
      : novelFieldOutline
        ? 'novel_field'
        : novelDescription
          ? 'novel_description'
          : 'none';

  let volumeTitle: string | undefined;
  let volumeOutline: string | undefined;
  let volumeGoal: string | undefined;
  let volumeConflict: string | undefined;

  if (chapter.volumeId) {
    const volume = await safeLoad(
      volumeRepository.getById(chapter.volumeId),
      null,
      optionalReadFailed('当前分卷'),
    );
    if (volume) {
      volumeTitle = volume.title;
      volumeGoal = extractText(volume.goal);
      volumeConflict = extractText(volume.mainConflict);
      const activeVolumeOutlineText = extractText(activeVolumeOutline?.content);
      // v1.0.25 分卷大纲（优先当前采用分卷大纲，降级从 summary 和 goal 组合）
      volumeOutline =
        activeVolumeOutlineText ||
        [volume.summary, volume.goal].filter(Boolean).join('\n').trim() ||
        undefined;
    }
  }
  const volumeOutlineSource: ChapterGenerationContext['volumeOutlineSource'] = extractText(
    activeVolumeOutline?.content,
  )
    ? 'active_outline'
    : volumeOutline
      ? 'volume_field'
      : 'none';
  const cachedChapterOutlineDraft = chapter.id ? getCachedChapterOutlineDraft(chapter.id) : null;
  const cachedChapterOutlineText =
    cachedChapterOutlineDraft !== null ? extractText(cachedChapterOutlineDraft) : undefined;
  const activeChapterOutlineText = extractText(activeChapterOutline?.content);
  const chapterFieldOutlineText = extractText(chapter.outline);
  const shouldPreferChapterFieldOutline =
    !!chapterFieldOutlineText &&
    (!activeChapterOutlineText ||
      (chapterFieldOutlineText !== activeChapterOutlineText &&
        isSameOrNewer(chapter.updatedAt, activeChapterOutline?.updatedAt)));
  const chapterOutline =
    cachedChapterOutlineDraft !== null
      ? cachedChapterOutlineText
      : shouldPreferChapterFieldOutline
        ? chapterFieldOutlineText
        : activeChapterOutlineText || chapterFieldOutlineText;
  const resolvedChapterOutlineSource: ChapterGenerationContext['chapterOutlineSource'] =
    cachedChapterOutlineDraft !== null
      ? 'draft'
      : shouldPreferChapterFieldOutline
        ? 'chapter_field'
        : activeChapterOutlineText
          ? 'active_chapter_outline'
          : chapterFieldOutlineText
            ? 'chapter_field'
            : 'empty';
  const outlineKeyPoints = extractOutlineKeyPoints(chapterOutline || '');
  const outlineChecklistText = buildOutlineChecklistText(outlineKeyPoints, chapterOutline);

  const protagonistSourcesByName = new Map<string, ChapterProtagonistContextSource>();
  const formalProtagonists = allCharacters.filter(
    (character) =>
      character.isActive !== false &&
      (character.isProtagonist || character.roleType === 'protagonist'),
  );
  for (const character of formalProtagonists) {
    protagonistSourcesByName.set(character.name, {
      characterId: character.id,
      name: character.name,
      goal: character.goal,
      identity: character.identity,
      faction: character.faction,
      personality: character.personality,
      behaviorLimits: character.behaviorLimits,
      forbiddenBehaviors: character.forbiddenBehaviors,
      isPrimary:
        character.protagonistKey === 'primary' ||
        character.protagonistLabel === '主角' ||
        (formalProtagonists.length === 1 && character.protagonistOrder === 0),
    });
  }
  for (const profile of novel?.protagonists ?? []) {
    const name = profile.name.trim();
    if (!name) continue;
    const existing = protagonistSourcesByName.get(name);
    protagonistSourcesByName.set(name, {
      characterId: existing?.characterId || profile.id,
      name,
      goal: existing?.goal || profile.goal,
      identity: existing?.identity || profile.identity,
      faction: existing?.faction,
      personality: existing?.personality || profile.personality,
      behaviorLimits: existing?.behaviorLimits || profile.abilityLimits || profile.limitation,
      forbiddenBehaviors: existing?.forbiddenBehaviors || profile.forbiddenBehaviors,
      isPrimary: existing?.isPrimary || profile.label === 'primary',
    });
  }
  if (protagonist?.name.trim()) {
    const name = protagonist.name.trim();
    const existing = protagonistSourcesByName.get(name);
    protagonistSourcesByName.set(name, {
      characterId: existing?.characterId || protagonist.id,
      name,
      goal: existing?.goal || protagonist.goal,
      identity: existing?.identity || protagonist.identity,
      faction: existing?.faction,
      personality: existing?.personality || protagonist.personality,
      behaviorLimits: existing?.behaviorLimits || protagonist.abilityLimits,
      forbiddenBehaviors: existing?.forbiddenBehaviors || protagonist.forbiddenBehaviors,
      isPrimary: existing?.isPrimary ?? true,
    });
  }
  const protagonistSources = [...protagonistSourcesByName.values()];
  const inferredRequiredProtagonistNames = new Set(
    inferRequiredProtagonistNames({
      chapterTitle: chapter.title,
      chapterOutline,
      chapterGoal: extractText(chapter.goal),
      protagonists: protagonistSources,
    }),
  );

  // 加载风格和输出控制方案
  let styleProfileSummary: string | undefined;
  let resolvedOutputProfile: OutputProfile | null = null;
  if (styleId || outputId) {
    const [styles, outputs] = await Promise.all([
      styleId
        ? safeLoad(styleProfileService.getById(styleId), null, optionalReadFailed('风格方案'))
        : Promise.resolve(null),
      outputId
        ? safeLoad(outputProfileService.getById(outputId), null, optionalReadFailed('输出方案'))
        : Promise.resolve(null),
    ]);
    if (styles) styleProfileSummary = buildStylePromptProjection(styles);
    if (outputs) resolvedOutputProfile = outputs;
  }

  // 主世界设定已经单独进入 worldBackground；其余活动设定作为有预算的补充约束。
  const supplementalWorldSettings = activeSettings
    .filter((setting) => setting.id !== activeWorld?.id && extractText(setting.content))
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    )
    .slice(0, 6);
  const chapterSettingsSummary =
    supplementalWorldSettings.length > 0
      ? supplementalWorldSettings
          .map((setting) => `- ${setting.title}：${setting.content?.slice(0, 600)}`)
          .join('\n')
      : undefined;

  // v0.7.0 加载本章出场角色和事件
  let chapterCharacterSummary: string | undefined;
  let requiredCharactersSummary: string | undefined;
  let requiredCharacterNames: string | undefined;
  let chapterEventSummary: string | undefined;
  let protagonistMustAppear = false;
  let chapterCharacterContexts: ChapterCharacterContext[] = [];
  let requiredCharacterContexts: ChapterCharacterContext[] = [];
  const protagonistsInChapterNames: string[] = [];
  const protagonistsReferencedNames: string[] = [];
  const protagonistsNotInChapterNames: string[] = [];
  const protagonistsWithLegacyUnresolvedBindingNames: string[] = [];
  if (chapter.id) {
    const [chapterChars, chapterEvents] = await Promise.all([
      safeLoad(
        chapterCharacterService.getByChapterId(chapter.id),
        [],
        optionalReadFailed('本章角色'),
      ),
      safeLoad(chapterEventService.getByChapterId(chapter.id), [], optionalReadFailed('本章事件')),
    ]);
    chapterCharacterContexts = chapterChars.map((cc) => {
      const ch = allCharacters.find((candidate) => candidate.id === cc.characterId);
      const source = protagonistSources.find(
        (candidate) =>
          candidate.characterId === cc.characterId || candidate.name === cc.characterName,
      );
      const name = ch?.name || cc.characterName || source?.name || '未知';
      return {
        id: cc.id,
        novelId: cc.novelId,
        chapterId: cc.chapterId,
        characterId: cc.characterId,
        name,
        roleInChapter: cc.roleInChapter,
        roleType: ch?.roleType || (source ? 'protagonist' : undefined),
        identity: ch?.identity || source?.identity,
        faction: ch?.faction || source?.faction,
        goal: ch?.goal || source?.goal,
        personality: ch?.personality || source?.personality,
        behaviorLimits: ch?.behaviorLimits || source?.behaviorLimits,
        forbiddenBehaviors: ch?.forbiddenBehaviors || source?.forbiddenBehaviors,
        note: cc.note,
        mustAppear: cc.mustAppear,
        isProtagonist: Boolean(ch?.isProtagonist || ch?.roleType === 'protagonist' || source),
      };
    });

    chapterCharacterContexts = reconcileChapterProtagonistRequirements({
      novelId,
      chapterId: chapter.id,
      contexts: chapterCharacterContexts,
      protagonists: protagonistSources,
      requiredNames: inferredRequiredProtagonistNames,
    });

    requiredCharacterContexts = chapterCharacterContexts.filter((item) => item.mustAppear);
    if (chapterCharacterContexts.length > 0 && requiredCharacterContexts.length === 0) {
      // 兼容旧数据：只把旧式直接出场关系提升为必出场；仅提及/幕后影响保持非强制。
      chapterCharacterContexts = chapterCharacterContexts.map((item) => ({
        ...item,
        mustAppear:
          item.roleInChapter === 'main' || item.roleInChapter === 'supporting'
            ? true
            : item.mustAppear,
      }));
      requiredCharacterContexts = chapterCharacterContexts.filter((item) => item.mustAppear);
    }
    for (const item of chapterCharacterContexts.filter((candidate) => candidate.isProtagonist)) {
      if (isLegacyConservativeProtagonistBinding(item)) {
        protagonistsWithLegacyUnresolvedBindingNames.push(item.name);
        continue;
      }
      const target =
        item.roleInChapter === 'mentioned' || item.roleInChapter === 'hidden'
          ? protagonistsReferencedNames
          : protagonistsInChapterNames;
      if (!target.includes(item.name)) target.push(item.name);
    }
    for (const source of protagonistSources) {
      if (
        chapterChars.length > 0 &&
        !protagonistsInChapterNames.includes(source.name) &&
        !protagonistsReferencedNames.includes(source.name) &&
        !protagonistsWithLegacyUnresolvedBindingNames.includes(source.name)
      ) {
        protagonistsNotInChapterNames.push(source.name);
      }
    }
    protagonistMustAppear = requiredCharacterContexts.some((item) => item.isProtagonist);
    chapterCharacterSummary = buildChapterCharacterSummary(chapterCharacterContexts);
    requiredCharactersSummary = buildRequiredCharactersSummary(requiredCharacterContexts);
    requiredCharacterNames =
      requiredCharacterContexts
        .map((item) => item.name)
        .filter(Boolean)
        .join('、') || undefined;
    if (chapterEvents.length > 0) {
      chapterEventSummary = chapterEvents
        .filter((e) => e.status !== 'forbidden' && e.status !== 'discarded')
        .map((e) => {
          const statusTag =
            e.status === 'required'
              ? '【必须发生！】'
              : e.status === 'selected'
                ? '【已选择】'
                : '';
          const parts = [`- ${statusTag}${e.title}：${e.description}`];
          if (e.impact) parts.push(`  影响：${e.impact}`);
          if (e.risk) parts.push(`  风险：${e.risk}`);
          return parts.join('\n');
        })
        .join('\n');
    }
  }

  const relevantCharacters = [
    ...chapterCharacterContexts.flatMap((item) => {
      const character = allCharacters.find((candidate) => candidate.id === item.characterId);
      return character ? [character] : [];
    }),
    ...allCharacters.filter(
      (character) => character.isProtagonist || character.roleType === 'protagonist',
    ),
  ].filter(
    (character, index, characters) =>
      characters.findIndex((candidate) => candidate.id === character.id) === index,
  );
  const characterStateHistories = await Promise.all(
    relevantCharacters.map(async (character) => ({
      character,
      states: await safeLoad(
        characterStateService.getByCharacterId(character.id),
        [],
        optionalReadFailed('人物动态状态'),
      ),
    })),
  );
  const characterStateContext = buildCharacterStatePromptContext({
    histories: characterStateHistories,
    chapters: allChapters,
    volumes: allVolumes,
    currentChapterId: chapter.id,
  });

  // v1.7.15 使用统一上下文读取服务，分区注入 Prompt
  let previousContext: string | undefined;
  let worldStateTimeline: ChapterGenerationContext['worldStateTimeline'];
  let worldStateTimelineSource: ChapterGenerationContext['worldStateTimelineSource'];
  try {
    const contextResult = await getContextForChapterTask({
      novelId,
      chapterId: chapter.id,
      volumeId: chapter.volumeId,
      taskType: 'chapter_generate',
    });
    if (hasContextPromptMaterial(contextResult)) {
      previousContext = buildContextPromptSection(contextResult);
    }
    if (contextResult.worldStateTimeline) {
      worldStateTimeline = contextResult.worldStateTimeline.content;
      worldStateTimelineSource = {
        latestChapterId: contextResult.worldStateTimeline.latestChapterId,
        chapterCount: contextResult.worldStateTimeline.chapterCount,
        sourceSummaryIds: contextResult.worldStateTimeline.sourceSummaryIds,
        sourceContextRecordIds: contextResult.worldStateTimeline.sourceContextRecordIds,
      };
    }
  } catch {
    contextWarnings.add('正式上下文与世界状态读取失败，本轮已按无可用来源降级。');
  }

  // v1.0.28 构建主角信息摘要
  const protagonistMode = novel?.protagonistMode || 'single';
  let protagonistsSummary: string | undefined;
  let dualProtagonistSummary: string | undefined;
  let protagonistNames: string | undefined;
  const prots = novel?.protagonists?.filter((profile) => profile.name.trim().length > 0);
  if (prots && prots.length > 0) {
    protagonistsSummary = prots
      .map((p) => {
        const parts = [`- ${p.label === 'primary' ? '主角A' : '主角B'}：${p.name}`];
        if (p.identity) parts.push(`  身份：${p.identity}`);
        if (p.personality) parts.push(`  性格：${p.personality}`);
        if (p.goal) parts.push(`  目标：${p.goal}`);
        if (p.motivation) parts.push(`  动机：${p.motivation}`);
        if (p.specialAbility) parts.push(`  特殊能力：${p.specialAbility}`);
        if (p.abilityLimits) parts.push(`  能力限制：${p.abilityLimits}`);
        if (p.forbiddenBehaviors) parts.push(`  禁止行为：${p.forbiddenBehaviors}`);
        if (p.background) parts.push(`  背景：${p.background}`);
        if (p.arc) parts.push(`  人物成长线：${p.arc}`);
        return parts.join('\n');
      })
      .join('\n\n');
    // v1.0.36: 提取主角名用于硬性约束
    protagonistNames = prots
      .map((p) => p.name)
      .filter(Boolean)
      .join('、');
  }
  if (!protagonistNames && protagonist?.name) {
    protagonistNames = protagonist.name;
  }
  if (!protagonistsSummary && protagonist?.name) {
    const parts = [`- 主角：${protagonist.name}`];
    if (protagonist.identity) parts.push(`  身份：${protagonist.identity}`);
    if (protagonist.personality) parts.push(`  性格：${protagonist.personality}`);
    if (protagonist.goal) parts.push(`  目标：${protagonist.goal}`);
    if (protagonist.specialAbility) parts.push(`  特殊能力：${protagonist.specialAbility}`);
    if (protagonist.abilityLimits) parts.push(`  能力限制：${protagonist.abilityLimits}`);
    if (protagonist.forbiddenBehaviors) parts.push(`  禁止行为：${protagonist.forbiddenBehaviors}`);
    protagonistsSummary = parts.join('\n');
  }
  const protagonistAppearance = protagonistNames
    ? (() => {
        const parts: string[] = [];
        if (protagonistsInChapterNames.length > 0) {
          parts.push(`本章出场主角：${protagonistsInChapterNames.join('、')}。`);
          if (protagonistMustAppear) {
            parts.push('至少有一位主角必须直接出场并推动本章目标。');
          }
        }
        if (protagonistsReferencedNames.length > 0) {
          parts.push(
            `本章仅提及或幕后影响主角：${protagonistsReferencedNames.join('、')}，不要强制其直接出场。`,
          );
        }
        if (protagonistsWithLegacyUnresolvedBindingNames.length > 0) {
          parts.push(
            `旧版自动关系不足以判断主角是否直接出场：${protagonistsWithLegacyUnresolvedBindingNames.join('、')}；请以章节大纲和章节目标为准。`,
          );
        }
        if (protagonistsNotInChapterNames.length > 0) {
          parts.push(
            `本章不直接出场主角：${protagonistsNotInChapterNames.join('、')}（不直接出场，但其影响/绑定关系/未来伏笔仍可作为隐性推动）。`,
          );
        }
        if (parts.length === 0) {
          parts.push(
            '本章尚无明确的主角出场关系；请以章节大纲和章节目标为准，不额外新增或排除主角行动。',
          );
        }
        return parts.join(' ');
      })()
    : undefined;
  if (novel?.dualProtagonistRelation?.description) {
    const rel = novel.dualProtagonistRelation;
    const relParts: string[] = [];
    relParts.push(`关系类型：${rel.type}`);
    relParts.push(`关系说明：${rel.description}`);
    if (rel.conflict) relParts.push(`核心冲突：${rel.conflict}`);
    if (rel.cooperation) relParts.push(`合作方式：${rel.cooperation}`);
    if (rel.emotionalProgression) relParts.push(`关系推进：${rel.emotionalProgression}`);
    if (rel.narrativeWeight)
      relParts.push(
        `叙事权重：${rel.narrativeWeight === 'balanced' ? '双主角均衡' : rel.narrativeWeight === 'primary_main' ? '主角A更核心' : '主角B更核心'}`,
      );
    dualProtagonistSummary = relParts.join('\n');
  }

  const outputProfileContext = buildOutputProfileContextForWriter(
    resolvedOutputProfile,
    chapter.targetWordCount,
  );

  const generationContext: ChapterGenerationContext = {
    novelTitle: novel?.title || '',
    novelGenre: novel?.genre,
    novelDescription: extractText(novel?.description),
    novelOutline,
    masterOutline: novelOutline,
    worldBackground,
    worldSettingSources: [
      ...(activeWorld
        ? [
            {
              id: activeWorld.id,
              title: activeWorld.title,
              role: 'primary' as const,
              updatedAt: activeWorld.updatedAt,
            },
          ]
        : []),
      ...supplementalWorldSettings.map((setting) => ({
        id: setting.id,
        title: setting.title,
        role: 'supplemental' as const,
        updatedAt: setting.updatedAt,
      })),
    ],
    ruleSystems:
      activeRules.length > 0 ? activeRules.map(formatRuleSystemForWriter).join('\n\n') : undefined,
    protagonist: protagonist?.name || prots?.[0]?.name,
    specialAbility: extractText(protagonist?.specialAbility) || prots?.[0]?.specialAbility,
    abilityLimits: extractText(protagonist?.abilityLimits) || prots?.[0]?.abilityLimits,
    forbiddenBehaviors:
      extractText(protagonist?.forbiddenBehaviors) || prots?.[0]?.forbiddenBehaviors,
    protagonistMode,
    protagonistsSummary,
    dualProtagonistSummary,
    protagonistNames,
    protagonistAppearance,
    protagonistMustAppear,
    volumeTitle,
    volumeOutline,
    volumeGoal,
    volumeConflict,
    chapterTitle: `${chapter.title}`,
    chapterOutline,
    outlineKeyPoints,
    outlineChecklistText,
    chapterGoal: extractText(chapter.goal),
    targetWordCount: outputProfileContext.targetWordCount,
    styleProfile: styleProfileSummary,
    outputProfile: outputProfileContext.outputProfile,
    chapterCharacters: chapterCharacterSummary,
    chapterCharacterList: chapterCharacterContexts,
    requiredCharacters: requiredCharacterContexts,
    requiredCharactersSummary,
    requiredCharacterNames,
    characterStates: characterStateContext.summary,
    characterStateSources: characterStateContext.sources,
    chapterEvents: chapterEventSummary,
    chapterSettings: chapterSettingsSummary,
    worldStateTimeline,
    worldStateTimelineSource,
    previousContext,
    userInstruction: extractText(userInstruction),
    draftContent: extractText(draftContent),
    chapterOutlineSource: resolvedChapterOutlineSource,
    volumeOutlineSource,
    masterOutlineSource,
    contextWarnings: [...contextWarnings],
  };

  if (import.meta.env?.DEV) {
    appLogger.info('[ContextBuilder] context compiled', {
      chapterId: chapter.id,
      chapterTitleLength: chapter.title.length,
      chapterOutlineSource: resolvedChapterOutlineSource,
      chapterOutlineLength: chapterOutline?.length || 0,
      outlineKeyPointCount: outlineKeyPoints.length,
    });
  }

  return generationContext;
}

const PARAGRAPH_LENGTH_LABELS: Record<OutputProfile['paragraphLength'], string> = {
  short: '短段落',
  medium: '中等段落',
  long: '长段落',
};

const POV_TYPE_LABELS: Record<OutputProfile['povType'], string> = {
  first_person: '第一人称',
  third_person_limited: '第三人称限知',
  third_person_omniscient: '第三人称全知',
};

const TENSE_TYPE_LABELS: Record<OutputProfile['tenseType'], string> = {
  past: '过去时',
  present: '现在时',
};

const LEVEL_LABELS = {
  low: '低',
  medium: '中等',
  high: '高',
  slow: '慢',
  fast: '快',
} as const;

function positiveWordCount(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

function formatRatio(value: number): string {
  const percentage = Math.round(value * 10_000) / 100;
  return `${percentage}%`;
}

function buildOutputSummary(
  profile: OutputProfile,
  targetWordCount: number,
  chapterTargetOverridesProfile: boolean,
): string {
  const minWordCount =
    positiveWordCount(profile.minWordCount) ?? positiveWordCount(profile.chapterWordRange?.min);
  const maxWordCount =
    positiveWordCount(profile.maxWordCount) ?? positiveWordCount(profile.chapterWordRange?.max);
  const rangeQualifier = chapterTargetOverridesProfile
    ? '（输出方案参考值；与本章目标冲突时不作为硬限制）'
    : '';
  const parts = [
    `方案名称：${profile.name}`,
    profile.description?.trim() ? `方案说明：${profile.description.trim()}` : '',
    `本章生效目标字数：${targetWordCount} 字（必须尽量接近${
      chapterTargetOverridesProfile ? '；章节单独设置优先' : ''
    }）`,
    minWordCount ? `最少字数：${minWordCount} 字${rangeQualifier}` : '',
    maxWordCount ? `最多字数：${maxWordCount} 字${rangeQualifier}` : '',
    `段落长度：${PARAGRAPH_LENGTH_LABELS[profile.paragraphLength]}`,
    `叙事视角：${POV_TYPE_LABELS[profile.povType]}`,
    `叙事时态：${TENSE_TYPE_LABELS[profile.tenseType]}`,
    profile.paceLevel ? `节奏等级：${LEVEL_LABELS[profile.paceLevel]}` : '',
    profile.dialogueRatio !== undefined ? `对话比例：${formatRatio(profile.dialogueRatio)}` : '',
    profile.descriptionRatio !== undefined
      ? `描写比例：${formatRatio(profile.descriptionRatio)}`
      : '',
    profile.battleIntensity ? `战斗强度：${LEVEL_LABELS[profile.battleIntensity]}` : '',
    profile.emotionTendency?.trim() ? `情绪倾向：${profile.emotionTendency.trim()}` : '',
    profile.endingHookRequired ? '结尾必须有钩子' : '结尾钩子：不作硬性要求',
    profile.extraRequirements?.trim() ? `额外要求：${profile.extraRequirements.trim()}` : '',
    profile.forbiddenItems?.length ? `禁止项：${profile.forbiddenItems.join('、')}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

export function buildOutputProfileContextForWriter(
  profile: OutputProfile | null | undefined,
  chapterTargetWordCount?: number,
): Pick<ChapterGenerationContext, 'targetWordCount' | 'outputProfile'> {
  // 保持既有优先级：章节单独设置 > 输出方案目标/默认值 > 系统默认 4000。
  const profileTargetWordCount =
    positiveWordCount(profile?.targetWordCount) ??
    positiveWordCount(profile?.chapterWordRange?.default);
  const chapterTarget = positiveWordCount(chapterTargetWordCount);
  const targetWordCount = chapterTarget ?? profileTargetWordCount ?? 4000;
  return {
    targetWordCount,
    outputProfile: profile
      ? buildOutputSummary(profile, targetWordCount, chapterTarget !== undefined)
      : undefined,
  };
}
