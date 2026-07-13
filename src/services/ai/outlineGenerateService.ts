/**
 * AI Novel Studio - AI outline generation service.
 */
import { createAiClient, aiSettingsService } from './aiClient';
import {
  buildChapterOutlineGeneratePrompt,
  buildOutlineGeneratePrompt,
  buildVolumeOutlineGeneratePrompt,
} from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { safeJsonParse } from './jsonUtils';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { styleProfileService } from '../styles/styleProfileService';
import { masterOutlineService, volumeOutlineService } from '../outlines/outlineService';
import {
  aiWorkflowService,
  type CreateBackgroundWorkflowInput,
  type WorkflowCreated,
} from '../ai-tasks/aiWorkflowService';
import { stableCanonicalStringify } from '../ai-tasks/stage3PrerequisiteService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export interface VolumeOutlineCandidate {
  title: string;
  summary: string;
  goal?: string;
  mainConflict?: string;
  rawText?: string;
}

export interface ChapterOutlineCandidate {
  title: string;
  outline: string;
  goal?: string;
  targetWordCount?: number;
  rawText?: string;
}

export interface OutlineWorkflowOptions {
  operationId?: string;
  additionalInstruction?: string;
  coCreationContext?: string;
  sourceManifestJson?: Array<Record<string, unknown>>;
  inputPayloadJson?: Record<string, unknown>;
  generationSource?: 'ai_co_creation';
}

export type PreparedOutlineWorkflow = Omit<CreateBackgroundWorkflowInput, 'operationId'>;

const MAX_BACKGROUND_CHAPTER_OUTLINES = 20;

function frozenProviderOptions(): NonNullable<CreateBackgroundWorkflowInput['providerOptionsJson']> {
  const settings = aiSettingsService.getSettings();
  return {
    provider: settings.provider,
    model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
    temperature: settings.temperature ?? 0.7,
    maxTokens: settings.maxTokens ?? 8_000,
    timeoutSeconds: settings.timeoutSeconds ?? 120,
  };
}

async function assertNovelScope(novelId: string): Promise<void> {
  const novel = await novelRepository.getById(novelId);
  if (!novel) throw new Error('大纲生成目标作品不存在');
}

async function assertVolumeScope(novelId: string, volumeId?: string): Promise<void> {
  if (!volumeId) return;
  const volume = await volumeRepository.getById(volumeId);
  if (!volume || volume.novelId !== novelId) throw new Error('目标分卷不属于当前作品');
}

async function assertChapterScope(input: {
  novelId: string;
  volumeId?: string;
  chapterId?: string;
}): Promise<void> {
  await assertVolumeScope(input.novelId, input.volumeId);
  if (!input.chapterId) return;
  const chapter = await chapterRepository.getById(input.chapterId);
  if (!chapter || chapter.novelId !== input.novelId) throw new Error('目标章节不属于当前作品');
  if (input.volumeId && chapter.volumeId !== input.volumeId) {
    throw new Error('目标章节与指定分卷不一致');
  }
}

