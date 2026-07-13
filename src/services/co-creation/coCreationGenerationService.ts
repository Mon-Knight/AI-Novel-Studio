import type {
  CoCreationChapterGenerationHandoffV1,
  CoCreationGenerationReceiptV1,
  CoCreationGenerationRequestV1,
  CoCreationWorkspaceSnapshot,
} from '../../types/coCreation';
import {
  assertCoCreationGenerationRequestIntegrity,
  readCoCreationGenerationRecords,
} from '../../features/co-creation/generationProtocol';
import { buildCoCreationContext } from '../../features/co-creation/contextBuilder';
import {
  outlineGenerateService,
  type PreparedOutlineWorkflow,
} from '../ai/outlineGenerateService';
import { novelRepository } from '../database/novelRepository';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { coCreationSessionService } from './coCreationSessionService';
import { stableCanonicalStringify } from '../ai-tasks/stage3PrerequisiteService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const MAX_COMPILED_GENERATION_CONTEXT_CHARS = 16_000;

function truncateCodePoints(value: string, maxChars: number): string {
  const characters = Array.from(value);
  return characters.length <= maxChars
    ? value
    : `${characters.slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}

function compactGenerationContext(
  context: Awaited<ReturnType<typeof buildCoCreationContext>>,
): string {
  const fieldLines = Object.entries(context.knownFields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, field]) => {
      const renderedValue = typeof field.value === 'string'
        ? field.value
        : stableCanonicalStringify(field.value);
      return `${path} [${field.state}]：${truncateCodePoints(renderedValue, 1_000)}`;
    });
  const recentMessages = context.recentMessages.slice(-4).map((message) => (
    `${message.role}(${message.messageId})：${truncateCodePoints(message.content, 1_000)}`
  ));
  const sections = [
    `优先级：${context.priorityOrder.join(' > ')}`,
    fieldLines.length > 0 ? `结构化字段：\n${fieldLines.join('\n')}` : '',
    context.sessionSummary
      ? `会话摘要：\n${truncateCodePoints(context.sessionSummary, 3_000)}` : '',
    recentMessages.length > 0 ? `最近消息：\n${recentMessages.join('\n')}` : '',
    `当前对象：${truncateCodePoints(stableCanonicalStringify(context.objectContext), 2_000)}`,
  ].filter(Boolean).join('\n\n');
  return truncateCodePoints(sections, MAX_COMPILED_GENERATION_CONTEXT_CHARS);
}

function generationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

type GenerationCompileInput = Pick<CoCreationGenerationRequestV1,
  'kind' | 'novelId' | 'sessionId' | 'volumeId' | 'chapterId' | 'chapterCount'
  | 'additionalInstruction' | 'sourceDraftRevisionId' | 'sourceDraftContentHash'>;

async function validateScope(request: GenerationCompileInput) {
  const novel = await novelRepository.getById(request.novelId);
  if (!novel) throw generationError('TARGET_NOT_FOUND', '生成请求对应的作品不存在');

  const volume = request.volumeId
    ? await volumeRepository.getById(request.volumeId)
    : null;
  if (request.volumeId && (!volume || volume.novelId !== request.novelId)) {
    throw generationError('TARGET_SCOPE_MISMATCH', '目标分卷不属于当前作品');
  }

  const chapter = request.chapterId
    ? await chapterRepository.getById(request.chapterId)
    : null;
  if (request.chapterId && (!chapter || chapter.novelId !== request.novelId)) {
    throw generationError('TARGET_SCOPE_MISMATCH', '目标章节不属于当前作品');
  }
  if (chapter && request.volumeId && chapter.volumeId !== request.volumeId) {
    throw generationError('TARGET_SCOPE_MISMATCH', '目标章节与指定分卷不一致');
  }
  if (request.kind === 'volume_outline' && !volume) {
    throw generationError('TARGET_SCOPE_MISMATCH', '分卷大纲必须指定当前作品中的分卷');
  }
  if (request.kind === 'chapter_outlines' && !chapter && !volume) {
    throw generationError('TARGET_SCOPE_MISMATCH', '章节大纲必须指定当前作品中的章节或分卷');
  }
  if (request.kind === 'chapter_generation_handoff' && !chapter) {
    throw generationError('TARGET_SCOPE_MISMATCH', '章节生成交接必须指定当前作品中的章节');
  }
  return { novel, volume, chapter };
}

function sourceManifest(
  workspace: CoCreationWorkspaceSnapshot,
  request: GenerationCompileInput,
  contextManifest: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [
    ...contextManifest.filter((source) => (
      source.sourceType !== 'co_creation_draft' && source.type !== 'co_creation_draft'
    )),
    {
      type: 'co_creation_session',
      id: workspace.session.sessionId,
      version: workspace.session.dataRevision,
      hash: workspace.session.dataHash,
      role: 'workspace',
    },
    ...(workspace.session.summaryHash ? [{
      type: 'co_creation_session_summary',
      id: workspace.session.sessionId,
      hash: workspace.session.summaryHash,
      role: 'session_summary',
    }] : []),
    ...workspace.messages
      .filter((message) => message.status === 'completed')
      .slice(-4)
      .map((message) => ({
        type: 'co_creation_message',
        id: message.messageId,
        hash: message.contentHash,
        role: 'recent_message',
      })),
    ...(request.sourceDraftRevisionId ? [{
      type: 'co_creation_draft',
      id: request.sourceDraftRevisionId,
      hash: request.sourceDraftContentHash,
      role: 'pending_draft',
    }] : []),
  ];
}

function preparedForCompiledHash(prepared: PreparedOutlineWorkflow): PreparedOutlineWorkflow {
  return {
    ...prepared,
    // Persisting the prepared request advances the session CAS before execution.
    // The authoritative CAS is still submitted to Rust as a first-create guard,
    // but it is not prompt-bearing input and must not make that known lineage stale.
    sourceManifestJson: prepared.sourceManifestJson.map((source) => {
      if (source.type !== 'co_creation_session') return source;
      const { version: _version, hash: _hash, ...semanticSource } = source;
      return semanticSource;
    }),
  };
}

async function compileBaseContext(
  workspace: CoCreationWorkspaceSnapshot,
  input: GenerationCompileInput,
): Promise<{
  baseContextHash: string;
  compiledInputHash?: string;
  prepared?: PreparedOutlineWorkflow;
  scope: Awaited<ReturnType<typeof validateScope>>;
}> {
  if (workspace.session.novelId !== input.novelId
      || workspace.session.sessionId !== input.sessionId) {
    throw generationError('TARGET_SCOPE_MISMATCH', '生成编译请求与共创会话不一致');
  }
  const scope = await validateScope(input);
  const context = await buildCoCreationContext(workspace);
  if (input.kind === 'chapter_generation_handoff') {
    return { baseContextHash: context.canonicalDataHash, scope };
  }
  const options = {
    additionalInstruction: input.additionalInstruction,
    coCreationContext: compactGenerationContext(context),
    generationSource: 'ai_co_creation' as const,
    sourceManifestJson: sourceManifest(workspace, input, context.sourceManifest),
  };
  const prepared = input.kind === 'master_outline'
    ? await outlineGenerateService.compileNovelOutline(input.novelId, options)
    : input.kind === 'volume_outline'
      ? await outlineGenerateService.compileVolumeOutline({
          novelId: input.novelId,
          volumeId: scope.volume!.id,
          volumeTitle: scope.volume!.title,
          ...options,
        })
      : await outlineGenerateService.compileChapterOutlines({
          novelId: input.novelId,
          volumeId: scope.chapter?.volumeId ?? scope.volume?.id,
          chapterId: scope.chapter?.id,
          chapterTitle: scope.chapter?.title,
          chapterGoal: scope.chapter?.goal,
          chapterCount: input.chapterCount,
          ...options,
        });
  const compiledInputHash = await computeContentSha256(stableCanonicalStringify({
    compilerVersion: 'co-creation-outline-m6-v1',
    baseContextHash: context.canonicalDataHash,
    prepared: preparedForCompiledHash(prepared),
  }));
  return {
    baseContextHash: context.canonicalDataHash,
    compiledInputHash,
    prepared,
    scope,
  };
}

function validateSourceDraft(
  workspace: CoCreationWorkspaceSnapshot,
  request: CoCreationGenerationRequestV1,
): void {
  if (!request.sourceDraftRevisionId || !request.sourceDraftContentHash) return;
  const sourceDraft = workspace.draftRevisions.find((draft) => (
    draft.draftRevisionId === request.sourceDraftRevisionId
  ));
  if (!sourceDraft || sourceDraft.sessionId !== workspace.session.sessionId
      || sourceDraft.contentHash !== request.sourceDraftContentHash) {
    throw generationError(
      'CO_CREATION_GENERATION_REQUEST_INVALID',
      '生成请求的来源共创草案不存在或完整性校验失败',
    );
  }
}

async function execute(
  callerWorkspace: CoCreationWorkspaceSnapshot,
  request: CoCreationGenerationRequestV1,
): Promise<CoCreationGenerationReceiptV1> {
  await assertCoCreationGenerationRequestIntegrity(request);
  if (request.novelId !== callerWorkspace.session.novelId
      || request.sessionId !== callerWorkspace.session.sessionId) {
    throw generationError('TARGET_SCOPE_MISMATCH', '生成请求与当前共创会话不一致');
  }
  const workspace = await coCreationSessionService.open(request.novelId);
  if (workspace.session.sessionId !== request.sessionId) {
    throw generationError('TARGET_SCOPE_MISMATCH', '权威共创会话与生成请求不一致');
  }
  const persistedRecord = readCoCreationGenerationRecords(workspace.activeDraft?.payload)
    .find((record) => record.request.requestId === request.requestId);
  if (!persistedRecord
      || stableCanonicalStringify(persistedRecord.request) !== stableCanonicalStringify(request)) {
    throw generationError(
      'CO_CREATION_GENERATION_REQUEST_INVALID',
      '权威共创草案中不存在该精确生成请求',
    );
  }
  if (!['prepared', 'failed', 'submitted', 'handoff_ready'].includes(persistedRecord.status)) {
    throw generationError('CO_CREATION_GENERATION_REQUEST_INVALID', '生成请求状态不允许执行');
  }
  if (persistedRecord.status === 'failed'
      && persistedRecord.errorCode === 'CO_CREATION_GENERATION_STALE') {
    throw generationError(
      'CO_CREATION_GENERATION_STALE',
      '该生成请求已经基于旧数据失败，请重新准备',
    );
  }
  validateSourceDraft(workspace, request);
  const compilation = await compileBaseContext(workspace, request);
  if (compilation.baseContextHash !== request.baseContextHash
      || compilation.compiledInputHash !== request.compiledInputHash) {
    throw generationError(
      'CO_CREATION_GENERATION_STALE',
      '正式作品数据、共创草案或大纲编译输入已经变化，请基于最新内容重新准备生成请求',
    );
  }

  if (request.kind === 'chapter_generation_handoff') {
    const receipt: CoCreationChapterGenerationHandoffV1 = {
      receiptType: 'chapter_generation_handoff',
      handoffId: `co-creation-handoff:${request.requestId}`,
      requestId: request.requestId,
      requestHash: request.requestHash,
      novelId: request.novelId,
      ...(compilation.scope.chapter?.volumeId ? { volumeId: compilation.scope.chapter.volumeId } : {}),
      chapterId: compilation.scope.chapter!.id,
      chapterPlan: request.chapterPlan!,
      ...(request.targetWordCount ? { targetWordCount: request.targetWordCount } : {}),
      baseContextHash: request.baseContextHash,
      ...(request.sourceDraftRevisionId ? { sourceDraftRevisionId: request.sourceDraftRevisionId } : {}),
      ...(request.sourceDraftContentHash ? { sourceDraftContentHash: request.sourceDraftContentHash } : {}),
      createdAt: request.createdAt,
    };
    return receipt;
  }

  if (!compilation.prepared) {
    throw generationError('CO_CREATION_GENERATION_REQUEST_INVALID', '后台大纲编译输入缺失');
  }
  const created = await outlineGenerateService.submitPrepared(compilation.prepared, {
    operationId: request.operationId,
    sourceManifestJson: [{
      type: 'co_creation_generation_request',
      id: request.requestId,
      hash: request.requestHash,
      role: 'generation_request',
      status: 'used',
    }],
    inputPayloadJson: {
      coCreationContract: 'co_creation_generation_request_v1',
      coCreationSessionId: request.sessionId,
      coCreationRequestId: request.requestId,
      coCreationRequestHash: request.requestHash,
      baseContextHash: request.baseContextHash,
      compiledInputHash: request.compiledInputHash,
      baseDataRevision: request.baseDataRevision,
    },
  });
  return {
    receiptType: 'background_workflow',
    workflowId: created.workflowId,
    rootTaskId: created.rootTaskId,
    childTaskIds: created.childTaskIds,
    submittedAt: request.createdAt,
  };
}

async function getChapterGenerationHandoff(
  novelId: string,
  handoffId: string,
): Promise<CoCreationChapterGenerationHandoffV1> {
  const workspace = await coCreationSessionService.open(novelId);
  const record = readCoCreationGenerationRecords(workspace.activeDraft?.payload)
    .find((item) => item.receipt?.receiptType === 'chapter_generation_handoff'
      && item.receipt.handoffId === handoffId);
  const handoff = record?.receipt;
  if (!record || handoff?.receiptType !== 'chapter_generation_handoff' || handoff.novelId !== novelId) {
    throw generationError('TARGET_NOT_FOUND', 'AI 共创章节生成交接不存在或已经失效');
  }
  await assertCoCreationGenerationRequestIntegrity(record.request);
  if (record.status !== 'handoff_ready'
      || record.request.kind !== 'chapter_generation_handoff'
      || record.request.novelId !== novelId
      || record.request.sessionId !== workspace.session.sessionId
      || handoff.handoffId !== `co-creation-handoff:${record.request.requestId}`
      || handoff.requestId !== record.request.requestId
      || handoff.requestHash !== record.request.requestHash
      || handoff.chapterId !== record.request.chapterId
      || handoff.chapterPlan !== record.request.chapterPlan
      || handoff.targetWordCount !== record.request.targetWordCount
      || handoff.baseContextHash !== record.request.baseContextHash
      || handoff.sourceDraftRevisionId !== record.request.sourceDraftRevisionId
      || handoff.sourceDraftContentHash !== record.request.sourceDraftContentHash
      || handoff.createdAt !== record.request.createdAt) {
    throw generationError('CO_CREATION_GENERATION_REQUEST_INVALID', 'AI 共创章节生成交接来源校验失败');
  }
  validateSourceDraft(workspace, record.request);
  const context = await buildCoCreationContext(workspace);
  if (context.canonicalDataHash !== handoff.baseContextHash) {
    throw generationError('CO_CREATION_GENERATION_STALE', '正式作品数据或共创章节计划已经变化，请重新准备章节生成交接');
  }
  const chapter = await chapterRepository.getById(handoff.chapterId);
  if (!chapter || chapter.novelId !== novelId || (handoff.volumeId && chapter.volumeId !== handoff.volumeId)) {
    throw generationError('TARGET_SCOPE_MISMATCH', 'AI 共创章节生成交接的目标范围已经失效');
  }
  return handoff;
}

export const coCreationGenerationService = {
  compileBaseContext,
  execute,
  getChapterGenerationHandoff,
};
