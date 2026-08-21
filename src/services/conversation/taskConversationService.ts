import { dbCall, generateId, isTauri, lsGet, lsSet, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import type {
  ArtifactDecision,
  ConversationArtifactCard,
  ConversationTurn,
  ReviewAuthorization,
  TaskConversation,
  TaskConversationBundle,
  TaskModelSnapshot,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';

const STORAGE_KEY = 'ai_novel_studio_task_conversations';

interface LocalConversationState {
  bundles: TaskConversationBundle[];
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
  return value ? clone(value) : undefined;
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

function normalizeBundle(raw: unknown): TaskConversationBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<TaskConversationBundle>;
  if (!item.conversation) return null;
  return {
    conversation: normalizeConversation(item.conversation),
    turns: Array.isArray(item.turns) ? (item.turns as ConversationTurn[]) : [],
    runs: Array.isArray(item.runs) ? (item.runs as TaskRun[]) : [],
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
      };
      if (!card.artifactId || !isTauri()) return projected;
      try {
        const artifact = await aiTaskRuntimeService.getArtifact(card.artifactId);
        return {
          ...projected,
          content: artifact.displayContent ?? artifact.rawContent,
        };
      } catch {
        return projected;
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

export const taskConversationService = {
  async recoverInterruptedRuns(
    error = '应用重新启动，上一轮运行已中断，请重新发送任务。',
  ): Promise<number> {
    const finishedAt = nowISO();
    const raw = await dbCall<number>('recover_task_runs', { input: { finishedAt, error } }, () => {
      const state = localState();
      let recovered = 0;
      for (const bundle of state.bundles) {
        const activeRuns = bundle.runs.filter((run) =>
          ['queued', 'running', 'cancel_requested'].includes(run.status),
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
        bundle.conversation.status = 'failed';
        bundle.conversation.updatedAt = finishedAt;
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
    const input = {
      conversationId: generateId(),
      novelId,
      title: title.trim() || '未命名任务',
      defaultModel: defaultModel ? clone(defaultModel) : undefined,
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

  async list(novelId?: string): Promise<TaskConversation[]> {
    const raw = await dbCall<unknown[]>(
      'list_task_conversations',
      {
        input: { novelId, limit: 100 },
      },
      () =>
        localState()
          .bundles.filter((bundle) => !novelId || bundle.conversation.novelId === novelId)
          .map((bundle) => bundle.conversation)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    return (Array.isArray(raw) ? raw : []).map(normalizeConversation);
  },

  async get(conversationId: string): Promise<TaskConversationBundle | null> {
    const raw = await dbCall<unknown | null>(
      'get_task_conversation',
      { conversationId },
      () => localBundle(conversationId) ?? null,
    );
    const bundle = normalizeBundle(raw);
    return bundle ? hydrateArtifactProjections(bundle) : null;
  },

  async updateDefaultModel(
    conversationId: string,
    defaultModel: TaskModelSnapshot,
  ): Promise<TaskConversation> {
    const input = {
      conversationId,
      defaultModel: clone(defaultModel),
      updatedAt: nowISO(),
    };
    const raw = await dbCall<unknown>('update_task_conversation_model', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
      bundle.conversation.defaultModel = input.defaultModel;
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
  ): Promise<TaskRun> {
    const input = {
      runId: generateId(),
      conversationId,
      turnId,
      modelSnapshot: clone(modelSnapshot),
      workerId,
      createdAt: nowISO(),
    };
    const raw = await dbCall<unknown>('create_task_run', { input }, () => {
      const bundle = localBundle(conversationId);
      if (!bundle) throw new Error('任务对话不存在');
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
    return raw as TaskRun;
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
        bundle.conversation.status =
          status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'idle';
      }
      bundle.conversation.updatedAt = input.updatedAt;
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

  async publishStructuredCandidate(input: {
    conversationId: string;
    novelId: string;
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
        bundle.conversation.updatedAt = createdAt;
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
