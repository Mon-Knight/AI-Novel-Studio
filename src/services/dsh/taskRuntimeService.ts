import {
  DEFAULT_MAX_REQUESTS_PER_MINUTE,
  getAiSettings,
  resolveSessionModelApiKey,
  resolveSessionModelApiKeyAsync,
} from '../ai/aiSettingsStore';
import { isLoopbackAiBaseUrl } from '../ai/realAiClient';
import { tauriInvoke } from '../tauri/runtime';
import type {
  ModelToolCallingAttestation,
  TaskModelSnapshot,
  TaskRun,
} from '../../types/conversation';
import { hydrateTaskModelSnapshotRuntime } from '../conversation/taskModelSnapshot';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CandidateToolName,
  ContextReadToolName,
  DshTaskKind,
} from '../conversation/taskGoalRouting';

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
  taskKind: DshTaskKind;
  expectedTool?: CandidateToolName;
  expectedArtifactType?: string;
  requiredReadTools: ContextReadToolName[];
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
  modelToolAttestation: ModelToolCallingAttestation;
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

export function resolveDshTaskApiKey(modelSnapshot: TaskModelSnapshot): string {
  const snapshotBaseUrl = modelSnapshot.baseUrl ?? '';
  const apiKey = resolveSessionModelApiKey({
    scope: 'provider',
    providerId: modelSnapshot.providerId,
    baseUrl: snapshotBaseUrl,
    modelId: modelSnapshot.modelId,
  });
  if (modelSnapshot.runtimeMode === 'api' && !apiKey && !isLoopbackAiBaseUrl(snapshotBaseUrl)) {
    throw new Error('冻结模型没有本次应用会话内的匹配凭据，已拒绝启动任务。');
  }
  return apiKey;
}

export function hasUsableDshTaskCredential(modelSnapshot: TaskModelSnapshot): boolean {
  if (modelSnapshot.runtimeMode !== 'api') return true;
  try {
    return (
      Boolean(resolveDshTaskApiKey(modelSnapshot)) ||
      isLoopbackAiBaseUrl(modelSnapshot.baseUrl ?? '')
    );
  } catch {
    return false;
  }
}

export async function hasUsableDshTaskCredentialAsync(
  modelSnapshot: TaskModelSnapshot,
): Promise<boolean> {
  if (modelSnapshot.runtimeMode !== 'api') return true;
  try {
    return (
      Boolean(await resolveDshTaskApiKeyAsync(modelSnapshot)) ||
      isLoopbackAiBaseUrl(modelSnapshot.baseUrl ?? '')
    );
  } catch {
    return false;
  }
}

export async function resolveDshTaskApiKeyAsync(modelSnapshot: TaskModelSnapshot): Promise<string> {
  const snapshotBaseUrl = modelSnapshot.baseUrl ?? '';
  const apiKey = await resolveSessionModelApiKeyAsync({
    scope: 'provider',
    providerId: modelSnapshot.providerId,
    baseUrl: snapshotBaseUrl,
    modelId: modelSnapshot.modelId,
  });
  if (modelSnapshot.runtimeMode === 'api' && !apiKey && !isLoopbackAiBaseUrl(snapshotBaseUrl)) {
    throw new Error('冻结模型没有本次应用会话内的匹配凭据，已拒绝启动任务。');
  }
  return apiKey;
}

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
      const modelSnapshot = hydrateTaskModelSnapshotRuntime(input.modelSnapshot);
      const apiKey = await resolveDshTaskApiKeyAsync(modelSnapshot);
      return await tauriInvoke<DshTaskRuntimeResult>('dsh_start_task_turn', {
        input: {
          ...input,
          modelSnapshot,
          apiKey,
          requestPolicy: {
            maxRequestsPerMinute: settings.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE,
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

  cancel(conversationId: string): Promise<DshTaskRuntimeStatus> {
    return tauriInvoke<DshTaskRuntimeStatus>('dsh_cancel_task_run', { conversationId });
  },

  subscribe(onProjection: (notice: DshTaskProjectionNotice) => void): Promise<UnlistenFn> {
    return listen<DshTaskProjectionNotice>(DSH_TASK_PROJECTION_EVENT, ({ payload }) => {
      if (!payload?.conversationId || !payload.runId) return;
      onProjection(payload);
    });
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

  async listCurrentPlugins(
    conversationId?: string,
    modelSnapshot?: TaskModelSnapshot,
  ): Promise<Record<string, unknown>[]> {
    let apiKey = '';
    const probeSnapshot = modelSnapshot
      ? hydrateTaskModelSnapshotRuntime(modelSnapshot)
      : undefined;
    if (probeSnapshot) {
      try {
        apiKey = await resolveDshTaskApiKeyAsync(probeSnapshot);
      } catch {
        apiKey = '';
      }
    }
    return tauriInvoke<Record<string, unknown>[]>('dsh_list_current_plugins', {
      conversationId: conversationId ?? null,
      modelSnapshot: probeSnapshot ?? null,
      apiKey,
    });
  },
};
