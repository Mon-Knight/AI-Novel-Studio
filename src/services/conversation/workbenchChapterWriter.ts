import { aiSettingsService } from '../ai/aiClient';
import {
  resolveSessionModelApiKeyAsync,
  type SessionModelCredentialIdentity,
} from '../ai/aiSettingsStore';
import { executeChapterGeneration } from '../ai/chapterGenerationExecutionService';
import { draftVersionService } from '../database/draftVersionService';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import {
  buildChapterIntegrityRepairProviderInstruction,
  buildChapterIntegrityRepairRequest,
  buildChapterLengthRepairProviderInstruction,
  buildChapterLengthRepairRequest,
  buildSnapshotProviderInstruction,
  buildSnapshotGenerateRequest,
} from '../generation/chapterGenerationPipeline';
import {
  inspectChapterCandidateIntegrity,
  type ChapterCandidateIntegrityIssueCode,
} from '../generation/chapterCandidateIntegrity';
import { buildChapterProviderContextSources } from '../generation/chapterProviderContext';
import { generationContextCompiler } from '../generation/generationContextCompiler';
import {
  resolveGenerationProfiles,
  type ResolvedGenerationProfiles,
} from '../styles/generationProfileResolver';
import { validateCandidateText } from '../agent-tools/candidateValidation';
import { generateId } from '../database/db';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { countTextWords } from '../../utils/contentHash';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { AiProvider, AiSettings } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import type { AiProviderRequestEvidence } from '../ai/aiExecutionPipeline';
import type {
  AdoptedPreviousChapterContext,
  GenerationContextSource,
} from '../../types/generationContext';

export interface WorkbenchChapterWriteInput {
  novelId: string;
  chapterId: string;
  goal: string;
  mode: 'generate' | 'polish';
  previousCandidateText?: string;
  memoryContext?: unknown;
  modelSnapshot: TaskModelSnapshot;
  signal?: AbortSignal;
  onProgress?: (progress: WorkbenchChapterWriterProgress) => void | Promise<void>;
}

export type WorkbenchChapterWriterProgressPhase =
  | 'compiling_context'
  | 'generating_draft'
  | 'repairing_length'
  | 'repairing_integrity'
  | 'validating_candidate';

export interface WorkbenchChapterWriterProgress {
  phase: WorkbenchChapterWriterProgressPhase;
  repairAttempt?: number;
  repairMaximumAttempts?: number;
  currentWordCount?: number;
  acceptedWordRange?: {
    minimum: number;
    maximum: number;
  };
  timestamp: string;
}

export interface WorkbenchChapterWriteResult {
  text: string;
  source: 'writer';
  taskId?: string;
  artifactId?: string;
  contextHash?: string;
  continuitySourceHash?: string;
  continuitySourceChapterId?: string;
  contextSources?: Array<Pick<GenerationContextSource, 'type' | 'title' | 'status'>>;
  targetWordCount?: number;
  originalWordCount?: number;
  finalWordCount?: number;
  lengthRepairCount?: number;
  integrityRepairCount?: number;
  integrityRepairAttempts?: WorkbenchIntegrityRepairAttemptEvidence[];
  providerRequestEvidence?: WorkbenchProviderRequestEvidence;
  resolvedSettings?: AiSettings;
}

export interface WorkbenchIntegrityRepairAttemptEvidence {
  attempt: number;
  issueCodes: ChapterCandidateIntegrityIssueCode[];
  sourceContentHash: string;
}

export interface WorkbenchProviderRequestEvidence {
  schemaVersion: 'workbench_provider_request_evidence_v1';
  hashAlgorithm: 'sha256';
  messagesSerialization: 'json_stringify_messages_v1';
  taskId?: string;
  attemptId?: string;
  messagesSha256: string;
  messageCount: number;
  compiledContextSha256: string;
  snapshotContextHash: string;
  snapshotCompiledPromptSha256: string;
  snapshotRequestSourceSha256: string;
  includedSnapshotRequestSourceSha256?: string;
  snapshotRequestSourceStatus: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  providerSourceStatus?: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget';
  generationSourceStatuses?: Record<
    string,
    'included' | 'truncated' | 'omitted_empty' | 'omitted_budget'
  >;
}

