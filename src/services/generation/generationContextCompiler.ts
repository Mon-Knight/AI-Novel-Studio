import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';
import { chapterEngineeringService } from '../engineering/chapterEngineeringService';
import { buildFreshChapterGenerationContext } from '../prompt/contextBuilder';
import { loadGenerationAssetContext, type GenerationAssetContext } from './generationAssetContext';
import { hashTextContent } from '../../utils/contentHash';
import { safeJsonParse, toSafeNumber, toSafeString } from '../../utils/dataGuard';
import type { ChapterEngineeringState } from '../../types/chapterEngineering';
import type {
  ChapterGenerationSnapshot,
  CompileGenerationContextInput,
  CompiledGenerationContext,
  GenerationContextSection,
  GenerationContextSource,
  GenerationContextSourceType,
} from '../../types/generationContext';

const STORAGE_KEY_PREFIX = 'ai_novel_studio_chapter_generation_snapshots_';
const SECTION_LIMIT = 8000;

export interface GenerationContextCompilerDependencies {
  buildBaseContext?: typeof buildFreshChapterGenerationContext;
  getEngineeringBundle?: typeof chapterEngineeringService.getBundle;
  loadAssetContext?: (novelId: string, relevanceText: string) => Promise<GenerationAssetContext>;
}

export interface GenerationCoreAssetsMissingError extends Error {
  code: 'GENERATION_CORE_ASSETS_MISSING';
  missingAssets: Array<'chapter_outline' | 'world_setting' | 'rule_system' | 'protagonist'>;
}

export function assertRequiredCoreAssets(context: CompiledGenerationContext['baseContext']): void {
  const missingAssets: GenerationCoreAssetsMissingError['missingAssets'] = [];
  if (!context.chapterOutline?.trim()) missingAssets.push('chapter_outline');
  if (!context.worldBackground?.trim() && !context.chapterSettings?.trim()) {
    missingAssets.push('world_setting');
  }
  if (!context.ruleSystems?.trim()) missingAssets.push('rule_system');
  if (!context.protagonist?.trim() && !context.protagonistNames?.trim()) {
    missingAssets.push('protagonist');
  }
  if (missingAssets.length === 0) return;
  const labels = missingAssets.map((asset) => {
    if (asset === 'chapter_outline') return '章节大纲';
    if (asset === 'world_setting') return '世界设定';
    if (asset === 'rule_system') return '规则体系';
    return '主角设定';
  });
  const error = new Error(
    `生成所需核心资产不完整：${labels.join('、')}。请先在作品资产中补齐后再生成。`,
  ) as GenerationCoreAssetsMissingError;
  error.code = 'GENERATION_CORE_ASSETS_MISSING';
  error.missingAssets = missingAssets;
  throw error;
}

export function limitContinuityText(value: string | undefined, limit = SECTION_LIMIT): string {
  const text = value?.trim() ?? '';
  if (limit <= 0) return '';
  if (!text || text.length <= limit) return text;
  const marker = `\n\n[已截断中段：原文 ${text.length} 字符]\n\n`;
  if (marker.length >= limit) return text.slice(-limit);
  const available = Math.max(0, limit - marker.length);
  const headLength = Math.floor(available / 4);
  return `${text.slice(0, headLength)}${marker}${text.slice(-(available - headLength))}`;
}

interface RawChapterGenerationSnapshot extends Partial<ChapterGenerationSnapshot> {
  novel_id?: string;
  volume_id?: string | null;
  chapter_id?: string;
  engineering_state_id?: string | null;
  style_profile_id?: string | null;
  output_profile_id?: string | null;
  compiledContextJson?: string;
  compiled_context_json?: string;
  compiled_prompt_text?: string;
  prompt_summary?: string;
  context_hash?: string;
  sourcesJson?: string;
  sources_json?: string;
  created_at?: string;
}

interface SaveSnapshotDbInput {
  id: string;
  novelId: string;
  volumeId?: string;
  chapterId: string;
  engineeringStateId?: string;
  styleProfileId?: string;
  outputProfileId?: string;
  compiledContextJson: string;
  compiledPromptText: string;
  promptSummary: string;
  contextHash: string;
  sourcesJson: string;
  createdAt: string;
}

