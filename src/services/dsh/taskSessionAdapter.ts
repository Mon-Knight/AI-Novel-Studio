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
    if (isTauri()) {
      if (!dshTaskRuntimeService.isRunning(conversationId)) return false;
      dshTaskRuntimeService.cancel(conversationId);
      return true;
    }
    return taskRuntimeAdapter.cancel(conversationId);
  },

  isRunning(conversationId: string): boolean {
    return isTauri()
      ? dshTaskRuntimeService.isRunning(conversationId)
      : taskRuntimeAdapter.isRunning(conversationId);
  },

  async listRunningConversationIds(): Promise<string[]> {
    if (!isTauri()) {
      return [];
    }
    const statuses = await dshTaskRuntimeService.listStatuses();
    return statuses
      .filter((item) => item.status === 'running' || item.status === 'cancel_requested')
      .map((item) => item.conversationId);
  },

  clear(conversationId: string): void {
    sessions.delete(conversationId);
  },
};