export interface WorkbenchChapterWriterDependencies {
  executeGeneration?: typeof executeChapterGeneration;
  compileContext?: typeof generationContextCompiler.compile;
  getSettings?: () => AiSettings;
  resolveApiKey?: (identity: SessionModelCredentialIdentity) => string | Promise<string>;
  loadAdoptedPreviousChapter?: (
    novelId: string,
    chapterId: string,
  ) => Promise<PreviousChapterContinuityResolution>;
  resolveGenerationProfiles?: (novelId: string) => Promise<ResolvedGenerationProfiles>;
}

export type PreviousChapterContinuityResolution =
  | { status: 'none' }
  | { status: 'adopted'; context: AdoptedPreviousChapterContext }
  | { status: 'not_adopted'; chapterId: string }
  | { status: 'content_unavailable'; chapterId: string; draftId?: string };

const MAX_LENGTH_REPAIR_ATTEMPTS = 3;
const MAX_INTEGRITY_REPAIR_ATTEMPTS = 2;

export function resolveChapterWordRange(targetWordCount: number | undefined):
  | {
      target: number;
      minimum: number;
      maximum: number;
      fallbackMinimum: number;
      fallbackMaximum: number;
      finalMinimum: number;
      finalMaximum: number;
      hardMinimum: number;
      hardMaximum: number;
    }
  | undefined {
  if (!Number.isFinite(targetWordCount) || (targetWordCount ?? 0) <= 0) return undefined;
  const target = Math.round(targetWordCount!);
  return {
    target,
    minimum: Math.max(1, Math.floor(target * 0.9)),
    // Repair toward a deliberately tighter range, so normal model variance
    // still lands below the final hard ceiling without truncating the ending.
    maximum: Math.max(1, Math.floor((target * 105) / 100)),
    // If the first repair still misses the hard ceiling, the final retry needs
    // enough headroom for normal model variance to converge deterministically.
    fallbackMinimum: Math.max(1, Math.floor((target * 85) / 100)),
    fallbackMaximum: Math.max(1, Math.floor((target * 95) / 100)),
    // A rare third pass is cheaper than discarding an otherwise valid full
    // chapter when a provider repeatedly overshoots by only a small margin.
    finalMinimum: Math.max(1, Math.floor((target * 80) / 100)),
    finalMaximum: Math.max(1, Math.floor((target * 90) / 100)),
    hardMinimum: Math.max(1, Math.floor((target * 80) / 100)),
    // The final hard ceiling leaves a natural-ending margin after the repair
    // prompt has already targeted the tighter range.
    hardMaximum: Math.max(1, Math.floor((target * 115) / 100)),
  };
}

type ChapterLengthRepairDirection = 'expand' | 'compress';

function isChapterWordCountOutOfRange(
  wordRange: NonNullable<ReturnType<typeof resolveChapterWordRange>>,
  wordCount: number,
): boolean {
  return wordCount < wordRange.hardMinimum || wordCount > wordRange.hardMaximum;
}

function resolveChapterLengthRepairRange(
  wordRange: NonNullable<ReturnType<typeof resolveChapterWordRange>>,
  currentWordCount: number,
  repairAttempt: number,
): { minimum: number; maximum: number; direction: ChapterLengthRepairDirection } {
  if (currentWordCount < wordRange.hardMinimum) {
    if (repairAttempt === 1) {
      return {
        minimum: wordRange.minimum,
        maximum: wordRange.maximum,
        direction: 'expand',
      };
    }
    if (repairAttempt === 2) {
      return {
        minimum: Math.max(1, Math.floor((wordRange.target * 95) / 100)),
        maximum: Math.max(1, Math.floor((wordRange.target * 110) / 100)),
        direction: 'expand',
      };
    }
    return {
      minimum: wordRange.target,
      maximum: wordRange.hardMaximum,
      direction: 'expand',
    };
  }

  const compressionRange =
    repairAttempt === 1
      ? { minimum: wordRange.minimum, maximum: wordRange.maximum }
      : repairAttempt === 2
        ? { minimum: wordRange.fallbackMinimum, maximum: wordRange.fallbackMaximum }
        : { minimum: wordRange.finalMinimum, maximum: wordRange.finalMaximum };
  return { ...compressionRange, direction: 'compress' };
}

