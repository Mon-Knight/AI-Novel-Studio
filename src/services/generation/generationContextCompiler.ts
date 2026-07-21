import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';
import { chapterEngineeringService } from '../engineering/chapterEngineeringService';
import { buildFreshChapterGenerationContext } from '../prompt/contextBuilder';
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

function limitText(value: string | undefined, limit = SECTION_LIMIT): string {
  const text = value?.trim() ?? '';
  if (!text) return '';
  if (text.length <= limit) return text;
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
): void {
  const normalized = limitText(content);
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
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
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
    card.releasedInformation.length ? `本章释放信息：\n${formatList(card.releasedInformation)}` : '',
    card.reservedSecrets.length ? `保留悬念：\n${formatList(card.reservedSecrets)}` : '',
    card.styleRequirements.length ? `文风要求：\n${formatList(card.styleRequirements)}` : '',
    card.forbiddenWriting.length ? `写法禁区：\n${formatList(card.forbiddenWriting)}` : '',
    state.scenePlan.length ? `场景计划：\n${state.scenePlan.map((scene) => [
      `${scene.sceneNo}. ${scene.title}`,
      scene.location ? `地点：${scene.location}` : '',
      scene.characters.length ? `角色：${scene.characters.join('、')}` : '',
      scene.goal ? `目标：${scene.goal}` : '',
      scene.conflict ? `冲突：${scene.conflict}` : '',
      scene.keyActions.length ? `关键动作：${scene.keyActions.join('；')}` : '',
      scene.informationRelease.length ? `释放信息：${scene.informationRelease.join('；')}` : '',
      scene.result ? `结果：${scene.result}` : '',
    ].filter(Boolean).join(' / ')).join('\n')}` : '',
    constraints.mustFollow.length ? `必须遵守：\n${formatList(constraints.mustFollow)}` : '',
    constraints.forbiddenChanges.length ? `不得改变：\n${formatList(constraints.forbiddenChanges)}` : '',
    constraints.forbiddenAdditions.length ? `不得新增：\n${formatList(constraints.forbiddenAdditions)}` : '',
    constraints.forbiddenEarlyEvents.length ? `不得提前发生：\n${formatList(constraints.forbiddenEarlyEvents)}` : '',
    constraints.forbiddenEarlyReveals.length ? `不得提前揭示：\n${formatList(constraints.forbiddenEarlyReveals)}` : '',
    constraints.bannedWords.length ? `禁用词：${constraints.bannedWords.join('、')}` : '',
    constraints.bannedSentencePatterns.length ? `禁用句式：${constraints.bannedSentencePatterns.join('、')}` : '',
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

function buildPromptText(sections: GenerationContextSection[]): string {
  return sections
    .map((section) => `## ${section.title}\n${section.content}`)
    .join('\n\n---\n\n');
}

function buildPromptSummary(sections: GenerationContextSection[], sources: GenerationContextSource[], warnings: string[]): string {
  const usedCount = sources.filter((item) => item.status === 'used').length;
  const missingCount = sources.filter((item) => item.status === 'missing').length;
  const titles = sections.map((section) => section.title).join('、');
  return [
    `已编译 ${sections.length} 个上下文分区：${titles || '无'}`,
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
  const compiledContext = item.compiledContext ?? safeJsonParse<CompiledGenerationContext | null>(
    toSafeString(item.compiledContextJson ?? item.compiled_context_json),
    null,
  );
  if (!compiledContext) return null;
  const sources = item.sources ?? safeJsonParse<GenerationContextSource[]>(
    toSafeString(item.sourcesJson ?? item.sources_json),
    compiledContext.sources ?? [],
  );
  return {
    id,
    novelId,
    volumeId: toSafeString(item.volumeId ?? item.volume_id).trim() || undefined,
    chapterId,
    engineeringStateId: toSafeString(item.engineeringStateId ?? item.engineering_state_id).trim() || undefined,
    styleProfileId: toSafeString(item.styleProfileId ?? item.style_profile_id).trim() || undefined,
    outputProfileId: toSafeString(item.outputProfileId ?? item.output_profile_id).trim() || undefined,
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
    .sort((a, b) => toSafeNumber(Date.parse(b.createdAt), 0) - toSafeNumber(Date.parse(a.createdAt), 0));
}

function getLocalSnapshots(chapterId: string): ChapterGenerationSnapshot[] {
  const snapshots = normalizeSnapshots(lsGet<unknown>(storageKey(chapterId)));
  lsSet(storageKey(chapterId), snapshots);
  return snapshots;
}

function saveLocalSnapshot(snapshot: ChapterGenerationSnapshot): ChapterGenerationSnapshot {
  const snapshots = getLocalSnapshots(snapshot.chapterId);
  lsSet(storageKey(snapshot.chapterId), [snapshot, ...snapshots.filter((item) => item.id !== snapshot.id)]);
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

export const generationContextCompiler = {
  async compile(input: CompileGenerationContextInput): Promise<ChapterGenerationSnapshot> {
    const baseContext = await buildFreshChapterGenerationContext({
      novelId: input.novelId,
      volumeId: input.volumeId,
      chapterId: input.chapterId,
      userInstruction: input.userInstruction,
      styleId: input.styleProfileId,
      outputId: input.outputProfileId,
    });
    const engineeringBundle = await chapterEngineeringService.getBundle(input.chapterId);
    const activeEngineeringState = input.engineeringStateId
      ? engineeringBundle.states.find((item) => item.id === input.engineeringStateId)
      : engineeringBundle.activeState;
    const warnings: string[] = [];
    if (!activeEngineeringState) warnings.push('未找到 active 章节工程状态，快照仅包含旧式章节上下文。');

    const sections: GenerationContextSection[] = [];
    addSection(sections, 'novel', '作品与世界', joinLines([
      baseContext.novelTitle ? `作品：${baseContext.novelTitle}` : '',
      baseContext.novelGenre ? `类型：${baseContext.novelGenre}` : '',
      baseContext.novelDescription ? `简介：${baseContext.novelDescription}` : '',
      baseContext.worldBackground ? `世界设定：\n${baseContext.worldBackground}` : '',
      baseContext.ruleSystems ? `规则设定：\n${baseContext.ruleSystems}` : '',
    ]), ['novel', 'world_setting', 'rule_system']);
    addSection(sections, 'protagonist', '主角与角色', joinLines([
      baseContext.protagonistsSummary,
      baseContext.dualProtagonistSummary,
      baseContext.protagonistAppearance,
      baseContext.chapterCharacters,
      baseContext.requiredCharactersSummary,
    ]), ['protagonist', 'chapter_character']);
    addSection(sections, 'outline', '大纲与剧情锚点', joinLines([
      baseContext.masterOutline ? `全书大纲：\n${baseContext.masterOutline}` : '',
      baseContext.volumeOutline ? `分卷大纲：\n${baseContext.volumeOutline}` : '',
      baseContext.chapterOutline ? `章节大纲：\n${baseContext.chapterOutline}` : '',
      baseContext.outlineChecklistText ? `执行清单：\n${baseContext.outlineChecklistText}` : '',
      baseContext.chapterGoal ? `本章目标：${baseContext.chapterGoal}` : '',
      baseContext.chapterEvents ? `本章事件：\n${baseContext.chapterEvents}` : '',
    ]), ['master_outline', 'volume_outline', 'chapter_outline', 'chapter_event']);
    if (activeEngineeringState) {
      addSection(sections, 'engineering', '章节工程状态', formatEngineeringState(activeEngineeringState), ['chapter_engineering']);
    }
    addSection(sections, 'context_records', '创作上下文包', baseContext.previousContext, ['context_record']);
    addSection(sections, 'style_output', '风格与输出控制', joinLines([
      baseContext.styleProfile ? `风格方案：\n${baseContext.styleProfile}` : '',
      baseContext.outputProfile ? `输出方案：\n${baseContext.outputProfile}` : '',
      baseContext.targetWordCount ? `目标字数：${baseContext.targetWordCount}` : '',
    ]), ['style_profile', 'output_profile']);
    addSection(sections, 'current_editor', '当前正文修改', input.currentEditorContent, ['current_editor']);

    const sources: GenerationContextSource[] = [
      source('novel', '作品基础信息', baseContext.novelTitle ? 'used' : 'missing', baseContext.novelTitle),
      source('world_setting', '世界设定', baseContext.worldBackground ? 'used' : 'missing'),
      source('rule_system', '规则设定', baseContext.ruleSystems ? 'used' : 'missing'),
      source('master_outline', '全书大纲', baseContext.masterOutline ? 'used' : 'missing', baseContext.masterOutlineSource),
      source('volume_outline', '分卷大纲', baseContext.volumeOutline ? 'used' : 'missing', baseContext.volumeOutlineSource),
      source('chapter_outline', '章节大纲', baseContext.chapterOutline ? 'used' : 'missing', baseContext.chapterOutlineSource),
      source('chapter_engineering', '章节工程 active 状态', activeEngineeringState ? 'used' : 'missing', activeEngineeringState ? `v${activeEngineeringState.draftVersion}` : undefined, activeEngineeringState?.id),
      source('chapter_character', '本章角色', baseContext.chapterCharacters ? 'used' : 'missing', baseContext.requiredCharacterNames),
      source('chapter_event', '本章事件', baseContext.chapterEvents ? 'used' : 'missing'),
      source('context_record', '创作上下文包', baseContext.previousContext ? 'used' : 'missing'),
      source('style_profile', '风格方案', baseContext.styleProfile ? 'used' : 'fallback', input.styleProfileId),
      source('output_profile', '输出控制', baseContext.outputProfile ? 'used' : 'fallback', input.outputProfileId),
      source('current_editor', '当前正文修改', input.currentEditorContent?.trim() ? 'used' : 'missing'),
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
    const contextHash = hashTextContent(stableStringify({
      sections,
      sources,
      engineeringStateId: activeEngineeringState?.id,
      styleProfileId: input.styleProfileId,
      outputProfileId: input.outputProfileId,
    }));

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
    const raw = await dbCall<unknown[]>(
      'get_chapter_generation_snapshots',
      { chapterId },
      () => getLocalSnapshots(chapterId),
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
