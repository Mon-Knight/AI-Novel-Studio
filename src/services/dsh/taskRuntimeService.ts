import { getAiSettings } from '../ai/aiSettingsStore';
import { tauriInvoke } from '../tauri/runtime';
import type { TaskModelSnapshot, TaskRun } from '../../types/conversation';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const DSH_TASK_PROJECTION_EVENT = 'ans://task-runtime-projection';

export interface DshTaskProjectionNotice {
  conversationId: string;
  runId: string;
  kind: 'run' | 'tool' | 'assistant' | 'artifact' | 'terminal';
  occurredAt: string;
}

export interface DshTaskRuntimeInput {
  conversationId: string;
  novelId: string;
  turnId: string;
  goal: string;
  chapterId?: string;
  modelSnapshot: TaskModelSnapshot;
}

export interface DshTaskRuntimeResult {
  run: TaskRun;
  sessionId: string;
  agentId: string;
  workerId: string;
  runtime: 'dsh-headless-persistent';
  assistantText?: string;
  artifactId?: string;
  sessionLifecycle?: 'created' | 'continued' | 'resumed';
}

export interface DshTaskRuntimeStatus {
  conversationId: string;
  runId: string;
  sessionId: string;
  workerId: string;
  status: string;
  runtime: string;
  error?: string;
}

const active = new Set<string>();

export const dshTaskRuntimeService = {
  async start(
    input: DshTaskRuntimeInput,
    onProjection?: (notice: DshTaskProjectionNotice) => void,
  ): Promise<DshTaskRuntimeResult> {
    if (active.has(input.conversationId)) {
      throw new Error('当前任务已有活动运行');
    }
    active.add(input.conversationId);
    let unlisten: UnlistenFn | undefined;
    try {
      if (onProjection) {
        unlisten = await listen<DshTaskProjectionNotice>(
          DSH_TASK_PROJECTION_EVENT,
          ({ payload }) => {
            if (payload.conversationId === input.conversationId) onProjection(payload);
          },
        );
      }
      const settings = getAiSettings();
      return await tauriInvoke<DshTaskRuntimeResult>('dsh_start_task_turn', {
        input: {
          ...input,
          apiKey: settings.apiKey,
          requestPolicy: {
            maxRequestsPerMinute: settings.maxRequestsPerMinute ?? 12,
            maxConcurrentRequests: settings.maxConcurrentAiRequests ?? 2,
            dailyTokenBudget: settings.dailyTokenBudget,
            dailyCostBudgetUsd: settings.dailyCostBudgetUsd,
            warningPercent: settings.budgetWarningPercent ?? 80,
            timeoutSeconds: settings.timeoutSeconds ?? 120,
          },
        },
      });
    } finally {
      active.delete(input.conversationId);
      unlisten?.();
    }
  },

  cancel(conversationId: string): void {
    void tauriInvoke('dsh_cancel_task_run', { conversationId }).catch(() => undefined);
  },

  isRunning(conversationId: string): boolean {
    return active.has(conversationId);
  },

  getStatus(conversationId: string): Promise<DshTaskRuntimeStatus | null> {
    return tauriInvoke<DshTaskRuntimeStatus | null>('dsh_get_task_runtime_status', {
      conversationId,
    });
  },

  listStatuses(): Promise<DshTaskRuntimeStatus[]> {
    return tauriInvoke<DshTaskRuntimeStatus[]>('dsh_list_task_runtime_status');
  },

  describeRuntime(): Promise<Record<string, unknown>> {
    return tauriInvoke('dsh_describe_runtime');
  },

  listCurrentPlugins(conversationId?: string): Promise<Record<string, unknown>[]> {
    return tauriInvoke('dsh_list_current_plugins', { conversationId: conversationId ?? null });
  },
};
