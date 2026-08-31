import { dbCall, generateId, isTauri, lsGet, lsSet, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { isContextCompressionCandidate } from '../context/novelContextCompressionProvider';
import type {
  ArtifactDecision,
  ConversationArtifactCard,
  ConversationTurn,
  InitializedTaskConversation,
  ReviewAuthorization,
  TaskConversation,
  TaskConversationBundle,
  TaskModelSnapshot,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';

const STORAGE_KEY = 'ai_novel_studio_task_conversations';
const ARTIFACT_PROJECTION_CACHE_LIMIT = 256;

export interface TaskConversationReadOptions {
  hydrateArtifacts?: boolean;
}

interface HydratedArtifactProjection {
  content: string;
  artifactEvidence: NonNullable<ConversationArtifactCard['artifactEvidence']>;
}

interface CachedArtifactProjection {
  reader: typeof aiTaskRuntimeService.getArtifact;
  value: HydratedArtifactProjection;
}

interface PendingArtifactProjection {
  reader: typeof aiTaskRuntimeService.getArtifact;
  promise: Promise<HydratedArtifactProjection>;
}

const artifactProjectionCache = new Map<string, CachedArtifactProjection>();
const pendingArtifactProjections = new Map<string, PendingArtifactProjection>();

interface LocalConversationState {
  bundles: TaskConversationBundle[];
}

interface ListConversationOptions {
  includeArchived?: boolean;
}

function localState(): LocalConversationState {
  const stored = lsGet<LocalConversationState>(STORAGE_KEY);
  if (stored && Array.isArray(stored.bundles)) return stored;
  return { bundles: [] };
}

function saveLocal(state: LocalConversationState): void {
  lsSet(STORAGE_KEY, state);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isModelSnapshotSecretField(key: string): boolean {
  const normalized = key
    .split('')
    .filter((character) => /[a-z0-9]/i.test(character))
    .join('')
    .toLowerCase();
  return (
    normalized.endsWith('apikey') ||
    normalized.endsWith('authorization') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('authtoken') ||
    normalized.endsWith('apitoken') ||
    normalized.endsWith('bearertoken') ||
    normalized.endsWith('sessiontoken') ||
    normalized.endsWith('password') ||
    normalized.endsWith('passphrase') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('credentials') ||
    normalized.endsWith('cookie') ||
    normalized.endsWith('cookies') ||
    normalized.endsWith('privatekey')
  );
}

function containsModelSnapshotSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsModelSnapshotSecret);
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('bearer ') ||
      lower.includes('authorization:') ||
      lower.includes('x-api-key') ||
      lower.includes('x_api_key') ||
      lower.includes('xapikey') ||
      lower.includes('openaiapikey') ||
      lower.includes('api_key=') ||
      lower.includes('apikey=') ||
      lower.includes('api-key=') ||
      lower.includes('credentials=') ||
      lower.includes('"credentials"') ||
      lower.includes('-----begin private key-----') ||
      value
        .split(/[\s"'=:,;()[\]{}]+/)
        .some(
          (token) =>
            (token.startsWith('sk-') && token.length >= 19) || /^AKIA[A-Z0-9]{16}$/.test(token),
        )
    );
  }
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => isModelSnapshotSecretField(key) || containsModelSnapshotSecret(child),
  );
}

function assertSafeModelSnapshot(
  value: unknown,
  label: string,
): asserts value is TaskModelSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  if (containsModelSnapshotSecret(value)) {
    throw new Error(`${label}不得包含 API Key 或其他凭据`);
  }
}

function assertClientWritableModelSnapshot(value: TaskModelSnapshot, label: string): void {
  const runtime = value.runtime as Record<string, unknown> | undefined;
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, 'toolCallingAttestation')) {
    const error = new Error(
      `${label}不得声明模型工具认证；该证明只能由 DSH 运行时写入`,
    ) as Error & { code: string };
    error.code = 'MODEL_ATTESTATION_UNTRUSTED';
    throw error;
  }
}

function localBundle(id: string): TaskConversationBundle | undefined {
  return localState().bundles.find((bundle) => bundle.conversation.conversationId === id);
}

function upsertLocal(bundle: TaskConversationBundle): TaskConversationBundle {
  const state = localState();
  const index = state.bundles.findIndex(
    (item) => item.conversation.conversationId === bundle.conversation.conversationId,
  );
  if (index >= 0) state.bundles[index] = bundle;
  else state.bundles.unshift(bundle);
  saveLocal(state);
  return clone(bundle);
}