function storageKey(chapterId: string): string {
  return `${STORAGE_KEY_PREFIX}${chapterId}`;
}

function limitText(
  value: string | undefined,
  limit = SECTION_LIMIT,
  preserveEnding = false,
): string {
  const text = value?.trim() ?? '';
  if (!text) return '';
  if (text.length <= limit) return text;
  if (preserveEnding) return limitContinuityText(text, limit);
  return `${text.slice(0, limit)}\n\n[已截断：原文 ${text.length} 字符]`;
}

function joinLines(items: Array<string | undefined | false>): string {
  return items.filter(Boolean).join('\n');
}

function formatList(items: string[] | undefined): string {
  if (!items?.length) return '';
  return items.map((item) => `- ${item}`).join('\n');
}

function addSection(
  sections: GenerationContextSection[],
  key: string,
  title: string,
  content: string | undefined,
  sourceTypes: GenerationContextSourceType[],
  preserveEnding = false,
): void {
  const normalized = limitText(content, SECTION_LIMIT, preserveEnding);
  if (!normalized) return;
  sections.push({ key, title, content: normalized, sourceTypes });
}

function source(
  type: GenerationContextSourceType,
  title: string,
  status: GenerationContextSource['status'],
  summary?: string,
  sourceId?: string,
): GenerationContextSource {
  return { type, title, status, summary, sourceId };
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function formatEngineeringState(state: ChapterEngineeringState): string {
  const card = state.chapterCard;
  const constraints = state.generationConstraints;
  const quality = state.qualityRules;
  return joinLines([
    `工程版本：v${state.draftVersion}`,
    `章节目标：${card.chapterGoal}`,
    `开场状态：${card.openingState}`,
    `结束状态：${card.endingState}`,
    `核心冲突：${card.coreConflict}`,
    card.appearingCharacters.length ? `出场角色：${card.appearingCharacters.join('、')}` : '',
    card.mustHappenEvents.length ? `必须发生：\n${formatList(card.mustHappenEvents)}` : '',
    card.forbiddenEvents.length ? `禁止发生：\n${formatList(card.forbiddenEvents)}` : '',
    card.releasedInformation.length
      ? `本章释放信息：\n${formatList(card.releasedInformation)}`
      : '',
    card.reservedMysteries.length ? `保留悬念：\n${formatList(card.reservedMysteries)}` : '',
    card.styleRequirements.length ? `文风要求：\n${formatList(card.styleRequirements)}` : '',
    card.forbiddenWriting.length ? `写法禁区：\n${formatList(card.forbiddenWriting)}` : '',
    state.scenePlan.length
      ? `场景计划：\n${state.scenePlan
          .map((scene) =>
            [
              `${scene.sceneNo}. ${scene.title}`,
              scene.location ? `地点：${scene.location}` : '',
              scene.characters.length ? `角色：${scene.characters.join('、')}` : '',
              scene.contextCapsule ? `状态胶囊：${scene.contextCapsule}` : '',
              scene.goal ? `目标：${scene.goal}` : '',
              scene.conflict ? `冲突：${scene.conflict}` : '',
              scene.keyActions.length ? `关键动作：${scene.keyActions.join('；')}` : '',
              scene.beats.length
                ? `有序节拍：\n${scene.beats
                    .map((beat) => `${beat.order}. ${beat.text}${beat.required ? '' : '（可选）'}`)
                    .join('\n')}`
                : '',
              scene.informationRelease.length
                ? `释放信息：${scene.informationRelease.join('；')}`
                : '',
              scene.result ? `结果：${scene.result}` : '',
              scene.expectedEndState ? `预期结束状态：${scene.expectedEndState}` : '',
              scene.constraints?.length ? `场景限制：${scene.constraints.join('；')}` : '',
            ]
              .filter(Boolean)
              .join(' / '),
          )
          .join('\n')}`
      : '',
    constraints.mustFollow.length ? `必须遵守：\n${formatList(constraints.mustFollow)}` : '',
    constraints.forbiddenChanges.length
      ? `不得改变：\n${formatList(constraints.forbiddenChanges)}`
      : '',
    constraints.forbiddenAdditions.length
      ? `不得新增：\n${formatList(constraints.forbiddenAdditions)}`
      : '',
    constraints.forbiddenEarlyEvents.length
      ? `不得提前发生：\n${formatList(constraints.forbiddenEarlyEvents)}`
      : '',
    constraints.forbiddenEarlyReveals.length
      ? `不得提前揭示：\n${formatList(constraints.forbiddenEarlyReveals)}`
      : '',
    constraints.bannedWords.length ? `禁用词：${constraints.bannedWords.join('、')}` : '',
    constraints.bannedSentencePatterns.length
      ? `禁用句式：${constraints.bannedSentencePatterns.join('、')}`
      : '',
    constraints.narrativePerson ? `叙事人称：${constraints.narrativePerson}` : '',
    constraints.wordRange.min || constraints.wordRange.max
      ? `字数范围：${constraints.wordRange.min ?? '?'} - ${constraints.wordRange.max ?? '?'}`
      : '',
    constraints.pacingRequirement ? `节奏要求：${constraints.pacingRequirement}` : '',
    constraints.informationReleaseMode ? `信息释放方式：${constraints.informationReleaseMode}` : '',
    `质量规则：${quality.enabledChecks.join('、') || '未启用'} / ${quality.strictness}`,
    quality.customRules.length ? `自定义质检：\n${formatList(quality.customRules)}` : '',
  ]);
}

interface ContinuityConstraintSection {
  content?: string;
  sourceTypes: GenerationContextSourceType[];
}

function buildContinuityConstraintSection(params: {
  input: CompileGenerationContextInput;
  baseContext: CompiledGenerationContext['baseContext'];
  assetContext: GenerationAssetContext;
}): ContinuityConstraintSection {
  const { input, baseContext, assetContext } = params;
  const sourceTypes: GenerationContextSourceType[] = [];
  const evidence: string[] = [];
  const addEvidence = (
    available: boolean,
    type: GenerationContextSourceType,
    description: string,
  ) => {
    if (!available) return;
    if (!sourceTypes.includes(type)) sourceTypes.push(type);
    evidence.push(`- ${description}`);
  };

  addEvidence(
    Boolean(input.adoptedPreviousChapter?.content.trim()),
    'adopted_chapter',
    '前一章已采用正文：本章开场的最高权威终态。',
  );
  addEvidence(
    Boolean(input.provisionalPreviousChapter?.content.trim()),
    'provisional_candidate',
    '前一章队列候选：仅作临时承接，不得覆盖正式采用事实。',
  );
  addEvidence(
    Boolean(baseContext.previousContext?.trim()),
    'context_record',
    'ContextRecord：补足已沉淀的事件、伏笔和跨章状态。',
  );
  addEvidence(
    Boolean(baseContext.worldStateTimeline?.trim()),
    'world_state',
    '持久化世界状态与时间线：按正式卷章顺序提供已采用章节的动态事实。',
  );
  addEvidence(
    Boolean(input.retrievedMemoryContext?.trim()),
    'memory_context',
    '长期 Memory：补足可追踪的远期人物、物件、地点和规则事实。',
  );
  addEvidence(
    Boolean(baseContext.characterStates?.trim()),
    'character_state',
    '人物动态状态：约束伤势、能力、关系和当前行动条件。',
  );
  addEvidence(
    assetContext.sources.some((item) => item.type === 'location'),
    'location',
    '正式地点资产：约束地点身份、空间关系和已确认环境规则。',
  );

  if (sourceTypes.length === 0) return { sourceTypes };

  return {
    sourceTypes,
    content: [
      '本分区只供 Writer 承接跨章状态，不要在小说正文中复述规则或输出状态清单。',
      '',
      '本轮可用连续性证据：',
      ...evidence,
      '',
      '事实优先级：前章已采用正文的明确终态 > 已确认的世界/人物/地点资产和人物动态状态 > ContextRecord 与长期 Memory > 本章大纲、工程计划和临时候选。低优先级内容不得静默改写高优先级事实；证据不确定时保留不确定性，不得擅自补成精确事实。',
      '',
      '只追踪材料中实际出现的连续性维度，不为填表补值。若已有相对时间或期限，沿用同一故事时钟与既定截止点，不因章节切换重新起算；到期后的变化必须在正文中有原因。',
      '人物移动、关键物件归属或状态、伤势、设备或系统连接状态、人物知识发生变化时，正文必须给出可见的行动、时间经过或既有规则来源。未在材料中出现的维度无需建模。',
      '',
      '输出前只做一次静默连续性核对，核对过程不得写入正文。',
    ].join('\n'),
  };
}

function buildPromptText(sections: GenerationContextSection[]): string {
  return sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n---\n\n');
}

function buildPromptSummary(
  sections: GenerationContextSection[],
  sources: GenerationContextSource[],
  warnings: string[],
): string {
  const usedCount = sources.filter((item) => item.status === 'used').length;
  const missingCount = sources.filter((item) => item.status === 'missing').length;
  const publicSections = sections.filter((section) => section.key !== 'cross_chapter_continuity');
  const titles = publicSections.map((section) => section.title).join('、');
  return [
    `已编译 ${publicSections.length} 个上下文分区：${titles || '无'}`,
    `来源：使用 ${usedCount} 项，缺失 ${missingCount} 项。`,
    warnings.length ? `警告：${warnings.join('；')}` : '警告：无。',
  ].join('\n');
}

function normalizeSnapshot(raw: unknown): ChapterGenerationSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawChapterGenerationSnapshot;
  const id = toSafeString(item.id).trim();
  const novelId = toSafeString(item.novelId ?? item.novel_id).trim();
  const chapterId = toSafeString(item.chapterId ?? item.chapter_id).trim();
  if (!id || !novelId || !chapterId) return null;
  const compiledContext =
    item.compiledContext ??
    safeJsonParse<CompiledGenerationContext | null>(
      toSafeString(item.compiledContextJson ?? item.compiled_context_json),
      null,
    );
  if (!compiledContext) return null;
  const sources =
    item.sources ??
    safeJsonParse<GenerationContextSource[]>(
      toSafeString(item.sourcesJson ?? item.sources_json),
      compiledContext.sources ?? [],
    );
  return {
    id,
    novelId,
    volumeId: toSafeString(item.volumeId ?? item.volume_id).trim() || undefined,
    chapterId,
    engineeringStateId:
      toSafeString(item.engineeringStateId ?? item.engineering_state_id).trim() || undefined,
    styleProfileId: toSafeString(item.styleProfileId ?? item.style_profile_id).trim() || undefined,
    outputProfileId:
      toSafeString(item.outputProfileId ?? item.output_profile_id).trim() || undefined,
    compiledContext,
    compiledPromptText: toSafeString(item.compiledPromptText ?? item.compiled_prompt_text),
    promptSummary: toSafeString(item.promptSummary ?? item.prompt_summary),
    contextHash: toSafeString(item.contextHash ?? item.context_hash),
    sources,
    createdAt: toSafeString(item.createdAt ?? item.created_at, nowISO()),
  };
}

