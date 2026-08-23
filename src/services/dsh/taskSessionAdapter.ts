import { isTauri } from '../database/db';
import {
  taskRuntimeAdapter,
  type TaskRuntimeEvent,
  type TaskRuntimeInput,
} from '../conversation/taskRuntimeAdapter';
import type { TaskRun } from '../../types/conversation';
import { dshTaskRuntimeService } from './taskRuntimeService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { taskConversationService } from '../conversation/taskConversationService';
import { classifyTaskIntent, isConversationalGoal } from '../conversation/taskGoalRouting';

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

async function completeConversationalTurn(
  input: TaskRuntimeInput,
  session: TaskSession,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const modelSnapshot = input.modelSnapshot ?? captureTaskModelSnapshot();
  const run = await taskConversationService.createRun(
    input.conversationId,
    input.turnId,
    modelSnapshot,
    session.workerId,
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
    const session = sessionFor(input);
    if (isConversationalGoal(input.goal)) {
      return completeConversationalTurn(input, session, onEvent);
    }
    // Chapter write goes through the ANS writer, not the DSH candidate sink.
    if (!isTauri() || classifyTaskIntent(input.goal) === 'chapter_write') {
      return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
    }
    if (isTauri()) {
      return dshTaskRuntimeService
        .start(
          {
            ...input,
            modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
          },
          (notice) => {
            void taskConversationService.get(input.conversationId).then((bundle) => {
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

  cancel(conversationId: string): boolean {
    if (taskRuntimeAdapter.isRunning(conversationId)) {
      return taskRuntimeAdapter.cancel(conversationId);
    }
    if (isTauri()) {
      if (!dshTaskRuntimeService.isRunning(conversationId)) return false;
      dshTaskRuntimeService.cancel(conversationId);
      return true;
    }
    return false;
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
        .filter((item) => item.status === 'running' || item.status === 'cancel_requested')
        .forEach((item) => ids.add(item.conversationId));
    }
    return [...ids];
  },

  clear(conversationId: string): void {
    sessions.delete(conversationId);
  },
};
