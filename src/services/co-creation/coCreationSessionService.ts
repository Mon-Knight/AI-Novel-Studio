import type {
  CoCreationDraftRevision,
  CoCreationMessage,
  CoCreationMutationReceiptV1,
  CoCreationObjectContext,
  CoCreationSession,
  CoCreationStage,
  CoCreationStageProgress,
  CoCreationWorkspaceSnapshot,
  PersistedCoCreationDraftRevisionV1,
  PersistedCoCreationMessageV1,
  PersistedCoCreationWorkspaceV1,
} from '../../types/coCreation';
import { dbCall, generateId, isTauri, nowISO } from '../database/db';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { stableCanonicalStringify } from '../ai-tasks/stage3PrerequisiteService';
import { deriveAllStageProgress } from '../../features/co-creation/stageMachine';
import { deserializeWorkingDraft } from '../../features/co-creation/draftState';

interface OpenResult {
  created: boolean;
  workspace: PersistedCoCreationWorkspaceV1;
}

interface BrowserRecord {
  workspace: PersistedCoCreationWorkspaceV1;
  operations: Record<string, CoCreationMutationReceiptV1 & { requestHash: string }>;
}

const browserTails = new Map<string, Promise<unknown>>();

function browserKey(novelId: string): string {
  return `ai_novel_studio_co_creation_workspace_v1_${novelId}`;
}

function appError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function hash(value: unknown): Promise<string> {
  return computeContentSha256(stableCanonicalStringify(value));
}