function normalizeSnapshots(raw: unknown): ChapterGenerationSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeSnapshot)
    .filter((item): item is ChapterGenerationSnapshot => item !== null)
    .sort(
      (a, b) => toSafeNumber(Date.parse(b.createdAt), 0) - toSafeNumber(Date.parse(a.createdAt), 0),
    );
}

function getLocalSnapshots(chapterId: string): ChapterGenerationSnapshot[] {
  const snapshots = normalizeSnapshots(lsGet<unknown>(storageKey(chapterId)));
  lsSet(storageKey(chapterId), snapshots);
  return snapshots;
}

function saveLocalSnapshot(snapshot: ChapterGenerationSnapshot): ChapterGenerationSnapshot {
  const snapshots = getLocalSnapshots(snapshot.chapterId);
  lsSet(storageKey(snapshot.chapterId), [
    snapshot,
    ...snapshots.filter((item) => item.id !== snapshot.id),
  ]);
  return snapshot;
}

function toDbInput(snapshot: ChapterGenerationSnapshot): SaveSnapshotDbInput {
  return {
    id: snapshot.id,
    novelId: snapshot.novelId,
    volumeId: snapshot.volumeId,
    chapterId: snapshot.chapterId,
    engineeringStateId: snapshot.engineeringStateId,
    styleProfileId: snapshot.styleProfileId,
    outputProfileId: snapshot.outputProfileId,
    compiledContextJson: JSON.stringify(snapshot.compiledContext),
    compiledPromptText: snapshot.compiledPromptText,
    promptSummary: snapshot.promptSummary,
    contextHash: snapshot.contextHash,
    sourcesJson: JSON.stringify(snapshot.sources),
    createdAt: snapshot.createdAt,
  };
}