function workbenchWriterError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function compareChapterOrder(left: Chapter, right: Chapter): number {
  return (
    left.orderIndex - right.orderIndex ||
    left.sortOrder - right.sortOrder ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function findPreviousChapterForContinuity(
  chapters: readonly Chapter[],
  volumes: readonly Volume[],
  chapterId: string,
): Chapter | undefined {
  const current = chapters.find((chapter) => chapter.id === chapterId);
  if (!current) return undefined;

  const siblings = chapters
    .filter((chapter) => (chapter.volumeId ?? '') === (current.volumeId ?? ''))
    .sort(compareChapterOrder);
  const siblingIndex = siblings.findIndex((chapter) => chapter.id === current.id);
  if (siblingIndex > 0) return siblings[siblingIndex - 1];
  if (!current.volumeId) return undefined;

  const orderedVolumes = [...volumes].sort(
    (left, right) =>
      left.orderIndex - right.orderIndex ||
      left.sortOrder - right.sortOrder ||
      left.id.localeCompare(right.id),
  );
  const volumeIndex = orderedVolumes.findIndex((volume) => volume.id === current.volumeId);
  if (volumeIndex <= 0) return undefined;

  for (let index = volumeIndex - 1; index >= 0; index -= 1) {
    const candidates = chapters
      .filter((chapter) => chapter.volumeId === orderedVolumes[index].id)
      .sort(compareChapterOrder);
    if (candidates.length > 0) return candidates[candidates.length - 1];
  }
  return undefined;
}

async function loadAdoptedPreviousChapter(
  novelId: string,
  chapterId: string,
): Promise<PreviousChapterContinuityResolution> {
  const [chapters, volumes] = await Promise.all([
    chapterRepository.getByNovelId(novelId),
    volumeRepository.getByNovelId(novelId),
  ]);
  if (!chapters.some((chapter) => chapter.id === chapterId)) {
    throw workbenchWriterError('WORKBENCH_CHAPTER_NOT_FOUND', '目标章节不存在，无法生成正文。');
  }
  const previousChapter = findPreviousChapterForContinuity(chapters, volumes, chapterId);
  if (!previousChapter) return { status: 'none' };
  const adopted = await draftVersionService.getAdoptedByChapterId(previousChapter.id);
  if (!adopted?.isAdopted) {
    return { status: 'not_adopted', chapterId: previousChapter.id };
  }
  const content = adopted?.content ?? '';
  if (!content.trim()) {
    return {
      status: 'content_unavailable',
      chapterId: previousChapter.id,
      draftId: adopted.id,
    };
  }
  const contentHash =
    adopted.contentState?.status === 'ready' &&
    /^[0-9a-f]{64}$/i.test(adopted.contentState.contentHash)
      ? adopted.contentState.contentHash
      : await computeContentSha256(content);
  return {
    status: 'adopted',
    context: {
      chapterId: previousChapter.id,
      draftId: adopted.id,
      contentHash,
      content,
    },
  };
}

function providerFromSnapshot(snapshot: TaskModelSnapshot): AiProvider {
  if (snapshot.runtimeMode === 'mock') return 'mock';
  return snapshot.providerId === 'deepseek' || snapshot.providerId === 'deepseek-official'
    ? 'deepseek'
    : 'openai_compatible';
}

function formatMemoryContext(memoryContext: unknown): string {
  if (!memoryContext || typeof memoryContext !== 'object') return '';
  const record = memoryContext as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.results)
      ? record.results
      : Array.isArray(record.matches)
        ? record.matches
        : [];
  if (items.length === 0) return '';
  const lines = items
    .slice(0, 5)
    .map((item, idx) => {
      if (typeof item === 'string') return `${idx + 1}. ${item}`;
      if (item && typeof item === 'object') {
        const itemRecord = item as Record<string, unknown>;
        const content = itemRecord.content || itemRecord.text || itemRecord.summary || '';
        return `${idx + 1}. ${String(content)}`;
      }
      return '';
    })
    .filter(Boolean);
  return lines.join('\n');
}

async function linkProviderRequestEvidence(
  snapshot: Awaited<ReturnType<typeof generationContextCompiler.compile>>,
  requestSourceVersion: string,
  evidence: AiProviderRequestEvidence | undefined,
  identity: { taskId?: string; attemptId?: string },
  currentDraftVersion?: string,
): Promise<WorkbenchProviderRequestEvidence | undefined> {
  if (!evidence) return undefined;
  const snapshotSource = evidence.requestContextSources.find(
    (source) => source.sourceVersion === requestSourceVersion,
  );
  if (!snapshotSource) return undefined;
  const providerSources = evidence.sources ?? [];
  const strictestStatus = (
    statuses: Array<'included' | 'truncated' | 'omitted_empty' | 'omitted_budget'>,
  ) => {
    if (statuses.includes('omitted_budget')) return 'omitted_budget' as const;
    if (statuses.includes('omitted_empty')) return 'omitted_empty' as const;
    if (statuses.includes('truncated')) return 'truncated' as const;
    return statuses.length > 0 ? ('included' as const) : undefined;
  };
  const generationSourceStatuses: WorkbenchProviderRequestEvidence['generationSourceStatuses'] = {};
  const mergeGenerationStatus = (
    sourceType: string,
    status: 'included' | 'truncated' | 'omitted_empty' | 'omitted_budget',
  ) => {
    const current = generationSourceStatuses[sourceType];
    generationSourceStatuses[sourceType] = strictestStatus(current ? [current, status] : [status])!;
  };
  for (const section of snapshot.compiledContext.sections) {
    const providerSource = providerSources.find(
      (source) => source.sourceVersion === snapshot.contextHash && source.label === section.title,
    );
    if (!providerSource) continue;
    for (const sourceType of section.sourceTypes) {
      mergeGenerationStatus(sourceType, providerSource.status);
    }
  }
  const requestProviderSource = providerSources.find(
    (source) =>
      source.sourceType === 'request_context' && source.sourceVersion === requestSourceVersion,
  );
  if (requestProviderSource) {
    mergeGenerationStatus('user_instruction', requestProviderSource.status);
  }
  if (currentDraftVersion) {
    const draftProviderSource = providerSources.find(
      (source) =>
        source.sourceType === 'draft' &&
        source.sourceVersion === currentDraftVersion &&
        source.label === 'Current chapter repair draft',
    );
    if (draftProviderSource) {
      mergeGenerationStatus('current_editor', draftProviderSource.status);
    }
  }
  return {
    schemaVersion: 'workbench_provider_request_evidence_v1',
    hashAlgorithm: evidence.hashAlgorithm,
    messagesSerialization: evidence.messagesSerialization,
    ...(identity.taskId ? { taskId: identity.taskId } : {}),
    ...(identity.attemptId ? { attemptId: identity.attemptId } : {}),
    messagesSha256: evidence.messagesSha256,
    messageCount: evidence.messageCount,
    compiledContextSha256: evidence.compiledContextSha256,
    snapshotContextHash: snapshot.contextHash,
    snapshotCompiledPromptSha256: await computeContentSha256(
      snapshot.compiledPromptText.replace(/\r\n?/g, '\n').trim(),
    ),
    snapshotRequestSourceSha256: snapshotSource.contentSha256,
    ...(snapshotSource.includedSha256
      ? { includedSnapshotRequestSourceSha256: snapshotSource.includedSha256 }
      : {}),
    snapshotRequestSourceStatus: snapshotSource.status,
    ...(strictestStatus(providerSources.map((source) => source.status))
      ? { providerSourceStatus: strictestStatus(providerSources.map((source) => source.status)) }
      : {}),
    ...(Object.keys(generationSourceStatuses).length > 0 ? { generationSourceStatuses } : {}),
  };
}

export function createWorkbenchChapterWriter(deps: WorkbenchChapterWriterDependencies = {}) {
  const executeGen = deps.executeGeneration ?? executeChapterGeneration;
  const compileCtx =
    deps.compileContext ?? ((input) => generationContextCompiler.compileAndSave(input));
  const getAiSettings = deps.getSettings ?? (() => aiSettingsService.getSettings());
  const resolveApiKey = deps.resolveApiKey ?? resolveSessionModelApiKeyAsync;
  const resolveAdoptedPreviousChapter =
    deps.loadAdoptedPreviousChapter ?? loadAdoptedPreviousChapter;
  const resolveProfiles = deps.resolveGenerationProfiles ?? resolveGenerationProfiles;

  async function generate(input: WorkbenchChapterWriteInput): Promise<WorkbenchChapterWriteResult> {
    if (!input.modelSnapshot) {
      throw new Error('写章调用缺少必要的 modelSnapshot 冻结快照参数。');
    }

    const reportProgress = async (
      progress: Omit<WorkbenchChapterWriterProgress, 'timestamp'>,
    ): Promise<void> => {
      await input.onProgress?.({ ...progress, timestamp: new Date().toISOString() });
    };

    await reportProgress({ phase: 'compiling_context' });

    const [previousChapterResolution, resolvedProfiles] = await Promise.all([
      resolveAdoptedPreviousChapter(input.novelId, input.chapterId),
      resolveProfiles(input.novelId),
    ]);
    if (previousChapterResolution.status === 'not_adopted') {
      throw workbenchWriterError(
        'WORKBENCH_PREVIOUS_CHAPTER_NOT_ADOPTED',
        '上一章尚未采用为正式正文。请先完成上一章审阅与采用，再继续生成。',
      );
    }
    if (previousChapterResolution.status === 'content_unavailable') {
      throw workbenchWriterError(
        'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE',
        '上一章的已采用正文为空或不可读取。请先恢复正文，再继续生成。',
      );
    }
    const adoptedPreviousChapter =
      previousChapterResolution.status === 'adopted'
        ? previousChapterResolution.context
        : undefined;

    const memoryText = formatMemoryContext(input.memoryContext);
    let sourceText = input.previousCandidateText?.trim();
    if (!sourceText && input.mode === 'polish') {
      const adopted = await draftVersionService.getAdoptedByChapterId(input.chapterId);
      sourceText = adopted?.content?.trim();
    }

    if (input.mode === 'polish' && !sourceText) {
      const error = new Error('当前章节没有可润色的正文。请先生成一版正文。') as Error & {
        code: string;
      };
      error.code = 'WORKBENCH_POLISH_SOURCE_MISSING';
      throw error;
    }

    const snapshot = await compileCtx({
      novelId: input.novelId,
      chapterId: input.chapterId,
      userInstruction: input.goal,
      retrievedMemoryContext: memoryText || undefined,
      currentEditorContent: sourceText,
      styleProfileId: resolvedProfiles.styleProfileId,
      outputProfileId: resolvedProfiles.outputProfileId,
      requireCoreAssets: true,
      adoptedPreviousChapter,
    });
    const targetWordCount =
      snapshot.compiledContext?.baseContext?.targetWordCount ??
      snapshot.compiledContext?.activeEngineeringState?.chapterCard.targetWordCount;
    const wordRange = resolveChapterWordRange(targetWordCount);
    const request = buildSnapshotGenerateRequest(snapshot);
    const currentDraftVersion = sourceText ? await computeContentSha256(sourceText) : undefined;
    const compilationSources = buildChapterProviderContextSources({
      snapshot,
      requestSourceVersion: snapshot.contextHash,
      requestInstruction: buildSnapshotProviderInstruction(snapshot),
      ...(sourceText && currentDraftVersion
        ? { currentDraft: { content: sourceText, sourceVersion: currentDraftVersion } }
        : {}),
    });

    // 严格依据冻结快照派生配置，严禁从全局当前设置漂移
    const baseSettings = getAiSettings();
    const snapshotModel = input.modelSnapshot;

    let apiKey = '';
    if (snapshotModel.runtimeMode === 'api') {
      if (!snapshotModel.baseUrl?.trim()) {
        throw new Error('冻结模型快照缺少 API Base URL，拒绝使用后来修改的全局设置。');
      }
      apiKey = await resolveApiKey({
        scope: 'provider',
        providerId: snapshotModel.providerId,
        baseUrl: snapshotModel.baseUrl,
        modelId: snapshotModel.modelId,
      });
      if (!apiKey) {
        throw new Error(
          `无法获取冻结模型 Provider (${snapshotModel.providerId}) 对应的 API 安全凭据。`,
        );
      }
    }

    const settings: AiSettings = {
      ...baseSettings,
      provider: providerFromSnapshot(snapshotModel),
      modelName: snapshotModel.modelId,
      runtimeMode: snapshotModel.runtimeMode,
      baseUrl: snapshotModel.runtimeMode === 'mock' ? '' : snapshotModel.baseUrl!,
      apiKey,
      temperature:
        typeof snapshotModel.options?.temperature === 'number'
          ? snapshotModel.options.temperature
          : 0.7,
      maxTokens:
        typeof snapshotModel.options?.maxTokens === 'number'
          ? snapshotModel.options.maxTokens
          : 4000,
      timeoutSeconds:
        typeof snapshotModel.options?.timeoutSeconds === 'number'
          ? snapshotModel.options.timeoutSeconds
          : 120,
      inputPricePerMillionTokens: snapshotModel.pricing?.inputPricePerMillionTokens,
      outputPricePerMillionTokens: snapshotModel.pricing?.outputPricePerMillionTokens,
    };

    // A Workbench task freezes one model for every chapter-generation role.
    // Optional specialist endpoints from later global settings must not re-enter
    // Scene/Beat routing for this run.
    delete settings.localChapterModel;
    delete settings.gateway;
    delete settings.remoteWriter;

    const operationId = 'workbench-write-' + generateId();

    await reportProgress({
      phase: 'generating_draft',
      ...(wordRange
        ? {
            acceptedWordRange: {
              minimum: wordRange.hardMinimum,
              maximum: wordRange.hardMaximum,
            },
          }
        : {}),
    });

    let result = await executeGen({
      novelId: input.novelId,
      chapterId: input.chapterId,
      operationId,
      settings,
      request,
      sourceId: input.chapterId + ':' + operationId,
      sourceVersion: snapshot.contextHash ?? '',
      compilationSources,
      taskInput: {
        chapterTitle:
          snapshot.compiledContext?.baseContext?.chapterTitle ??
          snapshot.sources?.find((s) => s.type === 'chapter_outline')?.title ??
          '未命名章节',
        contextHash: snapshot.contextHash ?? '',
        targetWordCount: snapshot.compiledContext?.baseContext?.targetWordCount ?? 2000,
        mode: input.mode === 'polish' || Boolean(sourceText) ? 'rewrite' : 'new',
        userGoal: input.goal,
        novelId: input.novelId,
        chapterId: input.chapterId,
        purpose: 'workbench_chapter_candidate',
      },
      signal: input.signal,
    });
    let providerRequestEvidence = await linkProviderRequestEvidence(
      snapshot,
      snapshot.contextHash,
      result.providerRequestEvidence,
      { taskId: result.taskId, attemptId: result.attemptId },
      currentDraftVersion,
    );

    const originalWordCount = countTextWords(result.text);
    let finalWordCount = originalWordCount;
    let lengthRepairCount = 0;
    while (
      wordRange &&
      isChapterWordCountOutOfRange(wordRange, finalWordCount) &&
      lengthRepairCount < MAX_LENGTH_REPAIR_ATTEMPTS
    ) {
      lengthRepairCount += 1;
      const repairRange = resolveChapterLengthRepairRange(
        wordRange,
        finalWordCount,
        lengthRepairCount,
      );
      const repairSourceText = result.text.trim();
      const repairSourceHash = await computeContentSha256(repairSourceText);
      const repairOperationId = `${operationId}:length-repair:${lengthRepairCount}`;
      await reportProgress({
        phase: 'repairing_length',
        repairAttempt: lengthRepairCount,
        repairMaximumAttempts: MAX_LENGTH_REPAIR_ATTEMPTS,
        currentWordCount: finalWordCount,
        acceptedWordRange: {
          minimum: wordRange.hardMinimum,
          maximum: wordRange.hardMaximum,
        },
      });
      const repairRequestInput = {
        chapterTitle: snapshot.compiledContext?.baseContext?.chapterTitle ?? '未命名章节',
        text: repairSourceText,
        snapshotCompiledPromptText: snapshot.compiledPromptText,
        currentWordCount: finalWordCount,
        targetWordCount: wordRange.target,
        minimumWordCount: repairRange.minimum,
        maximumWordCount: repairRange.maximum,
        repairAttempt: lengthRepairCount,
        contextHash: snapshot.contextHash ?? '',
      };
      result = await executeGen({
        novelId: input.novelId,
        chapterId: input.chapterId,
        operationId: repairOperationId,
        settings,
        request: buildChapterLengthRepairRequest(repairRequestInput),
        sourceId: `${input.chapterId}:${repairOperationId}`,
        sourceVersion: repairSourceHash,
        compilationSources: buildChapterProviderContextSources({
          snapshot,
          requestSourceVersion: repairSourceHash,
          requestInstruction: buildChapterLengthRepairProviderInstruction(repairRequestInput),
          currentDraft: {
            content: repairSourceText,
            sourceVersion: repairSourceHash,
          },
        }),
        taskInput: {
          chapterTitle: snapshot.compiledContext?.baseContext?.chapterTitle ?? '未命名章节',
          contextHash: snapshot.contextHash ?? '',
          sourceContentHash: repairSourceHash,
          sourceArtifactId: result.artifactBundle?.artifact.artifactId,
          sourceWordCount: finalWordCount,
          targetWordCount: wordRange.target,
          minimumWordCount: repairRange.minimum,
          maximumWordCount: repairRange.maximum,
          repairAttempt: lengthRepairCount,
          lengthRepairDirection: repairRange.direction,
          mode: 'rewrite',
          userGoal: input.goal,
          novelId: input.novelId,
          chapterId: input.chapterId,
          purpose: 'workbench_chapter_length_repair',
        },
        signal: input.signal,
      });
      providerRequestEvidence = await linkProviderRequestEvidence(
        snapshot,
        repairSourceHash,
        result.providerRequestEvidence,
        { taskId: result.taskId, attemptId: result.attemptId },
        repairSourceHash,
      );
      finalWordCount = countTextWords(result.text);
    }

    let integrityRepairCount = 0;
    const integrityRepairAttempts: WorkbenchIntegrityRepairAttemptEvidence[] = [];
    let integrityIssues = inspectChapterCandidateIntegrity({
      candidateText: result.text,
      previousChapterText: adoptedPreviousChapter?.content,
    });
    while (integrityIssues.length > 0 && integrityRepairCount < MAX_INTEGRITY_REPAIR_ATTEMPTS) {
      integrityRepairCount += 1;
      const repairSourceText = result.text.trim();
      const repairSourceHash = await computeContentSha256(repairSourceText);
      const repairIssueCodes = [...new Set(integrityIssues.map((issue) => issue.code))].sort();
      integrityRepairAttempts.push({
        attempt: integrityRepairCount,
        issueCodes: repairIssueCodes,
        sourceContentHash: repairSourceHash,
      });
      const repairOperationId = `${operationId}:integrity-repair:${integrityRepairCount}`;
      const integrityTargetWordCount = wordRange?.target ?? Math.max(1, finalWordCount);
      const integrityMinimumWordCount =
        wordRange?.minimum ?? Math.max(1, Math.floor(integrityTargetWordCount * 0.8));
      const integrityMaximumWordCount =
        wordRange?.hardMaximum ?? Math.max(1, Math.ceil(integrityTargetWordCount * 1.2));
      await reportProgress({
        phase: 'repairing_integrity',
        repairAttempt: integrityRepairCount,
        repairMaximumAttempts: MAX_INTEGRITY_REPAIR_ATTEMPTS,
        currentWordCount: finalWordCount,
        acceptedWordRange: {
          minimum: wordRange?.hardMinimum ?? integrityMinimumWordCount,
          maximum: integrityMaximumWordCount,
        },
      });
      const repairRequestInput = {
        chapterTitle: snapshot.compiledContext?.baseContext?.chapterTitle ?? '未命名章节',
        text: repairSourceText,
        snapshotCompiledPromptText: snapshot.compiledPromptText,
        contextHash: snapshot.contextHash ?? '',
        issueCodes: repairIssueCodes,
        targetWordCount: integrityTargetWordCount,
        minimumWordCount: integrityMinimumWordCount,
        maximumWordCount: integrityMaximumWordCount,
      };
      result = await executeGen({
        novelId: input.novelId,
        chapterId: input.chapterId,
        operationId: repairOperationId,
        settings,
        request: buildChapterIntegrityRepairRequest(repairRequestInput),
        sourceId: `${input.chapterId}:${repairOperationId}`,
        sourceVersion: repairSourceHash,
        compilationSources: buildChapterProviderContextSources({
          snapshot,
          requestSourceVersion: repairSourceHash,
          requestInstruction: buildChapterIntegrityRepairProviderInstruction(repairRequestInput),
          currentDraft: {
            content: repairSourceText,
            sourceVersion: repairSourceHash,
          },
        }),
        taskInput: {
          chapterTitle: snapshot.compiledContext?.baseContext?.chapterTitle ?? '未命名章节',
          contextHash: snapshot.contextHash ?? '',
          sourceContentHash: repairSourceHash,
          sourceArtifactId: result.artifactBundle?.artifact.artifactId,
          sourceWordCount: finalWordCount,
          targetWordCount: integrityTargetWordCount,
          minimumWordCount: integrityMinimumWordCount,
          maximumWordCount: integrityMaximumWordCount,
          issueCodes: repairRequestInput.issueCodes,
          integrityRepairAttempt: integrityRepairCount,
          mode: 'rewrite',
          userGoal: input.goal,
          novelId: input.novelId,
          chapterId: input.chapterId,
          purpose: 'workbench_chapter_integrity_repair',
        },
        signal: input.signal,
      });
      providerRequestEvidence = await linkProviderRequestEvidence(
        snapshot,
        repairSourceHash,
        result.providerRequestEvidence,
        { taskId: result.taskId, attemptId: result.attemptId },
        repairSourceHash,
      );
      finalWordCount = countTextWords(result.text);
      integrityIssues = inspectChapterCandidateIntegrity({
        candidateText: result.text,
        previousChapterText: adoptedPreviousChapter?.content,
      });
    }

    await reportProgress({
      phase: 'validating_candidate',
      currentWordCount: finalWordCount,
      ...(wordRange
        ? {
            acceptedWordRange: {
              minimum: wordRange.hardMinimum,
              maximum: wordRange.hardMaximum,
            },
          }
        : {}),
    });

    if (integrityIssues.length > 0) {
      throw workbenchWriterError(
        'WORKBENCH_CHAPTER_INTEGRITY_FAILED',
        `章节候选在 ${MAX_INTEGRITY_REPAIR_ATTEMPTS} 次完整性修复后仍未通过：${integrityIssues
          .map((issue) => issue.code)
          .join(', ')}。请重试本回合。`,
      );
    }

    if (wordRange && isChapterWordCountOutOfRange(wordRange, finalWordCount)) {
      throw workbenchWriterError(
        'WORKBENCH_CHAPTER_LENGTH_OUT_OF_RANGE',
        `章节候选在 ${MAX_LENGTH_REPAIR_ATTEMPTS} 次长度收敛后仍为 ${finalWordCount} 字，未落入允许范围 ${wordRange.hardMinimum}-${wordRange.hardMaximum} 字。请重试本回合。`,
      );
    }

    const text = validateCandidateText('chapter_text', result.text);
    return {
      text,
      source: 'writer',
      taskId: result.taskId,
      artifactId: result.artifactBundle?.artifact.artifactId,
      contextHash: snapshot.contextHash,
      continuitySourceHash: adoptedPreviousChapter?.contentHash,
      continuitySourceChapterId: adoptedPreviousChapter?.chapterId,
      contextSources: snapshot.sources.map(({ type, title, status }) => ({
        type,
        title,
        status,
      })),
      targetWordCount: wordRange?.target,
      originalWordCount,
      finalWordCount,
      lengthRepairCount,
      integrityRepairCount,
      integrityRepairAttempts,
      providerRequestEvidence,
      resolvedSettings: settings,
    };
  }

  return { generate };
}

export const workbenchChapterWriter = createWorkbenchChapterWriter();

export async function writeWorkbenchChapterCandidate(
  input: WorkbenchChapterWriteInput,
): Promise<WorkbenchChapterWriteResult> {
  return workbenchChapterWriter.generate(input);
}
