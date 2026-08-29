import { isTauri } from '../database/db';
import {
  taskRuntimeAdapter,
  type TaskRuntimeEvent,
  type TaskRuntimeInput,
} from '../conversation/taskRuntimeAdapter';
import type { TaskModelSnapshot, TaskRun } from '../../types/conversation';
import { dshTaskRuntimeService, type DshTaskProjectionNotice } from './taskRuntimeService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { taskConversationService } from '../conversation/taskConversationService';
import {
  buildDshTurnContract,
  classifyTaskIntent,
  isConversationalGoal,
} from '../conversation/taskGoalRouting';

export const WORKBENCH_CONVERSATIONAL_REPLY =
  '我是创作工作台助手。你可以用自然语言让我读取作品上下文、检索记忆，或生成章节、大纲、角色、事件、设定候选，以及润色、质量检查和章节总结。候选不会直接写入正式正文，需要你确认后才会进入审阅或应用。问候和能力询问不会调用生成工具。';

/**
 * Stable ANS boundary for the pinned DSH headless carrier. Cordis/DSH objects
 * never cross this adapter; the workbench only sees task/session identifiers
 * and the event projection owned by ANS.
 */
export const DSH_SOURCE_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';
export const DSH_REFERENCE_COMMIT = '141eb6fef83422698aef7a981029e843e8161534';

export interface TaskSession {
  sessionId: string;
  conversationId: string;
  agentId: string;
  workerId: string;
  runtime: 'dsh-headless-persistent' | 'ans-provider-fallback';
  createdAt: string;
}

const sessions = new Map<string, TaskSession>();

export function isActiveDshTaskRuntimeStatus(status: string): boolean {
  return (
    status === 'attesting' ||
    status === 'queued' ||
    status === 'running' ||
    status === 'cancel_requested'
  );
}

export function captureLocalConversationalSnapshot(): TaskModelSnapshot {
  return {
    providerId: 'ans-local',
    modelId: 'workbench-help-v1',
    runtimeMode: 'mock',
    capabilities: ['conversation_turn'],
    options: {},
    runtime: {
      adapterProtocol: 'ans_local_conversation_v1',
      adapterProvider: 'ans-local',
      bundle: 'application',
      profile: 'workbench-local-help-v1',
    },
    capturedAt: new Date().toISOString(),
  };
}

async function completeConversationalTurn(
  input: TaskRuntimeInput,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const modelSnapshot = captureLocalConversationalSnapshot();
  const run = await taskConversationService.createRun(
    input.conversationId,
    input.turnId,
    modelSnapshot,
    `worker-ans-local-${input.conversationId}`,
    input.chapterId,
  );
  const startedAt = new Date().toISOString();
  let currentRun = await taskConversationService.updateRun(run.runId, 'running', { startedAt });
  onEvent?.({ run: currentRun });
  await taskConversationService.appendTurn(
    input.conversationId,
    'assistant',
    WORKBENCH_CONVERSATIONAL_REPLY,
  );
  currentRun = await taskConversationService.updateRun(run.runId, 'completed', {
    finishedAt: new Date().toISOString(),
  });
  onEvent?.({ run: currentRun });
  return currentRun;
}

function sessionFor(input: TaskRuntimeInput): TaskSession {
  const existing = sessions.get(input.conversationId);
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  const session: TaskSession = {
    sessionId: `session-${input.conversationId}`,
    conversationId: input.conversationId,
    agentId: `agent-${input.conversationId}`,
    workerId: `worker-${input.conversationId}`,
    runtime: isTauri() ? 'dsh-headless-persistent' : 'ans-provider-fallback',
    createdAt,
  };
  sessions.set(input.conversationId, session);
  return session;
}

export const taskSessionAdapter = {
  describeRuntime() {
    return {
      sourceCommit: DSH_SOURCE_COMMIT,
      referenceCommit: DSH_REFERENCE_COMMIT,
      protocol: 'ans_task_session_v2',
      bundle: 'scripts/dsh/build-runtime-payload.mjs',
      isolation: 'one-persistent-worker-per-task',
      status: isTauri() ? ('loaded' as const) : ('unavailable' as const),
    };
  },

  getSession(input: TaskRuntimeInput): TaskSession {
    return sessionFor(input);
  },

  startTurn(
    input: TaskRuntimeInput,
    onEvent?: (event: TaskRuntimeEvent) => void,
  ): Promise<TaskRun> {
    if (isConversationalGoal(input.goal)) {
      return completeConversationalTurn(input, onEvent);
    }
    const session = sessionFor(input);
    // Chapter write goes through the ANS writer, not the DSH candidate sink.
    if (!isTauri() || classifyTaskIntent(input.goal) === 'chapter_write') {
      return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
    }
    if (isTauri()) {
      const contract = buildDshTurnContract(input.goal, input.chapterId);
      return dshTaskRuntimeService
        .start(
          {
            ...input,
            ...contract,
            modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
          },
          (notice) => {
            void taskConversationService
              .get(input.conversationId, { hydrateArtifacts: false })
              .then((bundle) => {
                const run = bundle?.runs.find((item) => item.runId === notice.runId);
                if (run) onEvent?.({ run });
              });
          },
        )
        .then((result) => {
          onEvent?.({ run: result.run });
          return result.run;
        });
    }
    return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
  },

  async cancel(conversationId: string): Promise<boolean> {
    if (taskRuntimeAdapter.isRunning(conversationId)) {
      return taskRuntimeAdapter.cancel(conversationId);
    }
    if (isTauri()) {
      // A WebView reload clears the renderer-local active Set while the Rust
      // worker remains alive. Always ask the process-authoritative runtime.
      const status = await dshTaskRuntimeService.cancel(conversationId);
      return status.status === 'cancel_requested';
    }
    return false;
  },

  subscribeToRuntimeProjections(
    onProjection: (notice: DshTaskProjectionNotice) => void,
  ): Promise<() => void> {
    if (!isTauri()) return Promise.resolve(() => undefined);
    return dshTaskRuntimeService.subscribe(onProjection);
  },

  async isRunningAuthoritatively(conversationId: string): Promise<boolean> {
    if (taskRuntimeAdapter.isRunning(conversationId)) return true;
    if (!isTauri()) return false;
    const status = await dshTaskRuntimeService.getStatus(conversationId);
    return Boolean(status && isActiveDshTaskRuntimeStatus(status.status));
  },

  isRunning(conversationId: string): boolean {
    return (
      taskRuntimeAdapter.isRunning(conversationId) ||
      (isTauri() && dshTaskRuntimeService.isRunning(conversationId))
    );
  },

  async listRunningConversationIds(): Promise<string[]> {
    const ids = new Set(taskRuntimeAdapter.listRunningConversationIds());
    if (isTauri()) {
      const statuses = await dshTaskRuntimeService.listStatuses();
      statuses
        .filter((item) => isActiveDshTaskRuntimeStatus(item.status))
        .forEach((item) => ids.add(item.conversationId));
    }
    return [...ids];
  },

  clear(conversationId: string): void {
    sessions.delete(conversationId);
  },
};