export async function compileGenerationContextSnapshot(
  input: CompileGenerationContextInput,
  deps: GenerationContextCompilerDependencies = {},
): Promise<ChapterGenerationSnapshot> {
  const buildBaseContext = deps.buildBaseContext ?? buildFreshChapterGenerationContext;
  const getEngineeringBundle =
    deps.getEngineeringBundle ??
    ((chapterId: string) => chapterEngineeringService.getBundle(chapterId));
  const loadAssetContext = deps.loadAssetContext ?? loadGenerationAssetContext;
  const baseContext = await buildBaseContext({
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    userInstruction: input.userInstruction,
    styleId: input.styleProfileId,
    outputId: input.outputProfileId,
  });
  if (input.requireCoreAssets) assertRequiredCoreAssets(baseContext);
  const engineeringBundle = await getEngineeringBundle(input.chapterId);
  const activeEngineeringState = input.engineeringStateId
    ? engineeringBundle.states.find((item) => item.id === input.engineeringStateId)
    : engineeringBundle.activeState;
  const warnings: string[] = [...(baseContext.contextWarnings ?? [])];
  if (!activeEngineeringState)
    warnings.push('未找到 active 章节工程状态，快照仅包含旧式章节上下文。');
  if (!baseContext.styleProfile) warnings.push('未解析到活动风格方案，使用模型默认文风。');
  if (!baseContext.outputProfile)
    warnings.push('未解析到默认输出方案，使用章节字数与系统默认输出控制。');

  const relevanceText = joinLines([
    baseContext.chapterOutline,
    baseContext.chapterGoal,
    baseContext.chapterEvents,
    baseContext.chapterCharacters,
    baseContext.userInstruction,
    activeEngineeringState ? formatEngineeringState(activeEngineeringState) : '',
  ]);
  const assetContext = await loadAssetContext(input.novelId, relevanceText);
  warnings.push(...assetContext.warnings);

  const sections: GenerationContextSection[] = [];
  addSection(
    sections,
    'novel',
    '作品与世界',
    joinLines([
      baseContext.novelTitle ? `作品：${baseContext.novelTitle}` : '',
      baseContext.novelGenre ? `类型：${baseContext.novelGenre}` : '',
      baseContext.novelDescription ? `简介：${baseContext.novelDescription}` : '',
      baseContext.worldBackground ? `世界设定：\n${baseContext.worldBackground}` : '',
      baseContext.ruleSystems ? `规则设定：\n${baseContext.ruleSystems}` : '',
    ]),
    ['novel', 'world_setting', 'rule_system'],
  );
  addSection(sections, 'world_settings', '补充世界设定', baseContext.chapterSettings, [
    'world_setting',
  ]);
  addSection(
    sections,
    'world_state_timeline',
    '持久化世界状态与时间线',
    baseContext.worldStateTimeline,
    ['world_state'],
  );
  addSection(
    sections,
    'protagonist',
    '主角与角色',
    joinLines([
      baseContext.protagonistsSummary,
      baseContext.dualProtagonistSummary,
      baseContext.protagonistAppearance,
      baseContext.chapterCharacters,
      baseContext.requiredCharactersSummary,
    ]),
    ['protagonist', 'chapter_character'],
  );
  addSection(sections, 'character_states', '人物动态状态', baseContext.characterStates, [
    'character_state',
  ]);
  addSection(
    sections,
    'outline',
    '大纲与剧情锚点',
    joinLines([
      baseContext.masterOutline ? `全书大纲：\n${baseContext.masterOutline}` : '',
      baseContext.volumeOutline ? `分卷大纲：\n${baseContext.volumeOutline}` : '',
      baseContext.chapterOutline ? `章节大纲：\n${baseContext.chapterOutline}` : '',
      baseContext.outlineChecklistText ? `执行清单：\n${baseContext.outlineChecklistText}` : '',
      baseContext.chapterGoal ? `本章目标：${baseContext.chapterGoal}` : '',
      baseContext.chapterEvents ? `本章事件：\n${baseContext.chapterEvents}` : '',
    ]),
    ['master_outline', 'volume_outline', 'chapter_outline', 'chapter_event'],
  );
  addSection(sections, 'story_assets', '相关势力与地点', assetContext.storyAssetText, [
    'faction',
    'location',
  ]);
  if (activeEngineeringState) {
    addSection(
      sections,
      'engineering',
      '章节工程状态',
      formatEngineeringState(activeEngineeringState),
      ['chapter_engineering'],
    );
  }
  addSection(sections, 'context_records', '创作上下文包', baseContext.previousContext, [
    'context_record',
  ]);
  addSection(sections, 'memory_context', '检索到的长期记忆事实', input.retrievedMemoryContext, [
    'memory_context',
  ]);
  addSection(sections, 'user_instruction', '本轮用户创作指令', baseContext.userInstruction, [
    'user_instruction',
  ]);
  addSection(
    sections,
    'adopted_previous_chapter',
    '前一章已采用正文（权威连续性基线）',
    input.adoptedPreviousChapter
      ? [
          `来源章节：${input.adoptedPreviousChapter.chapterId}`,
          `来源草稿：${input.adoptedPreviousChapter.draftId}`,
          `正文哈希：${input.adoptedPreviousChapter.contentHash}`,
          '必须承接以下正文的最终场景、时间、人物、物件与系统状态；不得复述或重演已经发生的事件：',
          input.adoptedPreviousChapter.content,
        ].join('\n')
      : undefined,
    ['adopted_chapter'],
    true,
  );
  addSection(
    sections,
    'provisional_previous_chapter',
    '前一章候选承接（队列临时上下文）',
    input.provisionalPreviousChapter
      ? [
          `来源章节：${input.provisionalPreviousChapter.chapterId}`,
          `来源草稿：${input.provisionalPreviousChapter.draftId}`,
          `正文哈希：${input.provisionalPreviousChapter.contentHash}`,
          '以下内容只用于保持本轮候选连续性，尚未自动写入正式章节事实：',
          input.provisionalPreviousChapter.content,
        ].join('\n')
      : undefined,
    ['provisional_candidate'],
    true,
  );
  addSection(
    sections,
    'style_output',
    '风格与输出控制',
    joinLines([
      baseContext.styleProfile ? `风格方案：\n${baseContext.styleProfile}` : '',
      baseContext.outputProfile ? `输出方案：\n${baseContext.outputProfile}` : '',
      baseContext.targetWordCount ? `目标字数：${baseContext.targetWordCount}` : '',
    ]),
    ['style_profile', 'output_profile'],
  );
  addSection(
    sections,
    'reference_materials',
    '参考资料约束',
    assetContext.referenceText
      ? [
          '研究资料只用于事实与环境约束；灵感方向只用于抽象创作方向。不得复刻参考原句、专有角色或原作情节。',
          assetContext.referenceText,
        ].join('\n')
      : undefined,
    ['reference_material'],
  );
  addSection(sections, 'current_editor', '当前正文修改', input.currentEditorContent, [
    'current_editor',
  ]);
  const continuityConstraintSection = buildContinuityConstraintSection({
    input,
    baseContext,
    assetContext,
  });
  addSection(
    sections,
    'cross_chapter_continuity',
    '跨章连续性硬约束（内部）',
    continuityConstraintSection.content,
    continuityConstraintSection.sourceTypes,
  );

  const primaryWorldSource = baseContext.worldSettingSources?.find(
    (item) => item.role === 'primary',
  );
  const supplementalWorldSources =
    baseContext.worldSettingSources?.filter((item) => item.role === 'supplemental') ?? [];
  const sources: GenerationContextSource[] = [
    source(
      'novel',
      '作品基础信息',
      baseContext.novelTitle ? 'used' : 'missing',
      baseContext.novelTitle,
    ),
    source(
      'world_setting',
      '世界设定',
      baseContext.worldBackground ? 'used' : 'missing',
      primaryWorldSource?.title,
      primaryWorldSource?.id,
    ),
    ...supplementalWorldSources.map((item) =>
      source(
        'world_setting',
        `补充世界设定：${item.title}`,
        'used',
        `updated_at=${item.updatedAt}`,
        item.id,
      ),
    ),
    source('rule_system', '规则设定', baseContext.ruleSystems ? 'used' : 'missing'),
    ...(baseContext.worldStateTimeline
      ? [
          source(
            'world_state',
            '持久化世界状态与时间线',
            'used',
            baseContext.worldStateTimelineSource
              ? [
                  `chapters=${baseContext.worldStateTimelineSource.chapterCount}`,
                  `summaries=${baseContext.worldStateTimelineSource.sourceSummaryIds.length}`,
                  `context_records=${baseContext.worldStateTimelineSource.sourceContextRecordIds.length}`,
                ].join(';')
              : undefined,
            baseContext.worldStateTimelineSource?.latestChapterId,
          ),
        ]
      : []),
    source(
      'protagonist',
      '主角设定',
      baseContext.protagonist?.trim() || baseContext.protagonistsSummary?.trim()
        ? 'used'
        : 'missing',
    ),
    source(
      'master_outline',
      '全书大纲',
      baseContext.masterOutline ? 'used' : 'missing',
      baseContext.masterOutlineSource,
    ),
    source(
      'volume_outline',
      '分卷大纲',
      baseContext.volumeOutline ? 'used' : 'missing',
      baseContext.volumeOutlineSource,
    ),
    source(
      'chapter_outline',
      '章节大纲',
      baseContext.chapterOutline ? 'used' : 'missing',
      baseContext.chapterOutlineSource,
    ),
    source(
      'chapter_engineering',
      '章节工程 active 状态',
      activeEngineeringState ? 'used' : 'missing',
      activeEngineeringState ? `v${activeEngineeringState.draftVersion}` : undefined,
      activeEngineeringState?.id,
    ),
    source(
      'chapter_character',
      '本章角色',
      baseContext.chapterCharacters ? 'used' : 'missing',
      baseContext.requiredCharacterNames,
    ),
    ...(baseContext.characterStateSources?.length
      ? baseContext.characterStateSources.map((item) =>
          source(
            'character_state',
            `人物状态：${item.characterName}`,
            'used',
            item.chapterId
              ? `来源章节=${item.chapterId};origin=${item.origin}`
              : `origin=${item.origin}`,
            item.id,
          ),
        )
      : [
          source(
            'character_state',
            '人物动态状态',
            baseContext.characterStates ? 'used' : 'missing',
          ),
        ]),
    source('chapter_event', '本章事件', baseContext.chapterEvents ? 'used' : 'missing'),
    source('context_record', '创作上下文包', baseContext.previousContext ? 'used' : 'missing'),
    source(
      'memory_context',
      '检索到的长期记忆事实',
      input.retrievedMemoryContext?.trim() ? 'used' : 'missing',
    ),
    source(
      'user_instruction',
      '本轮用户创作指令',
      baseContext.userInstruction ? 'used' : 'missing',
    ),
    source(
      'adopted_chapter',
      '前一章已采用正文承接',
      input.adoptedPreviousChapter ? 'used' : 'missing',
      input.adoptedPreviousChapter?.contentHash,
      input.adoptedPreviousChapter?.draftId,
    ),
    source(
      'provisional_candidate',
      '前一章候选承接',
      input.provisionalPreviousChapter ? 'used' : 'missing',
      input.provisionalPreviousChapter?.contentHash,
      input.provisionalPreviousChapter?.draftId,
    ),
    source(
      'style_profile',
      '风格方案',
      baseContext.styleProfile ? 'used' : 'fallback',
      input.styleProfileId,
      input.styleProfileId,
    ),
    source(
      'output_profile',
      '输出控制',
      baseContext.outputProfile ? 'used' : 'fallback',
      input.outputProfileId,
      input.outputProfileId,
    ),
    ...assetContext.sources,
    ...(assetContext.sources.some((item) => item.type === 'faction')
      ? []
      : [source('faction', '势力资产', 'missing')]),
    ...(assetContext.sources.some((item) => item.type === 'location')
      ? []
      : [source('location', '地点资产', 'missing')]),
    ...(assetContext.sources.some((item) => item.type === 'reference_material')
      ? []
      : [source('reference_material', '参考资料', 'missing')]),
    source(
      'current_editor',
      '当前正文修改',
      input.currentEditorContent?.trim() ? 'used' : 'missing',
    ),
  ];
  const compiledAt = nowISO();
  const compiledContext: CompiledGenerationContext = {
    chapterId: input.chapterId,
    novelId: input.novelId,
    volumeId: input.volumeId,
    baseContext,
    activeEngineeringState,
    sections,
    sources,
    warnings,
    compiledAt,
  };
  const compiledPromptText = buildPromptText(sections);
  const promptSummary = buildPromptSummary(sections, sources, warnings);
  const contextHash = hashTextContent(
    stableStringify({
      sections,
      sources,
      engineeringStateId: activeEngineeringState?.id,
      styleProfileId: input.styleProfileId,
      outputProfileId: input.outputProfileId,
      adoptedPreviousChapter: input.adoptedPreviousChapter
        ? {
            chapterId: input.adoptedPreviousChapter.chapterId,
            draftId: input.adoptedPreviousChapter.draftId,
            contentHash: input.adoptedPreviousChapter.contentHash,
          }
        : undefined,
      provisionalPreviousChapter: input.provisionalPreviousChapter
        ? {
            chapterId: input.provisionalPreviousChapter.chapterId,
            draftId: input.provisionalPreviousChapter.draftId,
            contentHash: input.provisionalPreviousChapter.contentHash,
          }
        : undefined,
    }),
  );

  return {
    id: generateId(),
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    engineeringStateId: activeEngineeringState?.id,
    styleProfileId: input.styleProfileId,
    outputProfileId: input.outputProfileId,
    compiledContext,
    compiledPromptText,
    promptSummary,
    contextHash,
    sources,
    createdAt: compiledAt,
  };
}