function modelSnapshotFrom(value: TaskModelSnapshot | undefined): TaskModelSnapshot | undefined {
  if (!value) return undefined;
  assertSafeModelSnapshot(value, '模型快照');
  return clone(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function sameModelSnapshot(left: TaskModelSnapshot, right: TaskModelSnapshot): boolean {
  const lockProjection = (snapshot: TaskModelSnapshot) => {
    const projected = clone(snapshot);
    if (projected.runtime) delete projected.runtime.toolCallingAttestation;
    return projected;
  };
  return stableJson(lockProjection(left)) === stableJson(lockProjection(right));
}

function isLocalConversationalSnapshot(snapshot: TaskModelSnapshot): boolean {
  return (
    snapshot.providerId === 'ans-local' &&
    snapshot.runtime?.adapterProtocol === 'ans_local_conversation_v1'
  );
}

function normalizeConversation(raw: unknown): TaskConversation {
  const item = raw as TaskConversation;
  return {
    conversationId: String(item.conversationId),
    novelId: String(item.novelId),
    title: String(item.title || '未命名任务'),
    status: item.status ?? 'idle',
    defaultModel: modelSnapshotFrom(item.defaultModel),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
    archivedAt: item.archivedAt,
  };
}

function normalizeRun(raw: TaskRun): TaskRun {
  const rawChapterId = raw.chapterId ?? (raw as TaskRun & { chapter_id?: unknown }).chapter_id;
  const chapterId = typeof rawChapterId === 'string' ? rawChapterId.trim() : '';
  return {
    ...raw,
    ...(chapterId ? { chapterId } : {}),
    modelSnapshot: modelSnapshotFrom(raw.modelSnapshot)!,
  };
}

function normalizeBundle(raw: unknown): TaskConversationBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<TaskConversationBundle>;
  if (!item.conversation) return null;
  return {
    conversation: normalizeConversation(item.conversation),
    turns: Array.isArray(item.turns) ? (item.turns as ConversationTurn[]) : [],
    runs: Array.isArray(item.runs) ? (item.runs as TaskRun[]).map(normalizeRun) : [],
    toolEvents: Array.isArray(item.toolEvents) ? (item.toolEvents as ToolCallEvent[]) : [],
    artifacts: Array.isArray(item.artifacts)
      ? (item.artifacts as ConversationArtifactCard[]).map((artifact) => ({
          ...artifact,
          content: artifact.content ?? '',
        }))
      : [],
    decisions: Array.isArray(item.decisions) ? (item.decisions as ArtifactDecision[]) : [],
    authorizations: Array.isArray(item.authorizations)
      ? (item.authorizations as ReviewAuthorization[])
      : [],
  };
}

function rememberArtifactProjection(
  artifactId: string,
  reader: typeof aiTaskRuntimeService.getArtifact,
  value: HydratedArtifactProjection,
): void {
  artifactProjectionCache.delete(artifactId);
  artifactProjectionCache.set(artifactId, { reader, value });
  while (artifactProjectionCache.size > ARTIFACT_PROJECTION_CACHE_LIMIT) {
    const oldest = artifactProjectionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    artifactProjectionCache.delete(oldest);
  }
}

async function readArtifactProjection(artifactId: string): Promise<HydratedArtifactProjection> {
  const reader = aiTaskRuntimeService.getArtifact;
  const cached = artifactProjectionCache.get(artifactId);
  if (cached?.reader === reader) {
    artifactProjectionCache.delete(artifactId);
    artifactProjectionCache.set(artifactId, cached);
    return cached.value;
  }

  const pending = pendingArtifactProjections.get(artifactId);
  if (pending?.reader === reader) return pending.promise;

  const promise = reader(artifactId)
    .then((artifact) => {
      const structuredPayload = artifact.structuredPayloadJson;
      const isContextCompression =
        isContextCompressionCandidate(structuredPayload) && structuredPayload.valid;
      const value: HydratedArtifactProjection = {
        content: artifact.displayContent ?? artifact.rawContent,
        artifactEvidence: {
          sourceNovelId: artifact.artifact.sourceNovelId,
          sourceChapterId: artifact.artifact.sourceChapterId,
          sourceDraftId: artifact.artifact.sourceDraftId,
          sourceDraftVersion: artifact.artifact.sourceDraftVersion,
          baseContentHash: artifact.artifact.sourceBaseContentHash,
          derivationType:
            artifact.artifact.derivationType ??
            (isContextCompression ? 'context_compression' : undefined),
          processingStatus: artifact.artifact.processingStatus,
          validationIssues: artifact.issues,
        },
      };
      if (!['raw', 'parsing'].includes(artifact.artifact.processingStatus)) {
        rememberArtifactProjection(artifactId, reader, value);
      }
      return value;
    })
    .finally(() => {
      const current = pendingArtifactProjections.get(artifactId);
      if (current?.promise === promise) pendingArtifactProjections.delete(artifactId);
    });
  pendingArtifactProjections.set(artifactId, { reader, promise });
  return promise;
}

async function hydrateArtifactProjections(
  bundle: TaskConversationBundle,
): Promise<TaskConversationBundle> {
  const decisions = bundle.decisions ?? [];
  const authorizations = bundle.authorizations ?? [];
  const artifacts = await Promise.all(
    bundle.artifacts.map(async (card) => {
      const related = decisions.filter((item) => item.cardId === card.cardId);
      const latestDecision = related[related.length - 1];
      const reviewAuthorization = latestDecision
        ? authorizations.find((item) => item.decisionId === latestDecision.decisionId)
        : undefined;
      const projected: ConversationArtifactCard = {
        ...card,
        latestDecision,
        reviewAuthorization,
        artifactEvidence: undefined,
      };
      if (!card.artifactId || !isTauri()) return projected;
      try {
        const artifactProjection = await readArtifactProjection(card.artifactId);
        return {
          ...projected,
          ...artifactProjection,
          contentLoadError: undefined,
        };
      } catch {
        return {
          ...projected,
          contentLoadError: '候选内容读取失败，请重新读取当前任务产物。',
        };
      }
    }),
  );
  return { ...bundle, artifacts, decisions, authorizations };
}

function taskRunTransitionAllowed(from: TaskRun['status'], to: TaskRun['status']): boolean {
  return (
    from === to ||
    (from === 'queued' && ['running', 'failed', 'cancel_requested', 'cancelled'].includes(to)) ||
    (from === 'running' && ['completed', 'failed', 'cancel_requested', 'cancelled'].includes(to)) ||
    (from === 'cancel_requested' && ['completed', 'failed', 'cancelled'].includes(to))
  );
}

function toolEventTransitionAllowed(from: ToolCallEvent['status'], to: ToolCallEvent['status']) {
  return (
    from === to ||
    (['pending', 'queued'].includes(from) &&
      ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'].includes(to)) ||
    (from === 'running' && ['succeeded', 'failed', 'cancelled', 'skipped'].includes(to))
  );
}

function isTerminalRun(status: TaskRun['status']): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function isTerminalToolEvent(status: ToolCallEvent['status']): boolean {
  return ['succeeded', 'failed', 'cancelled', 'skipped'].includes(status);
}

function latestDecisionForCard(
  bundle: TaskConversationBundle,
  cardId: string,
): ArtifactDecision | undefined {
  const related = (bundle.decisions ?? []).filter(
    (decision) =>
      decision.cardId === cardId && decision.conversationId === bundle.conversation.conversationId,
  );
  return related[related.length - 1];
}

function hasUnresolvedArtifactCandidate(bundle: TaskConversationBundle): boolean {
  const authorizations = bundle.authorizations ?? [];
  return bundle.artifacts.some((card) => {
    if (!['candidate', 'confirmed'].includes(card.status)) return false;
    const decision = latestDecisionForCard(bundle, card.cardId);
    if (!decision) return true;
    if (decision.decision === 'confirm') {
      return !authorizations.some(
        (authorization) =>
          authorization.decisionId === decision.decisionId &&
          authorization.status === 'consumed' &&
          Boolean(authorization.consumedByDraftId),
      );
    }
    return (
      decision.decision === 'request_apply' &&
      !decision.applyTransactionId &&
      !decision.conflictCode
    );
  });
}

function decisionFallbackStatus(decision: ArtifactDecision): TaskConversation['status'] {
  if (decision.conflictCode) return 'failed';
  if (decision.decision === 'reject' || decision.decision === 'request_revision') return 'idle';
  if (decision.decision === 'request_apply' && decision.applyTransactionId) return 'completed';
  if (decision.decision === 'confirm' || decision.decision === 'request_apply') {
    return 'waiting_user';
  }
  return 'idle';
}

function reconcileLocalConversationStatus(
  bundle: TaskConversationBundle,
  fallbackStatus: TaskConversation['status'],
  updatedAt: string,
): void {
  if (bundle.conversation.archivedAt) return;
  const hasActiveRun = bundle.runs.some((run) =>
    ['queued', 'running', 'cancel_requested'].includes(run.status),
  );
  bundle.conversation.status = hasUnresolvedArtifactCandidate(bundle)
    ? 'waiting_user'
    : hasActiveRun
      ? 'running'
      : fallbackStatus;
  bundle.conversation.updatedAt = updatedAt;
}

export const taskConversationService = {
  async recoverInterruptedRuns(
    error = '工作台已重新加载，上一轮运行已中断。请重试本回合。',
    activeRuntimeRunIds: readonly string[] = [],
  ): Promise<number> {
    const finishedAt = nowISO();
    // The browser fallback has no process-side registry, so it uses the startup
    // liveness snapshot directly. On desktop this set is not sent to SQLite:
    // recover_task_runs re-reads the Rust worker registry while holding its lock.
    const runtimeOwnedRunIds = new Set(activeRuntimeRunIds);
    const raw = await dbCall<number>('recover_task_runs', { input: { finishedAt, error } }, () => {
      const state = localState();
      let recovered = 0;
      for (const bundle of state.bundles) {
        const activeRuns = bundle.runs.filter(
          (run) =>
            ['queued', 'running', 'cancel_requested'].includes(run.status) &&
            !runtimeOwnedRunIds.has(run.runId),
        );
        if (activeRuns.length === 0) continue;
        for (const run of activeRuns) {
          run.status = 'failed';
          run.error = error;
          run.finishedAt = finishedAt;
          run.updatedAt = finishedAt;
          bundle.toolEvents
            .filter(
              (event) =>
                event.runId === run.runId &&
                ['pending', 'queued', 'running'].includes(event.status),
            )
            .forEach((event) => {
              event.status = 'cancelled';
              event.error = '应用重新启动，工具调用未完成。';
              event.finishedAt = finishedAt;
            });
          recovered += 1;
        }
        reconcileLocalConversationStatus(bundle, 'failed', finishedAt);
        upsertLocal(bundle);
      }
      return recovered;
    });
    return typeof raw === 'number' ? raw : Number(raw || 0);
  },

  async create(
    novelId: string,
    title: string,
    defaultModel?: TaskModelSnapshot,
  ): Promise<TaskConversation> {
    const createdAt = nowISO();
    if (defaultModel) assertClientWritableModelSnapshot(defaultModel, '默认模型快照');
    const safeDefaultModel = modelSnapshotFrom(defaultModel);
    const input = {
      conversationId: generateId(),
      novelId,
      title: title.trim() || '未命名任务',
      defaultModel: safeDefaultModel,
      createdAt,
    };
    const raw = await dbCall<unknown>('create_task_conversation', { input }, () => {
      const conversation: TaskConversation = {
        conversationId: input.conversationId,
        novelId: input.novelId,
        title: input.title,
        status: 'idle',
        defaultModel: input.defaultModel,
        createdAt,
        updatedAt: createdAt,
      };
      upsertLocal({ conversation, turns: [], runs: [], toolEvents: [], artifacts: [] });
      return conversation;
    });
    return normalizeConversation(raw);
  },

  async createInitialized(
    novelId: string,
    goal: string,
    defaultModel: TaskModelSnapshot,
  ): Promise<InitializedTaskConversation> {
    const normalizedGoal = goal.trim();
    if (!normalizedGoal) throw new Error('创作目标不能为空');
    const createdAt = nowISO();
    assertClientWritableModelSnapshot(defaultModel, '默认模型快照');
    const safeDefaultModel = modelSnapshotFrom(defaultModel)!;
    const input = {
      conversationId: generateId(),
      turnId: generateId(),
      novelId,
      title: Array.from(normalizedGoal).slice(0, 40).join(''),
      goal: normalizedGoal,
      defaultModel: safeDefaultModel,
      createdAt,
    };
    const raw = await dbCall<InitializedTaskConversation>(
      'create_initialized_task_conversation',
      { input },
      () => {
        const conversation: TaskConversation = {
          conversationId: input.conversationId,
          novelId: input.novelId,
          title: input.title,
          status: 'idle',
          defaultModel: input.defaultModel,
          createdAt,
          updatedAt: createdAt,
        };
        const turn: ConversationTurn = {
          turnId: input.turnId,
          conversationId: input.conversationId,
          sequence: 0,
          role: 'user',
          content: input.goal,
          createdAt,
        };
        upsertLocal({ conversation, turns: [turn], runs: [], toolEvents: [], artifacts: [] });
        return { conversation, turn };
      },
    );
    return {
      conversation: normalizeConversation(raw.conversation),
      turn: raw.turn,
    };
  },

  async list(novelId?: string, options: ListConversationOptions = {}): Promise<TaskConversation[]> {
    const includeArchived = options.includeArchived === true;
    const raw = await dbCall<unknown[]>(
      'list_task_conversations',
      {
        input: { novelId, includeArchived, limit: 100 },
      },
      () =>
        localState()
          .bundles.filter((bundle) => !novelId || bundle.conversation.novelId === novelId)
          .filter(
            (bundle) =>
              includeArchived ||
              (!bundle.conversation.archivedAt && bundle.conversation.status !== 'archived'),
          )
          .map((bundle) => bundle.conversation)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    return (Array.isArray(raw) ? raw : []).map(normalizeConversation);
  },

  async get(
    conversationId: string,
    options: TaskConversationReadOptions = {},
  ): Promise<TaskConversationBundle | null> {
    const raw = await dbCall<unknown | null>(
      'get_task_conversation',
      { conversationId },
      () => localBundle(conversationId) ?? null,
    );
    const bundle = normalizeBundle(raw);
    if (!bundle || options.hydrateArtifacts === false) return bundle;
    return hydrateArtifactProjections(bundle);
  },

  async updateDefaultModel(
    conversationId: string,
    defaultModel: TaskModelSnapshot,
  ): Promise<TaskConversation> {
    assertClientWritableModelSnapshot(defaultModel, '默认模型快照');
    const input = {
      conversationId,
      defaultModel: modelSnapshotFrom(defaultModel)!,
      updatedAt: nowISO(),
    };
    const raw = await dbCall<unknown>('update_task_conversation_model', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
      const current = bundle.conversation.defaultModel;
      if (current) {
        if (sameModelSnapshot(current, input.defaultModel)) return bundle.conversation;
        throw new Error('任务模型已在创建时固定，当前会话结束前不能更换');
      }
      if (bundle.turns.length > 0 || bundle.runs.length > 0) {
        throw new Error('任务模型必须在首个回合前固定');
      }
      bundle.conversation.defaultModel = input.defaultModel;
      bundle.conversation.updatedAt = input.updatedAt;
      upsertLocal(bundle);
      return bundle.conversation;
    });
    return normalizeConversation(raw);
  },

  async rename(conversationId: string, title: string): Promise<TaskConversation> {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error('任务标题不能为空');
    const input = {
      conversationId,
      title: Array.from(nextTitle).slice(0, 160).join(''),
      updatedAt: nowISO(),
    };
    const raw = await dbCall<unknown>('rename_task_conversation', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
      bundle.conversation.title = input.title;
      bundle.conversation.updatedAt = input.updatedAt;
      upsertLocal(bundle);
      return bundle.conversation;
    });
    return normalizeConversation(raw);
  },

  async setArchived(conversationId: string, archived: boolean): Promise<TaskConversation> {
    const input = { conversationId, archived, updatedAt: nowISO() };
    const raw = await dbCall<unknown>('set_task_conversation_archived', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
      const active = bundle.runs.some((run) =>
        ['queued', 'running', 'cancel_requested'].includes(run.status),
      );
      if (archived && (active || bundle.conversation.status === 'running')) {
        throw new Error('运行中的任务不能归档，请先停止任务');
      }
      bundle.conversation.archivedAt = archived ? input.updatedAt : undefined;
      if (!archived && bundle.conversation.status === 'archived') {
        bundle.conversation.status = 'idle';
      }
      bundle.conversation.updatedAt = input.updatedAt;
      upsertLocal(bundle);
      return bundle.conversation;
    });
    return normalizeConversation(raw);
  },

  async appendTurn(
    conversationId: string,
    role: ConversationTurn['role'],
    content: string,
  ): Promise<ConversationTurn> {
    const input = {
      turnId: generateId(),
      conversationId,
      role,
      content,
      createdAt: nowISO(),
    };
    const raw = await dbCall<unknown>('append_conversation_turn', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
      const turn: ConversationTurn = {
        ...input,
        sequence: bundle.turns.length,
      };
      bundle.turns.push(turn);
      bundle.conversation.updatedAt = input.createdAt;
      if (
        role === 'user' &&
        (bundle.conversation.title === '新的创作任务' || bundle.conversation.title === '未命名任务')
      ) {
        bundle.conversation.title =
          Array.from(content.trim()).slice(0, 40).join('') || bundle.conversation.title;
      }
      upsertLocal(bundle);
      return turn;
    });
    return raw as ConversationTurn;
  },

  async createRun(
    conversationId: string,
    turnId: string,
    modelSnapshot: TaskModelSnapshot,
    workerId: string,
    chapterId?: string,
  ): Promise<TaskRun> {
    assertClientWritableModelSnapshot(modelSnapshot, '运行模型快照');
    const input = {
      runId: generateId(),
      conversationId,
      turnId,
      modelSnapshot: modelSnapshotFrom(modelSnapshot)!,
      workerId,
      chapterId: chapterId?.trim() || undefined,
      createdAt: nowISO(),
    };
    const raw = await dbCall<unknown>('create_task_run', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
      const lockedModel = bundle.conversation.defaultModel;
      if (
        lockedModel &&
        !isLocalConversationalSnapshot(input.modelSnapshot) &&
        !sameModelSnapshot(lockedModel, input.modelSnapshot)
      ) {
        throw new Error('运行模型与任务创建时固定的模型不一致');
      }
      const turn = bundle.turns.find((item) => item.turnId === turnId);
      if (!turn || turn.conversationId !== conversationId || turn.role !== 'user') {
        throw new Error('任务运行必须绑定同一任务中的用户回合');
      }
      if (
        bundle.runs.some(
          (item) =>
            item.conversationId === conversationId &&
            ['queued', 'running', 'cancel_requested'].includes(item.status),
        )
      ) {
        throw new Error('当前任务已有运行中的执行');
      }
      const run: TaskRun = {
        ...input,
        status: 'queued',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      bundle.runs.push(run);
      bundle.conversation.status = 'running';
      bundle.conversation.updatedAt = input.createdAt;
      upsertLocal(bundle);
      return run;
    });
    const created = raw as TaskRun;
    return input.chapterId && !created.chapterId
      ? { ...created, chapterId: input.chapterId }
      : created;
  },

  async updateRun(
    runId: string,
    status: TaskRun['status'],
    patch: { error?: string; startedAt?: string; finishedAt?: string } = {},
  ): Promise<TaskRun> {
    const input = {
      runId,
      status,
      error: patch.error,
      updatedAt: nowISO(),
      startedAt: patch.startedAt,
      finishedAt: patch.finishedAt,
    };
    const raw = await dbCall<unknown>('update_task_run', { input }, () => {
      const state = localState();
      const bundle = state.bundles.find((item) => item.runs.some((run) => run.runId === runId));
      const run = bundle?.runs.find((item) => item.runId === runId);
      if (!bundle || !run) throw new Error('任务运行不存在');
      if (isTerminalRun(run.status)) {
        if (
          run.status === status &&
          patch.error === undefined &&
          patch.startedAt === undefined &&
          patch.finishedAt === undefined
        ) {
          return run;
        }
        throw new Error('已结束的任务运行不可改写');
      }
      if (!taskRunTransitionAllowed(run.status, status)) {
        throw new Error('任务运行状态迁移无效');
      }
      Object.assign(run, {
        status,
        error: patch.error,
        updatedAt: input.updatedAt,
        startedAt: patch.startedAt ?? run.startedAt,
        finishedAt: patch.finishedAt,
      });
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        reconcileLocalConversationStatus(
          bundle,
          status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'idle',
          input.updatedAt,
        );
      } else {
        bundle.conversation.updatedAt = input.updatedAt;
      }
      upsertLocal(bundle);
      return run;
    });
    return raw as TaskRun;
  },

  async appendToolEvent(
    input: Omit<ToolCallEvent, 'eventId' | 'sequence'>,
  ): Promise<ToolCallEvent> {
    const request = { ...input, eventId: generateId() };
    const raw = await dbCall<unknown>('append_tool_call_event', { input: request }, () => {
      const state = localState();
      const bundle = state.bundles.find((item) =>
        item.runs.some((run) => run.runId === input.runId),
      );
      if (!bundle) throw new Error('任务运行不存在');
      if (!['pending', 'queued', 'running'].includes(input.status)) {
        throw new Error('工具调用初始状态无效');
      }
      const run = bundle.runs.find((item) => item.runId === input.runId);
      if (!run || isTerminalRun(run.status)) throw new Error('已结束的任务运行不能追加工具调用');
      const event: ToolCallEvent = {
        ...request,
        sequence: bundle.toolEvents.filter((item) => item.runId === input.runId).length,
      };
      bundle.toolEvents.push(event);
      bundle.conversation.updatedAt = input.createdAt;
      upsertLocal(bundle);
      return event;
    });
    return raw as ToolCallEvent;
  },

  async updateToolEvent(
    event: ToolCallEvent,
    patch: Pick<ToolCallEvent, 'status' | 'durationMs' | 'error' | 'result' | 'finishedAt'>,
  ): Promise<ToolCallEvent> {
    const input = { eventId: event.eventId, ...patch };
    const raw = await dbCall<unknown>('update_tool_call_event', { input }, () => {
      const state = localState();
      const bundle = state.bundles.find((item) =>
        item.toolEvents.some((item) => item.eventId === event.eventId),
      );
      const current = bundle?.toolEvents.find((item) => item.eventId === event.eventId);
      if (!bundle || !current) throw new Error('工具调用事件不存在');
      if (isTerminalToolEvent(current.status)) {
        if (
          current.status === patch.status &&
          patch.durationMs === undefined &&
          patch.error === undefined &&
          patch.result === undefined &&
          patch.finishedAt === undefined
        ) {
          return current;
        }
        throw new Error('已结束的工具调用不可改写');
      }
      if (!toolEventTransitionAllowed(current.status, patch.status)) {
        throw new Error('工具调用状态迁移无效');
      }
      if (isTerminalToolEvent(patch.status) && patch.finishedAt === undefined) {
        throw new Error('工具调用终态必须记录完成时间');
      }
      if (patch.durationMs !== undefined && patch.durationMs < 0) {
        throw new Error('工具调用耗时不能为负数');
      }
      Object.assign(
        current,
        Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      );
      bundle.conversation.updatedAt = new Date().toISOString();
      upsertLocal(bundle);
      return current;
    });
    return raw as ToolCallEvent;
  },

  async recordBrowserArtifactDecision(decision: ArtifactDecision): Promise<ArtifactDecision> {
    if (isTauri()) throw new Error('桌面端产物决定必须由 SQLite 权威命令记录');
    const bundle = localBundle(decision.conversationId);
    if (!bundle) throw new Error('任务对话不存在');
    const card = bundle.artifacts.find((item) => item.cardId === decision.cardId);
    if (!card || card.artifactId !== decision.artifactId) {
      throw new Error('产物决定与候选卡片或任务不匹配');
    }
    const decisions = bundle.decisions ?? (bundle.decisions = []);
    const existing = decisions.find(
      (item) =>
        item.artifactId === decision.artifactId &&
        item.decision === decision.decision &&
        item.idempotencyKey === decision.idempotencyKey,
    );
    if (
      existing &&
      (existing.artifactHash !== decision.artifactHash ||
        existing.cardId !== decision.cardId ||
        existing.conversationId !== decision.conversationId ||
        existing.actor !== decision.actor ||
        existing.targetType !== decision.targetType ||
        existing.targetId !== decision.targetId ||
        existing.baseRevision !== decision.baseRevision ||
        existing.applyTransactionId !== decision.applyTransactionId ||
        existing.conflictCode !== decision.conflictCode)
    ) {
      throw new Error('既有产物决定与当前重放请求身份不一致');
    }
    const recorded = existing ?? clone(decision);
    if (!existing) decisions.push(recorded);
    reconcileLocalConversationStatus(bundle, decisionFallbackStatus(recorded), recorded.createdAt);
    upsertLocal(bundle);
    return clone(recorded);
  },

  async issueBrowserReviewAuthorization(
    conversationId: string,
    authorization: ReviewAuthorization,
  ): Promise<ReviewAuthorization> {
    if (isTauri()) throw new Error('桌面端审阅授权必须由 SQLite 权威命令签发');
    const bundle = localBundle(conversationId);
    if (!bundle) throw new Error('任务对话不存在');
    const decision = (bundle.decisions ?? []).find(
      (item) => item.decisionId === authorization.decisionId,
    );
    if (
      !decision ||
      decision.decision !== 'confirm' ||
      decision.actor !== 'user' ||
      decision.targetType !== 'chapter' ||
      decision.targetId !== authorization.chapterId ||
      decision.artifactId !== authorization.artifactId ||
      bundle.conversation.novelId !== authorization.novelId
    ) {
      throw new Error('审阅授权与章节候选决定不匹配');
    }
    const authorizations = bundle.authorizations ?? (bundle.authorizations = []);
    const existing = authorizations.find((item) => item.decisionId === authorization.decisionId);
    if (existing) {
      if (
        existing.authorizationId !== authorization.authorizationId ||
        existing.artifactId !== authorization.artifactId ||
        existing.novelId !== authorization.novelId ||
        existing.chapterId !== authorization.chapterId
      ) {
        throw new Error('既有审阅授权与当前请求身份不一致');
      }
      return clone(existing);
    }
    authorizations.push(clone(authorization));
    reconcileLocalConversationStatus(bundle, 'waiting_user', authorization.issuedAt);
    upsertLocal(bundle);
    return clone(authorization);
  },

  async getBrowserReviewAuthorization(
    authorizationId: string,
  ): Promise<ReviewAuthorization | null> {
    if (isTauri()) throw new Error('桌面端审阅授权必须从 SQLite 读取');
    for (const bundle of localState().bundles) {
      const authorization = (bundle.authorizations ?? []).find(
        (item) => item.authorizationId === authorizationId,
      );
      if (authorization) return clone(authorization);
    }
    return null;
  },

  async completeBrowserReviewAdoption(
    authorizationId: string,
    draftId: string,
  ): Promise<ReviewAuthorization> {
    if (isTauri()) throw new Error('桌面端章节采用必须由 SQLite 权威事务完成');
    const bundle = localState().bundles.find((item) =>
      (item.authorizations ?? []).some(
        (authorization) => authorization.authorizationId === authorizationId,
      ),
    );
    const authorization = (bundle?.authorizations ?? []).find(
      (item) => item.authorizationId === authorizationId,
    );
    if (!bundle || !authorization) throw new Error('审阅授权不存在');
    if (authorization.status === 'consumed') {
      if (authorization.consumedByDraftId !== draftId) {
        throw new Error('审阅授权已被其他草稿消费');
      }
      reconcileLocalConversationStatus(bundle, 'completed', authorization.consumedAt ?? nowISO());
      upsertLocal(bundle);
      return clone(authorization);
    }
    if (authorization.status !== 'issued') throw new Error('审阅授权已失效');
    const consumedAt = nowISO();
    Object.assign(authorization, {
      status: 'consumed' as const,
      consumedAt,
      consumedByDraftId: draftId,
    });
    reconcileLocalConversationStatus(bundle, 'completed', consumedAt);
    upsertLocal(bundle);
    return clone(authorization);
  },

  async publishStructuredCandidate(input: {
    conversationId: string;
    novelId: string;
    chapterId?: string;
    artifactType: ConversationArtifactCard['artifactType'];
    derivationType?: string;
    title: string;
    summary: string;
    structuredPayloadJson: unknown;
  }): Promise<ConversationArtifactCard> {
    const createdAt = nowISO();
    const raw = await dbCall<unknown>(
      'publish_structured_candidate',
      {
        input: {
          conversationId: input.conversationId,
          novelId: input.novelId,
          chapterId: input.chapterId,
          artifactType: input.artifactType,
          derivationType: input.derivationType,
          title: input.title,
          summary: input.summary,
          structuredPayloadJson: input.structuredPayloadJson,
          createdAt,
        },
      },
      () => {
        const bundle = localBundle(input.conversationId);
        if (!bundle) throw new Error('任务对话不存在');
        const card: ConversationArtifactCard = {
          cardId: generateId(),
          conversationId: input.conversationId,
          artifactId: `browser-${generateId()}`,
          artifactType: input.artifactType,
          title: input.title,
          summary: input.summary,
          content: JSON.stringify(input.structuredPayloadJson),
          status: 'candidate',
          createdAt,
        };
        bundle.artifacts.push(card);
        reconcileLocalConversationStatus(bundle, 'waiting_user', createdAt);
        upsertLocal(bundle);
        return card;
      },
    );
    return raw as ConversationArtifactCard;
  },

  async createArtifactCard(
    input: Omit<ConversationArtifactCard, 'cardId'>,
  ): Promise<ConversationArtifactCard> {
    const request = { ...input, cardId: generateId() };
    const raw = await dbCall<unknown>(
      'create_conversation_artifact_card',
      { input: request },
      () => {
        if (!input.artifactId) throw new Error('对话产物卡片必须引用 ResultArtifact');
        if (input.content) throw new Error('对话产物卡片不得保存候选正文');
        throw new Error('浏览器 fallback 不创建或伪造 ResultArtifact 投影');
      },
    );
    return raw as ConversationArtifactCard;
  },

  isPersistent(): boolean {
    return isTauri();
  },
};