function readBrowserRecord(novelId: string): BrowserRecord | null {
  const raw = localStorage.getItem(browserKey(novelId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as BrowserRecord;
    if (!parsed?.workspace?.session || !Array.isArray(parsed.workspace.messages)
        || !Array.isArray(parsed.workspace.draftRevisions) || !parsed.operations) throw new Error('invalid');
    return parsed;
  } catch {
    throw appError('ARTIFACT_VALIDATION_FAILED', '浏览器共创会话已损坏，已停止覆盖');
  }
}

function writeBrowserRecord(novelId: string, record: BrowserRecord): void {
  localStorage.setItem(browserKey(novelId), JSON.stringify(record));
  const reread = readBrowserRecord(novelId);
  if (!reread || reread.workspace.session.stateHash !== record.workspace.session.stateHash) {
    throw appError('DATABASE_TRANSACTION_FAILED', '浏览器共创会话写入后校验失败');
  }
}

function withBrowserLock<T>(novelId: string, action: () => Promise<T>): Promise<T> {
  const previous = browserTails.get(novelId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  browserTails.set(novelId, current);
  return current.finally(() => {
    if (browserTails.get(novelId) === current) browserTails.delete(novelId);
  });
}

function assertBrowserCas(record: BrowserRecord, revision: number, stateHash: string): void {
  const session = record.workspace.session;
  if (session.revision !== revision || session.stateHash !== stateHash) {
    throw appError('DOCUMENT_VERSION_CONFLICT', '共创会话已在其他窗口更新，请重新读取');
  }
}

function replayBrowser(
  record: BrowserRecord,
  operationId: string,
  requestHash: string,
): (CoCreationMutationReceiptV1 & { requestHash: string }) | undefined {
  const replay = record.operations[operationId];
  if (!replay) return undefined;
  if (replay.requestHash !== requestHash) {
    throw appError('OPERATION_PAYLOAD_CONFLICT', '同一操作对应不同请求');
  }
  return { ...replay, idempotentReplay: true };
}

async function advanceBrowser(
  record: BrowserRecord,
  operationId: string,
  operationType: string,
  requestHash: string,
  details: { messageId?: string; draftRevisionId?: string },
): Promise<CoCreationMutationReceiptV1> {
  const replay = record.operations[operationId];
  if (replay) {
    if (replay.requestHash !== requestHash) throw appError('OPERATION_PAYLOAD_CONFLICT', '同一操作对应不同请求');
    return { ...replay, idempotentReplay: true };
  }
  const nextRevision = record.workspace.session.revision + 1;
  const nextStateHash = await hash({
    previous: record.workspace.session.stateHash,
    operationId,
    operationType,
    requestHash,
    nextRevision,
    ...details,
  });
  record.workspace.session = {
    ...record.workspace.session,
    revision: nextRevision,
    stateHash: nextStateHash,
    updatedAt: nowISO(),
  };
  const receipt: CoCreationMutationReceiptV1 & { requestHash: string } = {
    sessionId: record.workspace.session.sessionId,
    operationId,
    operationType,
    revision: nextRevision,
    stateHash: nextStateHash,
    ...details,
    idempotentReplay: false,
    requestHash,
  };
  record.operations[operationId] = receipt;
  return receipt;
}

async function openBrowser(novelId: string): Promise<OpenResult> {
  return withBrowserLock(novelId, async () => {
    const existing = readBrowserRecord(novelId);
    if (existing) return { created: false, workspace: existing.workspace };
    const now = nowISO();
    const sessionId = generateId();
    const stateHash = await hash({ contract: 'co_creation_session_v1', sessionId, novelId });
    const record: BrowserRecord = {
      workspace: {
        schemaVersion: 1,
        session: {
          sessionId,
          novelId,
          workspaceType: 'ai_co_creation',
          status: 'active',
          revision: 0,
          stateHash,
          createdAt: now,
          updatedAt: now,
        },
        messages: [],
        draftRevisions: [],
      },
      operations: {},
    };
    writeBrowserRecord(novelId, record);
    return { created: true, workspace: record.workspace };
  });
}

function assistantReply(content: string): string {
  try {
    const parsed = JSON.parse(content) as { naturalLanguageReply?: unknown };
    return typeof parsed.naturalLanguageReply === 'string' ? parsed.naturalLanguageReply : content;
  } catch {
    return content;
  }
}

function assistantStructuredPayload(content: string): unknown {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function mapMessage(message: PersistedCoCreationMessageV1): CoCreationMessage {
  return {
    messageId: message.messageId,
    sessionId: message.sessionId,
    sequenceNo: message.sequenceNo,
    role: message.role,
    status: message.status === 'completed' ? 'completed'
      : message.status === 'failed' ? 'failed'
        : message.status === 'cancelled' ? 'cancelled' : 'pending',
    content: message.role === 'assistant' ? assistantReply(message.content) : message.content,
    contentHash: message.contentHash,
    contentLength: message.contentLength,
    replyToMessageId: message.replyToMessageId,
    sourceTaskId: message.taskId,
    sourceArtifactId: message.artifactId,
    turnContext: message.turnContext,
    ...(message.role === 'assistant' && assistantStructuredPayload(message.content) !== undefined
      ? { structuredPayload: assistantStructuredPayload(message.content) } : {}),
    operationId: `persisted:${message.messageId}`,
    requestHash: message.contentHash,
    createdAt: message.createdAt,
    completedAt: message.completedAt,
  };
}

function mapDraft(draft: PersistedCoCreationDraftRevisionV1): CoCreationDraftRevision {
  return {
    draftRevisionId: draft.draftRevisionId,
    sessionId: draft.sessionId,
    stage: draft.stageKey,
    revisionNo: draft.revisionNo,
    parentRevisionId: draft.parentRevisionId,
    schemaVersion: draft.schemaVersion,
    payload: draft.payload,
    contentHash: draft.contentHash,
    origin: draft.origin,
    sourceMessageId: draft.sourceMessageId,
    sourceTaskId: draft.sourceTaskId,
    sourceArtifactId: draft.sourceArtifactId,
    operationId: `persisted:${draft.draftRevisionId}`,
    requestHash: draft.contentHash,
    createdAt: draft.createdAt,
  };
}

function stageProgress(payload: Record<string, unknown> | undefined): CoCreationStageProgress[] {
  if (Array.isArray(payload?.stageProgress)) return payload.stageProgress as CoCreationStageProgress[];
  return deriveAllStageProgress(deserializeWorkingDraft(payload).fields);
}

function mapWorkspace(raw: PersistedCoCreationWorkspaceV1): CoCreationWorkspaceSnapshot {
  const latestRawDraft = raw.draftRevisions[raw.draftRevisions.length - 1];
  const activeDraft = latestRawDraft ? mapDraft(latestRawDraft) : undefined;
  const payload = activeDraft?.payload;
  const currentStage = (typeof payload?.currentStage === 'string' ? payload.currentStage : activeDraft?.stage ?? 'story_seed') as CoCreationStage;
  const objectContext = payload?.objectContext && typeof payload.objectContext === 'object'
    ? payload.objectContext as CoCreationObjectContext
    : { novelId: raw.session.novelId };
  const messages = raw.messages.map(mapMessage);
  const draftRevisions = raw.draftRevisions.map(mapDraft);
  const session: CoCreationSession = {
    sessionId: raw.session.sessionId,
    novelId: raw.session.novelId,
    title: 'AI 共创',
    status: raw.session.status,
    currentStage,
    stageProgress: stageProgress(payload),
    objectContext: { ...objectContext, novelId: raw.session.novelId },
    summary: typeof payload?.sessionSummary === 'string' ? payload.sessionSummary : undefined,
    summaryHash: typeof payload?.sessionSummaryHash === 'string' ? payload.sessionSummaryHash : undefined,
    activeDraftRevisionId: activeDraft?.draftRevisionId,
    activeArtifactId: activeDraft?.sourceArtifactId,
    dataRevision: raw.session.revision,
    dataHash: raw.session.stateHash,
    createdAt: raw.session.createdAt,
    updatedAt: raw.session.updatedAt,
    archivedAt: raw.session.archivedAt,
  };
  return {
    session,
    messages,
    draftRevisions,
    ...(activeDraft ? { activeDraft } : {}),
    pendingTurn: [...messages].reverse().find((message) => message.role === 'user' && message.status === 'pending'),
  };
}

async function readRaw(novelId: string, sessionId: string): Promise<PersistedCoCreationWorkspaceV1> {
  if (!isTauri()) {
    const record = readBrowserRecord(novelId);
    if (!record || record.workspace.session.sessionId !== sessionId) throw appError('TARGET_NOT_FOUND', '共创会话不存在');
    return record.workspace;
  }
  return dbCall<PersistedCoCreationWorkspaceV1>('read_co_creation_workspace', {
    input: { novelId, sessionId },
  });
}

async function readMapped(novelId: string, sessionId: string): Promise<CoCreationWorkspaceSnapshot> {
  return mapWorkspace(await readRaw(novelId, sessionId));
}

export const coCreationSessionService = {
  async open(novelId: string): Promise<CoCreationWorkspaceSnapshot> {
    const normalized = novelId.trim();
    if (!normalized) throw new Error('作品 ID 不能为空');
    const result = isTauri()
      ? await dbCall<OpenResult>('open_co_creation_workspace', { input: { novelId: normalized } })
      : await openBrowser(normalized);
    return mapWorkspace(result.workspace);
  },

  async read(novelId: string, sessionId: string): Promise<CoCreationWorkspaceSnapshot> {
    return readMapped(novelId, sessionId);
  },

  async appendUserMessage(input: {
    workspace: CoCreationWorkspaceSnapshot;
    content: string;
    operationId: string;
  }): Promise<{ workspace: CoCreationWorkspaceSnapshot; userMessage: CoCreationMessage }> {
    const { session } = input.workspace;
    const receipt = isTauri() ? await dbCall<CoCreationMutationReceiptV1>('append_co_creation_user_message', {
      input: {
        novelId: session.novelId,
        sessionId: session.sessionId,
        expectedRevision: session.dataRevision,
        expectedStateHash: session.dataHash,
        operationId: input.operationId,
        content: input.content,
      },
    }) : await withBrowserLock(session.novelId, async () => {
      const record = readBrowserRecord(session.novelId);
      if (!record) throw appError('TARGET_NOT_FOUND', '共创会话不存在');
      const requestHash = await hash({ operation: 'append', content: input.content });
      const replay = record.operations[input.operationId];
      if (replay) return advanceBrowser(record, input.operationId, 'append_user_message', requestHash, { messageId: replay.messageId });
      assertBrowserCas(record, session.dataRevision, session.dataHash);
      if (record.workspace.messages.some((message) => message.role === 'user'
        && ['submitted', 'running'].includes(message.status))) {
        throw appError('AI_TASK_ILLEGAL_TRANSITION', '上一轮共创消息仍在处理中');
      }
      const contentHash = await computeContentSha256(input.content);
      const messageId = generateId();
      record.workspace.messages.push({
        messageId, sessionId: session.sessionId, turnId: messageId,
        sequenceNo: record.workspace.messages.length + 1, role: 'user', status: 'submitted',
        content: input.content, contentHash, contentLength: Array.from(input.content).length,
        createdAt: nowISO(),
      });
      const receipt = await advanceBrowser(record, input.operationId, 'append_user_message', requestHash, { messageId });
      writeBrowserRecord(session.novelId, record);
      return receipt;
    });
    const workspace = await readMapped(session.novelId, session.sessionId);
    const userMessage = workspace.messages.find((message) => message.messageId === receipt.messageId);
    if (!userMessage) throw new Error('共创用户消息写入后无法读取');
    return { workspace, userMessage };
  },

  async bindTurnTask(input: {
    workspace: CoCreationWorkspaceSnapshot;
    userMessageId: string;
    taskId: string;
    turnContext: NonNullable<CoCreationMessage['turnContext']>;
  }): Promise<CoCreationWorkspaceSnapshot> {
    const { session } = input.workspace;
    const operationId = `co-creation:${session.sessionId}:message:${input.userMessageId}:bind:${input.taskId}`;
    if (isTauri()) await dbCall<CoCreationMutationReceiptV1>('bind_co_creation_turn_task', {
      input: {
        novelId: session.novelId, sessionId: session.sessionId,
        userMessageId: input.userMessageId, taskId: input.taskId,
        expectedRevision: session.dataRevision, expectedStateHash: session.dataHash, operationId,
      },
    });
    else await withBrowserLock(session.novelId, async () => {
      const record = readBrowserRecord(session.novelId);
      if (!record) throw appError('TARGET_NOT_FOUND', '共创会话不存在');
      const requestHash = await hash({ operation: 'bind', userMessageId: input.userMessageId, taskId: input.taskId });
      const replay = replayBrowser(record, operationId, requestHash);
      if (replay) return replay;
      assertBrowserCas(record, session.dataRevision, session.dataHash);
      const message = record.workspace.messages.find((item) => item.messageId === input.userMessageId);
      if (!message) throw appError('TARGET_NOT_FOUND', '共创用户消息不存在');
      message.taskId = input.taskId; message.status = 'running'; message.turnContext = input.turnContext;
      const receipt = await advanceBrowser(record, operationId, 'bind_turn_task', requestHash, { messageId: message.messageId });
      writeBrowserRecord(session.novelId, record);
      return receipt;
    });
    return readMapped(session.novelId, session.sessionId);
  },

  async completeTurn(input: {
    workspace: CoCreationWorkspaceSnapshot;
    userMessageId: string;
    taskId: string;
    artifactId: string;
    assistantContent: string;
  }): Promise<CoCreationWorkspaceSnapshot> {
    const { session } = input.workspace;
    const operationId = `co-creation:${session.sessionId}:message:${input.userMessageId}:complete:${input.artifactId}`;
    if (isTauri()) await dbCall<CoCreationMutationReceiptV1>('complete_co_creation_turn', {
      input: {
        novelId: session.novelId, sessionId: session.sessionId,
        userMessageId: input.userMessageId, taskId: input.taskId, artifactId: input.artifactId,
        expectedRevision: session.dataRevision, expectedStateHash: session.dataHash, operationId,
      },
    });
    else await withBrowserLock(session.novelId, async () => {
      const record = readBrowserRecord(session.novelId);
      if (!record) throw appError('TARGET_NOT_FOUND', '共创会话不存在');
      const requestHash = await hash({
        operation: 'complete', userMessageId: input.userMessageId, taskId: input.taskId,
        artifactId: input.artifactId, assistantContent: input.assistantContent,
      });
      const replay = replayBrowser(record, operationId, requestHash);
      if (replay) return replay;
      const user = record.workspace.messages.find((item) => item.messageId === input.userMessageId);
      if (!user) throw appError('TARGET_NOT_FOUND', '共创用户消息不存在');
      if (user.status !== 'running' || user.taskId !== input.taskId) {
        throw appError('AI_TASK_ILLEGAL_TRANSITION', '共创 turn 当前不能完成');
      }
      const now = nowISO();
      user.status = 'completed'; user.completedAt = now; user.artifactId = input.artifactId;
      const contentHash = await computeContentSha256(input.assistantContent);
      const messageId = generateId();
      record.workspace.messages.push({
        messageId, sessionId: session.sessionId, turnId: user.turnId,
        sequenceNo: record.workspace.messages.length + 1, role: 'assistant', status: 'completed',
        content: input.assistantContent, contentHash, contentLength: Array.from(input.assistantContent).length,
        replyToMessageId: user.messageId, taskId: input.taskId, artifactId: input.artifactId,
        createdAt: now, completedAt: now,
      });
      const receipt = await advanceBrowser(record, operationId, 'complete_turn', requestHash, { messageId });
      writeBrowserRecord(session.novelId, record);
      return receipt;
    });
    return readMapped(session.novelId, session.sessionId);
  },

  async failTurn(input: {
    workspace: CoCreationWorkspaceSnapshot;
    userMessageId: string;
    taskId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<CoCreationWorkspaceSnapshot> {
    const { session } = input.workspace;
    const operationId = `co-creation:${session.sessionId}:message:${input.userMessageId}:fail:${input.taskId}`;
    if (isTauri()) await dbCall<CoCreationMutationReceiptV1>('fail_co_creation_turn', {
      input: {
        novelId: session.novelId, sessionId: session.sessionId,
        userMessageId: input.userMessageId, taskId: input.taskId,
        errorCode: input.errorCode, errorMessage: input.errorMessage,
        expectedRevision: session.dataRevision, expectedStateHash: session.dataHash, operationId,
      },
    });
    else await withBrowserLock(session.novelId, async () => {
      const record = readBrowserRecord(session.novelId);
      if (!record) throw appError('TARGET_NOT_FOUND', '共创会话不存在');
      const requestHash = await hash({
        operation: 'fail', userMessageId: input.userMessageId, taskId: input.taskId,
        errorCode: input.errorCode, errorMessage: input.errorMessage,
      });
      const replay = replayBrowser(record, operationId, requestHash);
      if (replay) return replay;
      const user = record.workspace.messages.find((item) => item.messageId === input.userMessageId);
      if (!user) throw appError('TARGET_NOT_FOUND', '共创用户消息不存在');
      if (user.status !== 'running' || user.taskId !== input.taskId) {
        throw appError('AI_TASK_ILLEGAL_TRANSITION', '共创 turn 当前不能标记失败');
      }
      user.status = 'failed'; user.completedAt = nowISO(); user.error = { code: input.errorCode, message: input.errorMessage };
      const receipt = await advanceBrowser(record, operationId, 'fail_turn', requestHash, { messageId: user.messageId });
      writeBrowserRecord(session.novelId, record);
      return receipt;
    });
    return readMapped(session.novelId, session.sessionId);
  },

  async saveDraft(input: {
    workspace: CoCreationWorkspaceSnapshot;
    stage: CoCreationStage;
    payload: Record<string, unknown>;
    origin: CoCreationDraftRevision['origin'];
    sourceMessageId?: string;
    sourceTaskId?: string;
    sourceArtifactId?: string;
    operationId: string;
  }): Promise<CoCreationWorkspaceSnapshot> {
    const { session } = input.workspace;
    const sourceIds = [input.sourceMessageId, input.sourceTaskId, input.sourceArtifactId];
    if (input.payload.currentStage !== input.stage) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '共创草案 currentStage 与 stage 不一致');
    }
    if (input.origin === 'author_edit' && sourceIds.some(Boolean)) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '作者直接编辑草案不能携带 AI 来源');
    }
    if (input.origin !== 'author_edit' && sourceIds.some((value) => !value)) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', 'AI 草案必须保留 Message/Task/Artifact 来源');
    }
    const previousStageDraft = [...input.workspace.draftRevisions]
      .reverse()
      .find((draft) => draft.stage === input.stage);
    if (isTauri()) await dbCall<CoCreationMutationReceiptV1>('save_co_creation_draft_revision', {
      input: {
        novelId: session.novelId, sessionId: session.sessionId,
        stageKey: input.stage, schemaVersion: 1, payload: input.payload, origin: input.origin,
        sourceMessageId: input.sourceMessageId, sourceTaskId: input.sourceTaskId,
        sourceArtifactId: input.sourceArtifactId,
        expectedDraftRevision: previousStageDraft?.revisionNo ?? 0,
        expectedDraftContentHash: previousStageDraft?.contentHash,
        expectedRevision: session.dataRevision, expectedStateHash: session.dataHash,
        operationId: input.operationId,
      },
    });
    else await withBrowserLock(session.novelId, async () => {
      const record = readBrowserRecord(session.novelId);
      if (!record) throw appError('TARGET_NOT_FOUND', '共创会话不存在');
      const requestHash = await hash({ operation: 'save_draft', stage: input.stage, payload: input.payload });
      const replay = replayBrowser(record, input.operationId, requestHash);
      if (replay) return replay;
      assertBrowserCas(record, session.dataRevision, session.dataHash);
      if (input.origin !== 'author_edit' && !record.workspace.messages.some((message) => (
        message.messageId === input.sourceMessageId && message.role === 'assistant'
          && message.status === 'completed' && message.taskId === input.sourceTaskId
          && message.artifactId === input.sourceArtifactId
      ))) {
        throw appError('TARGET_SCOPE_MISMATCH', 'AI 草案来源与会话消息不一致');
      }
      const draftRevisionId = generateId();
      const previous = [...record.workspace.draftRevisions]
        .reverse()
        .find((draft) => draft.stageKey === input.stage);
      record.workspace.draftRevisions.push({
        draftRevisionId, sessionId: session.sessionId, stageKey: input.stage,
        revisionNo: (previous?.revisionNo ?? 0) + 1,
        parentRevisionId: previous?.draftRevisionId,
        schemaVersion: 1, payload: input.payload, contentHash: await hash(input.payload),
        origin: input.origin, sourceMessageId: input.sourceMessageId,
        sourceTaskId: input.sourceTaskId, sourceArtifactId: input.sourceArtifactId,
        createdAt: nowISO(),
      });
      const receipt = await advanceBrowser(record, input.operationId, 'save_draft_revision', requestHash, { draftRevisionId });
      writeBrowserRecord(session.novelId, record);
      return receipt;
    });
    return readMapped(session.novelId, session.sessionId);
  },
};