function workflowManifest(
  existing: Array<Record<string, unknown>>,
  extra?: Array<Record<string, unknown>>,
  strict = false,
): Array<Record<string, unknown>> {
  const byIdentity = new Map<string, Record<string, unknown>>();
  for (const source of [...existing, ...(extra ?? [])]) {
    const type = typeof source.type === 'string' ? source.type
      : typeof source.sourceType === 'string' ? source.sourceType : '';
    const id = typeof source.id === 'string' ? source.id
      : typeof source.sourceId === 'string' ? source.sourceId : '';
    if (!type || !id) {
      if (strict) throw new Error('AI 共创大纲来源必须包含非空 type/id');
      continue;
    }
    if (strict && source.status !== undefined && !['used', 'missing'].includes(String(source.status))) {
      throw new Error(`AI 共创大纲来源状态无效：${type}/${id}`);
    }
    if (strict && source.version !== undefined
        && typeof source.version !== 'string' && typeof source.version !== 'number') {
      throw new Error(`AI 共创大纲来源版本无效：${type}/${id}`);
    }
    const rawHash = source.hash ?? source.contentHash;
    if (strict && rawHash !== undefined && typeof rawHash !== 'string' && typeof rawHash !== 'number') {
      throw new Error(`AI 共创大纲来源 hash 无效：${type}/${id}`);
    }
    const normalized = {
      type,
      id,
      ...(source.version !== undefined ? { version: source.version } : {}),
      ...(source.hash !== undefined ? { hash: source.hash } : {}),
      ...(source.contentHash !== undefined ? { hash: source.contentHash } : {}),
      ...(source.role !== undefined ? { role: source.role } : {}),
      status: source.status === 'missing' ? 'missing' : 'used',
    };
    const identity = `${type}\u0000${id}`;
    const previous = byIdentity.get(identity);
    if (strict && previous
        && stableCanonicalStringify(previous) !== stableCanonicalStringify(normalized)) {
      throw new Error(`AI 共创大纲来源重复且内容冲突：${type}/${id}`);
    }
    byIdentity.set(identity, normalized);
  }
  return [...byIdentity.values()].sort((left, right) => (
    `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)
  ));
}

async function collectionManifestSource(
  type: string,
  novelId: string,
  items: Array<{ id: string; updatedAt: string; isActive?: boolean }>,
): Promise<Record<string, unknown>> {
  const state = items
    .map((item) => ({
      active: typeof item.isActive === 'boolean' ? item.isActive : null,
      id: item.id,
      version: item.updatedAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    type,
    id: novelId,
    hash: await computeContentSha256(stableCanonicalStringify(state)),
    role: 'collection_state',
    status: 'used',
  };
}

function outlineInputBody(
  context: Record<string, unknown>,
  coCreationContext?: string,
): string {
  return JSON.stringify({
    ...context,
    ...(coCreationContext ? { coCreationContext } : {}),
  });
}

async function readOutlineSource<T>(
  promise: Promise<T>,
  fallback: T,
  strict: boolean,
  label: string,
): Promise<T> {
  try {
    return await promise;
  } catch {
    if (strict) throw new Error(`AI 共创大纲上下文读取失败：${label}`);
    return fallback;
  }
}

async function buildOutlineContext(
  novelId: string,
  volumeId?: string,
  strict = false,
  chapterId?: string,
) {
  const [novel, worldSettings, ruleSystems, protagonist, volumes, chapters] = await Promise.all([
    novelRepository.getById(novelId),
    readOutlineSource(settingRepository.getWorldSettings(novelId), [], strict, '世界设定'),
    readOutlineSource(settingRepository.getRuleSystems(novelId), [], strict, '规则体系'),
    readOutlineSource(protagonistRepository.getByNovelId(novelId), null, strict, '主角设定'),
    readOutlineSource(volumeRepository.getByNovelId(novelId), [], strict, '分卷列表'),
    readOutlineSource(chapterRepository.getByNovelId(novelId), [], strict, '章节列表'),
  ]);
  if (!novel) throw new Error('大纲生成目标作品不存在');

  const activeWorld = worldSettings.find((item) => item.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((item) => item.isActive);
  const selectedVolume = volumeId ? volumes.find((item) => item.id === volumeId) : undefined;
  const selectedChapter = chapterId ? chapters.find((item) => item.id === chapterId) : undefined;
  if (strict && volumeId && !selectedVolume) throw new Error('目标分卷不属于当前作品');
  if (strict && chapterId && !selectedChapter) throw new Error('目标章节不属于当前作品');
  if (strict && selectedChapter && volumeId && selectedChapter.volumeId !== volumeId) {
    throw new Error('目标章节与指定分卷不一致');
  }

  // v1.0.35: 加载当前采用总纲
  let activeMasterOutline: string | undefined;
  let activeMasterOutlineId: string | undefined;
  let activeMasterOutlineVersion: number | undefined;
  let activeMasterOutlineUpdatedAt: string | undefined;
  let activeMasterOutlineIsActive: boolean | undefined;
  try {
    const masterOutline = await masterOutlineService.getActive(novelId);
    if (masterOutline) {
      activeMasterOutline = masterOutline.content;
      activeMasterOutlineId = masterOutline.id;
      activeMasterOutlineVersion = masterOutline.version;
      activeMasterOutlineUpdatedAt = masterOutline.updatedAt;
      activeMasterOutlineIsActive = masterOutline.isActive;
    } else {
      // 降级：读取最近更新的总纲
      const versions = await masterOutlineService.getVersions(novelId);
      if (versions.length > 0) {
        activeMasterOutline = versions[0].content;
        activeMasterOutlineId = versions[0].id;
        activeMasterOutlineVersion = versions[0].version;
        activeMasterOutlineUpdatedAt = versions[0].updatedAt;
        activeMasterOutlineIsActive = versions[0].isActive;
      }
    }
  } catch {
    if (strict) throw new Error('AI 共创大纲上下文读取失败：活动总纲');
  }

  // v1.0.35: 加载当前采用分卷大纲
  let activeVolumeOutline: string | undefined;
  let activeVolumeOutlineId: string | undefined;
  let activeVolumeOutlineVersion: number | undefined;
  let activeVolumeOutlineUpdatedAt: string | undefined;
  let activeVolumeOutlineIsActive: boolean | undefined;
  if (volumeId) {
    try {
      const volumeOutline = await volumeOutlineService.getActive(novelId, volumeId);
      if (volumeOutline) {
        activeVolumeOutline = volumeOutline.content;
        activeVolumeOutlineId = volumeOutline.id;
        activeVolumeOutlineVersion = volumeOutline.version;
        activeVolumeOutlineUpdatedAt = volumeOutline.updatedAt;
        activeVolumeOutlineIsActive = volumeOutline.isActive;
      } else {
        // 降级：读取最近更新的该分卷大纲
        const versions = await volumeOutlineService.getVersions(novelId, volumeId);
        if (versions.length > 0) {
          activeVolumeOutline = versions[0].content;
          activeVolumeOutlineId = versions[0].id;
          activeVolumeOutlineVersion = versions[0].version;
          activeVolumeOutlineUpdatedAt = versions[0].updatedAt;
          activeVolumeOutlineIsActive = versions[0].isActive;
        }
      }
    } catch {
      if (strict) throw new Error('AI 共创大纲上下文读取失败：活动分卷大纲');
    }
  }

  // v1.0.33: 加载当前采用风格方案
  let styleSummary: string | undefined;
  let activeStyleId: string | undefined;
  let activeStyleVersion: string | undefined;
  let activeStyleIsActive: boolean | undefined;
  try {
    const activeStyle = await styleProfileService.getActive(novelId);
    if (activeStyle) {
      activeStyleId = activeStyle.id;
      activeStyleVersion = activeStyle.updatedAt;
      activeStyleIsActive = activeStyle.isActive;
      const parts: string[] = [];
      if (activeStyle.narrativePerspective) parts.push(`叙事人称：${activeStyle.narrativePerspective}`);
      if (activeStyle.tone) parts.push(`文风：${activeStyle.tone}`);
      if (activeStyle.pace) parts.push(`节奏：${activeStyle.pace}`);
      parts.push(`对话比例：${Math.round(activeStyle.dialogueRatio * 100)}%，描写比例：${Math.round(activeStyle.descriptionRatio * 100)}%`);
      if (activeStyle.battleIntensity) parts.push(`战斗强度：${activeStyle.battleIntensity}`);
      if (activeStyle.emotionTendency) parts.push(`情绪倾向：${activeStyle.emotionTendency}`);
      if (activeStyle.prohibitedStyles?.length) parts.push(`禁用：${activeStyle.prohibitedStyles.join('、')}`);
      styleSummary = parts.join('\n');
    }
  } catch {
    if (strict) throw new Error('AI 共创大纲上下文读取失败：活动风格');
  }

  // v1.0.35: 构建上下文快照（记录使用的大纲 ID）
  const contextSnapshot = JSON.stringify({
    used_master_outline_id: activeMasterOutlineId || null,
    used_volume_outline_id: activeVolumeOutlineId || null,
    has_active_master: !!activeMasterOutline,
    has_active_volume: !!activeVolumeOutline,
  });
  const [worldCollection, ruleCollection, volumeCollection, chapterCollection] = await Promise.all([
    collectionManifestSource('world_setting_collection', novelId, worldSettings),
    collectionManifestSource('rule_system_collection', novelId, ruleSystems),
    collectionManifestSource('volume_collection', novelId, volumes),
    collectionManifestSource('chapter_collection', novelId, chapters),
  ]);
  const [activeMasterOutlineHash, activeVolumeOutlineHash] = await Promise.all([
    activeMasterOutline ? computeContentSha256(activeMasterOutline) : Promise.resolve(undefined),
    activeVolumeOutline ? computeContentSha256(activeVolumeOutline) : Promise.resolve(undefined),
  ]);

  return {
    novelTitle: novel?.title || '未命名作品',
    novelGenre: novel?.genre,
    description: novel?.description,
    worldBackground: activeWorld?.content?.slice(0, 1600),
    ruleSystems: activeRules.map((item) => `《${item.title}》${item.content}`).join('\n').slice(0, 2400),
    protagonist: protagonist ? [protagonist.name, protagonist.identity, protagonist.personality, protagonist.goal].filter(Boolean).join('；') : undefined,
    specialAbility: protagonist?.specialAbility,
    existingVolumes: volumes.map((item) => `- ${item.title}：${item.summary || item.goal || ''}`).join('\n'),
    existingChapters: chapters.map((item) => `- ${item.title}：${item.outline || item.goal || ''}`).join('\n').slice(0, 3000),
    styleSummary,
    activeMasterOutline,
    activeMasterOutlineId,
    activeMasterOutlineVersion,
    activeVolumeOutline,
    activeVolumeOutlineId,
    activeVolumeOutlineVersion,
    contextSnapshot,
    sourceManifest: [
      { type: 'novel', id: novel.id, version: novel.updatedAt },
      ...(activeWorld ? [{ type: 'world_setting', id: activeWorld.id, version: activeWorld.updatedAt }] : []),
      ...activeRules.map((item) => ({ type: 'rule_system', id: item.id, version: item.updatedAt })),
      ...(protagonist ? [{ type: 'protagonist', id: protagonist.id, version: protagonist.updatedAt }] : []),
      ...volumes.map((item) => ({ type: 'volume', id: item.id, version: item.updatedAt })),
      ...chapters.map((item) => ({ type: 'chapter', id: item.id, version: item.updatedAt })),
      ...(activeMasterOutlineId ? [{
        type: 'master_outline', id: activeMasterOutlineId,
        version: activeMasterOutlineUpdatedAt,
        hash: activeMasterOutlineHash,
        role: activeMasterOutlineIsActive ? 'active_master_outline' : 'fallback_master_outline',
      }] : []),
      ...(activeVolumeOutlineId ? [{
        type: 'volume_outline', id: activeVolumeOutlineId,
        version: activeVolumeOutlineUpdatedAt,
        hash: activeVolumeOutlineHash,
        role: activeVolumeOutlineIsActive ? 'active_volume_outline' : 'fallback_volume_outline',
      }] : []),
      ...(activeStyleId ? [{
        type: 'style_profile', id: activeStyleId, version: activeStyleVersion,
        role: activeStyleIsActive ? 'active_style_profile' : 'fallback_style_profile',
      }] : []),
      worldCollection,
      ruleCollection,
      volumeCollection,
      chapterCollection,
    ],
    selectedVolume,
    selectedChapter,
  };
}

async function compileNovelOutlineWorkflow(
  novelId: string,
  options: OutlineWorkflowOptions = {},
): Promise<PreparedOutlineWorkflow> {
  await assertNovelScope(novelId);
  const strict = options.generationSource === 'ai_co_creation';
  const context = await buildOutlineContext(novelId, undefined, strict);
  const request = buildOutlineGeneratePrompt({
    ...context,
    additionalInstruction: options.additionalInstruction,
    coCreationContext: options.coCreationContext,
  });
  return {
    workflowName: `${context.novelTitle} · 作品总纲`,
    taskType: 'outline_generate',
    novelId,
    scopeType: 'novel',
    targetHintJson: {
      outlineType: 'master',
      activeMasterOutlineId: context.activeMasterOutlineId,
      generationSource: options.generationSource,
    },
    inputPayloadJson: {
      ...options.inputPayloadJson,
      novelTitle: context.novelTitle,
      contextSnapshot: context.contextSnapshot,
      additionalInstruction: options.additionalInstruction,
    },
    inputBody: outlineInputBody(context, options.coCreationContext),
    sourceManifestJson: workflowManifest(context.sourceManifest, options.sourceManifestJson, strict),
    providerOptionsJson: frozenProviderOptions(),
    steps: [{
      stepKey: 'master_outline', taskType: 'outline_generate', agentRole: '总纲',
      artifactType: 'outline_text', messages: request.messages, reviewOutput: true,
    }],
  };
}

async function compileVolumeOutlineWorkflow(input: {
  novelId: string;
  volumeTitle?: string;
  volumeId?: string;
} & OutlineWorkflowOptions): Promise<PreparedOutlineWorkflow> {
  await assertNovelScope(input.novelId);
  await assertVolumeScope(input.novelId, input.volumeId);
  const strict = input.generationSource === 'ai_co_creation';
  const context = await buildOutlineContext(input.novelId, input.volumeId, strict);
  const volumeTitle = strict ? context.selectedVolume?.title : input.volumeTitle;
  const request = buildVolumeOutlineGeneratePrompt({
    novelTitle: context.novelTitle, novelGenre: context.novelGenre, description: context.description,
    worldBackground: context.worldBackground, ruleSystems: context.ruleSystems,
    protagonist: context.protagonist, specialAbility: context.specialAbility,
    existingVolumes: context.existingVolumes, existingChapters: context.existingChapters,
    volumeTitle, activeMasterOutline: context.activeMasterOutline,
    styleSummary: context.styleSummary, additionalInstruction: input.additionalInstruction,
    coCreationContext: input.coCreationContext,
  });
  return {
    workflowName: `${volumeTitle || context.novelTitle} · 分卷大纲`,
    taskType: 'volume_outline_generate',
    novelId: input.novelId,
    scopeType: 'volume',
    targetHintJson: {
      volumeId: input.volumeId,
      activeMasterOutlineId: context.activeMasterOutlineId,
      generationSource: input.generationSource,
    },
    inputPayloadJson: {
      ...input.inputPayloadJson,
      volumeTitle,
      contextSnapshot: context.contextSnapshot,
      additionalInstruction: input.additionalInstruction,
    },
    inputBody: outlineInputBody(context, input.coCreationContext),
    sourceManifestJson: workflowManifest(context.sourceManifest, input.sourceManifestJson, strict),
    providerOptionsJson: frozenProviderOptions(),
    steps: [{
      stepKey: 'volume_outline', taskType: 'volume_outline_generate', agentRole: '卷纲',
      artifactType: 'volume_outline', messages: request.messages, reviewOutput: true,
    }],
  };
}

async function compileChapterOutlinesWorkflow(input: {
  novelId: string;
  volumeId?: string;
  chapterId?: string;
  chapterTitle?: string;
  chapterGoal?: string;
  chapterCount?: number;
} & OutlineWorkflowOptions): Promise<PreparedOutlineWorkflow> {
  await assertNovelScope(input.novelId);
  await assertChapterScope(input);
  if (input.chapterCount !== undefined && (!Number.isSafeInteger(input.chapterCount)
      || input.chapterCount < 1 || input.chapterCount > MAX_BACKGROUND_CHAPTER_OUTLINES)) {
    throw new Error(`章节大纲数量必须为 1 到 ${MAX_BACKGROUND_CHAPTER_OUTLINES}`);
  }
  const strict = input.generationSource === 'ai_co_creation';
  const context = await buildOutlineContext(
    input.novelId,
    input.volumeId,
    strict,
    input.chapterId,
  );
  const volume = context.selectedVolume;
  const chapterTitle = strict ? context.selectedChapter?.title : input.chapterTitle;
  const chapterGoal = strict ? context.selectedChapter?.goal : input.chapterGoal;
  const request = buildChapterOutlineGeneratePrompt({
    novelTitle: context.novelTitle, novelGenre: context.novelGenre, description: context.description,
    worldBackground: context.worldBackground, ruleSystems: context.ruleSystems,
    protagonist: context.protagonist, specialAbility: context.specialAbility,
    existingVolumes: context.existingVolumes, existingChapters: context.existingChapters,
    volumeTitle: volume?.title || context.novelTitle, volumeSummary: volume?.summary || volume?.goal,
    currentChapterTitle: chapterTitle, currentChapterGoal: chapterGoal,
    chapterCount: input.chapterCount, activeMasterOutline: context.activeMasterOutline,
    activeVolumeOutline: context.activeVolumeOutline, styleSummary: context.styleSummary,
    additionalInstruction: input.additionalInstruction,
    coCreationContext: input.coCreationContext,
  });
  return {
    workflowName: `${chapterTitle || volume?.title || context.novelTitle} · 章节大纲`,
    taskType: 'chapter_outline_generate',
    novelId: input.novelId,
    chapterId: input.chapterId,
    scopeType: input.chapterId ? 'chapter' : 'volume',
    targetHintJson: {
      volumeId: input.volumeId,
      chapterId: input.chapterId,
      activeMasterOutlineId: context.activeMasterOutlineId,
      activeVolumeOutlineId: context.activeVolumeOutlineId,
      generationSource: input.generationSource,
    },
    inputPayloadJson: {
      ...input.inputPayloadJson,
      chapterTitle,
      chapterGoal,
      chapterCount: input.chapterCount,
      contextSnapshot: context.contextSnapshot,
      additionalInstruction: input.additionalInstruction,
    },
    inputBody: outlineInputBody(context, input.coCreationContext),
    sourceManifestJson: workflowManifest(context.sourceManifest, input.sourceManifestJson, strict),
    providerOptionsJson: frozenProviderOptions(),
    steps: [{
      stepKey: 'chapter_outlines', taskType: 'chapter_outline_generate', agentRole: '章纲',
      artifactType: 'chapter_outlines', messages: request.messages, reviewOutput: true,
    }],
  };
}

async function submitPreparedOutlineWorkflow(
  prepared: PreparedOutlineWorkflow,
  options: Pick<OutlineWorkflowOptions, 'operationId' | 'inputPayloadJson' | 'sourceManifestJson'> = {},
): Promise<WorkflowCreated> {
  const strict = prepared.targetHintJson?.generationSource === 'ai_co_creation';
  return aiWorkflowService.createBackground({
    ...prepared,
    operationId: options.operationId,
    inputPayloadJson: { ...prepared.inputPayloadJson, ...options.inputPayloadJson },
    sourceManifestJson: workflowManifest(
      prepared.sourceManifestJson,
      options.sourceManifestJson,
      strict,
    ),
  });
}

export const outlineGenerateService = {
  compileNovelOutline: compileNovelOutlineWorkflow,
  compileVolumeOutline: compileVolumeOutlineWorkflow,
  compileChapterOutlines: compileChapterOutlinesWorkflow,
  submitPrepared: submitPreparedOutlineWorkflow,

  async submitNovelOutline(novelId: string, options: OutlineWorkflowOptions = {}): Promise<WorkflowCreated> {
    const prepared = await compileNovelOutlineWorkflow(novelId, options);
    return submitPreparedOutlineWorkflow(prepared, options);
  },

  async submitVolumeOutline(input: {
    novelId: string; volumeTitle?: string; volumeId?: string;
  } & OutlineWorkflowOptions): Promise<WorkflowCreated> {
    const prepared = await compileVolumeOutlineWorkflow(input);
    return submitPreparedOutlineWorkflow(prepared, input);
  },

  async submitChapterOutlines(input: {
    novelId: string; volumeId?: string; chapterId?: string; chapterTitle?: string;
    chapterGoal?: string; chapterCount?: number;
  } & OutlineWorkflowOptions): Promise<WorkflowCreated> {
    const prepared = await compileChapterOutlinesWorkflow(input);
    return submitPreparedOutlineWorkflow(prepared, input);
  },

  async generateNovelOutline(novelId: string): Promise<string> {
    const settings = aiSettingsService.getSettings();
    const context = await buildOutlineContext(novelId);
    const request = buildOutlineGeneratePrompt(context);
    const task = await aiTaskService.create('outline_generate', {
      novelId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `生成作品总大纲：${context.novelTitle}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: response.text,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });
      return response.text;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '作品大纲生成失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },

  async generateVolumeOutline(input: { novelId: string; volumeTitle?: string }): Promise<VolumeOutlineCandidate> {
    const settings = aiSettingsService.getSettings();
    const context = await buildOutlineContext(input.novelId);
    const request = buildVolumeOutlineGeneratePrompt({
      novelTitle: context.novelTitle,
      novelGenre: context.novelGenre,
      description: context.description,
      worldBackground: context.worldBackground,
      ruleSystems: context.ruleSystems,
      protagonist: context.protagonist,
      specialAbility: context.specialAbility,
      existingVolumes: context.existingVolumes,
      existingChapters: context.existingChapters,
      volumeTitle: input.volumeTitle,
      activeMasterOutline: context.activeMasterOutline,
      styleSummary: context.styleSummary,
    });
    const task = await aiTaskService.create('volume_outline_generate', {
      novelId: input.novelId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `生成分卷大纲：${input.volumeTitle || context.novelTitle}${context.activeMasterOutline ? '（已结合总纲）' : '（⚠️ 缺少总纲）'}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const parsed = safeJsonParse<Partial<VolumeOutlineCandidate>>(response.text, {});
      const result: VolumeOutlineCandidate = {
        title: parsed.title?.trim() || input.volumeTitle || '新分卷',
        summary: parsed.summary?.trim() || response.text.slice(0, 1000),
        goal: parsed.goal,
        mainConflict: parsed.mainConflict,
        rawText: response.text,
      };
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `${result.title}：${result.summary}${context.activeMasterOutlineId ? ` [使用总纲:${context.activeMasterOutlineId.slice(0, 8)}]` : ''}`,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });
      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '分卷大纲生成失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },

  async generateChapterOutlines(input: {
    novelId: string;
    volumeId?: string;
    chapterId?: string;
    chapterTitle?: string;
    chapterGoal?: string;
    chapterCount?: number;
  }): Promise<ChapterOutlineCandidate[]> {
    const settings = aiSettingsService.getSettings();
    const [context, volume] = await Promise.all([
      buildOutlineContext(input.novelId, input.volumeId),
      input.volumeId ? volumeRepository.getById(input.volumeId).catch(() => null) : Promise.resolve(null),
    ]);
    const request = buildChapterOutlineGeneratePrompt({
      novelTitle: context.novelTitle,
      novelGenre: context.novelGenre,
      description: context.description,
      worldBackground: context.worldBackground,
      ruleSystems: context.ruleSystems,
      protagonist: context.protagonist,
      specialAbility: context.specialAbility,
      existingVolumes: context.existingVolumes,
      existingChapters: context.existingChapters,
      volumeTitle: volume?.title || context.novelTitle,
      volumeSummary: volume?.summary || volume?.goal,
      currentChapterTitle: input.chapterTitle,
      currentChapterGoal: input.chapterGoal,
      chapterCount: input.chapterCount,
      activeMasterOutline: context.activeMasterOutline,
      activeVolumeOutline: context.activeVolumeOutline,
      styleSummary: context.styleSummary,
    });

    const parentInfo: string[] = [];
    if (context.activeMasterOutline) parentInfo.push('有总纲');
    if (context.activeVolumeOutline) parentInfo.push('有分卷大纲');
    const parentTag = parentInfo.length > 0 ? `（${parentInfo.join('、')}）` : '（⚠️ 无上级大纲）';

    const task = await aiTaskService.create('chapter_outline_generate', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `生成章节大纲：${input.chapterTitle || volume?.title || context.novelTitle}${parentTag}${input.chapterGoal ? '，有本章目标' : ''}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const parsed = safeJsonParse<{ chapters: ChapterOutlineCandidate[] }>(response.text, { chapters: [] });
      const chapters = Array.isArray(parsed.chapters)
        ? parsed.chapters.filter((item) => item.title && item.outline).map((item) => ({
          ...item,
          targetWordCount: (Number.isFinite(item.targetWordCount) && (item.targetWordCount as number) > 0) ? item.targetWordCount : undefined,
        }))
        : [];

      const usedOutlines: string[] = [];
      if (context.activeMasterOutlineId) usedOutlines.push(`总纲:${context.activeMasterOutlineId.slice(0, 8)}`);
      if (context.activeVolumeOutlineId) usedOutlines.push(`分卷大纲:${context.activeVolumeOutlineId.slice(0, 8)}`);

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: chapters.length > 0
          ? `生成了 ${chapters.length} 个章节大纲${usedOutlines.length > 0 ? ` [${usedOutlines.join(', ')}]` : ''}`
          : response.text,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      if (chapters.length > 0) return chapters;
      return [{
        title: 'AI 原始返回',
        outline: response.text.slice(0, 1000),
        targetWordCount: 4000,
        rawText: response.text,
      }];
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '章节大纲生成失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },
};