export const generationContextCompiler = {
  async compile(input: CompileGenerationContextInput): Promise<ChapterGenerationSnapshot> {
    return compileGenerationContextSnapshot(input);
  },

  async compileAndSave(input: CompileGenerationContextInput): Promise<ChapterGenerationSnapshot> {
    const snapshot = await this.compile(input);
    const raw = await dbCall<unknown>(
      'save_chapter_generation_snapshot',
      { input: toDbInput(snapshot) },
      () => saveLocalSnapshot(snapshot),
    );
    const normalized = normalizeSnapshot(raw);
    if (!normalized) throw new Error('生成上下文快照保存返回无效数据');
    return normalized;
  },

  async getByChapterId(chapterId: string): Promise<ChapterGenerationSnapshot[]> {
    const raw = await dbCall<unknown[]>('get_chapter_generation_snapshots', { chapterId }, () =>
      getLocalSnapshots(chapterId),
    );
    return normalizeSnapshots(raw);
  },

  async getLatestByChapterId(chapterId: string): Promise<ChapterGenerationSnapshot | null> {
    const raw = await dbCall<unknown | null>(
      'get_latest_chapter_generation_snapshot',
      { chapterId },
      () => getLocalSnapshots(chapterId)[0] ?? null,
    );
    return normalizeSnapshot(raw);
  },
};
