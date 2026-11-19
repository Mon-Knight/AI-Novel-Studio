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
import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import type { TaskDomainEntry } from '../../types/taskDomainEntry';
import { hydrateTaskModelSnapshotRuntime } from '../conversation/taskModelSnapshot';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CANONICAL_TOOL_IDS } from '../capabilities/canonical/canonicalToolTypes';
import {
  buildDshTurnContract,
  classifyTaskIntent,
  type CandidateToolName,
  type ContextReadToolName,
  type DshTaskKind,
  type DshTurnContract,
  type CreativePlannedAction,
} from '../conversation/taskGoalRouting';

export const DSH_TASK_PROJECTION_EVENT = 'ans://task-runtime-projection';
export const DSH_PLUGIN_PROBE_CONVERSATION_ID = '__ans_plugin_probe__';

export interface DshTaskProjectionNotice {
  conversationId: string;
  runId: string;
  kind: 'run' | 'tool' | 'assistant' | 'artifact' | 'terminal';
  occurredAt: string;
}

export interface DshTaskRuntimeInput {
  conversationId: string;
  /** `null` is the explicit desktop library scope; Rust requires its library entry. */
  novelId?: string | null;
  turnId: string;
  goal: string;
  retrySourceRunId?: string;
  chapterId?: string;
  modelSnapshot: TaskModelSnapshot;
  /** Native root configuration; requests cannot mint phase, child or apply authority. */
  unifiedRuntime?: {
    version: 1;
    entry?: TaskDomainEntry;
    localCommand?: {
      kind: 'task_word_target';
      targetWordCount: number;
      wordRange: { target: number; minimum: number; maximum: number };
    };
    writingPreferences?: {
      targetWordCount?: number;
      wordRangePercents: {
        hardMinimumPercent: number;
        hardMaximumPercent: number;
      };
    };
  };
  /** Renderer-only; stripped before IPC and checked after credential loading. */
  cancellationSignal?: AbortSignal;
  taskKind: DshTaskKind;
  expectedTool?: CandidateToolName;
  expectedArtifactType?: string;
  requiredReadTools: ContextReadToolName[];
  /**
   * Dialogue uses optional reads plus creative.plan_action; explicit Canonical reads
   * and Writing SubAgent turns retain their own fixed allowlists.
   */
  allowedTools?: readonly string[];
  /** Writing SubAgent turns: the host enforces this word range on the chapter candidate. */
  chapterWordRange?: { target: number; minimum: number; maximum: number };
  /** Untrusted identity, never client-verified content or adoption authorization. */
  revisionSource?: ArtifactRevisionSource;
  /** Previous-chapter id and full-text hash. The body is never sent. */
  continuityClaim?: { previousChapterId: string; sourceHash: string };
  /**
   * Host gate for chapter candidates. `draft` withholds the artifact; `admit`
   * re-reads that exact run and does not call the provider.
   */
  chapterHostGate?: {
    phase: 'draft' | 'admit';
    sourceRunId?: string;
    contentHash?: string;
    issueCodes?: string[];
    issueSeverities?: Array<'error' | 'warning'>;
    maxIntegrityRepairs?: number;
    /** Previous draft in the same native budget epoch. Absence must not open a new epoch. */
    continuesRunId?: string;
    /** Explicit user retry. The native host opens the epoch; this is not a remaining-count. */
    explicitRetry?: boolean;
  };
}

/** Canonical-only tools requested by desktop read-intent DSH turns. */
export const CANONICAL_READ_ALLOWED_TOOLS: readonly string[] = [...CANONICAL_TOOL_IDS];

export const CREATIVE_DIALOGUE_ALLOWED_TOOLS: readonly string[] = [
  'novel.read_context',
  'chapter.read_outline',
  'get_character_states',
  'search_memory',
  'creative.plan_action',
];

export type DshTaskStartContract = DshTurnContract & {
  allowedTools?: readonly string[];
};

/**
 * Build the DSH start contract for a Workbench turn.
 * Read intent requests Canonical-only tools; structured_write/audit stay on the
 * legacy DSH allowlist. chapter_write never reaches this helper.
 */
export function buildDshTaskStartContract(
  goal: string,
  chapterId?: string,
  revisionSource?: ArtifactRevisionSource,
): DshTaskStartContract {
  const contract = buildDshTurnContract(goal, chapterId, revisionSource);
  if (classifyTaskIntent(goal, revisionSource) === 'read') {
    return {
      ...contract,
      allowedTools: [...CANONICAL_READ_ALLOWED_TOOLS],
    };
  }
  return contract;
}

export interface DshTaskRuntimeResult {
  run: TaskRun;
  sessionId: string;
  agentId: string;
  workerId: string;
  runtime: 'dsh-headless-persistent' | 'ans-native-local-command';
  assistantText?: string;
  artifactId?: string;
  /** Only a successful, scope-validated creative.plan_action tool may provide this. */
  plannedAction?: CreativePlannedAction;
  sessionLifecycle?: 'created' | 'continued' | 'resumed';
  /** Historical diagnostic evidence only; actual turns do not run a model probe. */
  modelToolAttestation?: ModelToolCallingAttestation;
  /** Present only while a length-valid chapter draft is withheld from admission. */
  pendingChapterCandidate?: {
    runId: string;
    contentHash: string;
    text: string;
    wordCount: number;
    previousChapterText?: string;
    previousChapterId?: string;
    previousSourceHash?: string;
  };
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
// Temporary transport cancellation: remove this seam once native code creates the
// Run before hydrating its exact credentials. No automatic retries are owned here.
// Entries are removed before dsh_start_task_turn; no Run, phase or budget is stored here.
const pendingDispatches = new Map<string, AbortController>();

export function resolveDshTaskApiKey(modelSnapshot: TaskModelSnapshot): string {
  if (modelSnapshot.runtimeMode !== 'api') return '';
  // Resolve against the same compatibility-hydrated snapshot used when a
  // task starts.  This matters for pre-v3.6 snapshots that did not persist an
  // endpoint: hydration may restore the active endpoint only for an exact
  // provider/model match.  An ambiguous legacy snapshot stays endpoint-less
  // and therefore fails closed for remote providers.
  const resolvedSnapshot = hydrateTaskModelSnapshotRuntime(modelSnapshot);
  const snapshotBaseUrl = resolvedSnapshot.baseUrl ?? '';
  const apiKey = resolveSessionModelApiKey({
    scope: 'provider',
    providerId: resolvedSnapshot.providerId,
    baseUrl: snapshotBaseUrl,
    modelId: resolvedSnapshot.modelId,
  });
  if (modelSnapshot.runtimeMode === 'api' && !apiKey && !isLoopbackAiBaseUrl(snapshotBaseUrl)) {
    throw new Error('冻结模型没有可用的匹配凭据，已拒绝启动任务。');
  }
  return apiKey;
}

export function hasUsableDshTaskCredential(modelSnapshot: TaskModelSnapshot): boolean {
  if (modelSnapshot.runtimeMode !== 'api') return true;
  try {
    const resolvedSnapshot = hydrateTaskModelSnapshotRuntime(modelSnapshot);
    return (
      Boolean(resolveDshTaskApiKey(resolvedSnapshot)) ||
      isLoopbackAiBaseUrl(resolvedSnapshot.baseUrl ?? '')
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
    const resolvedSnapshot = hydrateTaskModelSnapshotRuntime(modelSnapshot);
    return (
      Boolean(await resolveDshTaskApiKeyAsync(resolvedSnapshot)) ||
      isLoopbackAiBaseUrl(resolvedSnapshot.baseUrl ?? '')
    );
  } catch {
    return false;
  }
}

export async function resolveDshTaskApiKeyAsync(modelSnapshot: TaskModelSnapshot): Promise<string> {
  if (modelSnapshot.runtimeMode !== 'api') return '';
  // Keep async readiness checks identical to the synchronous/runtime path;
  // otherwise the composer can report a missing credential that sending can
  // actually recover from (or vice versa).
  const resolvedSnapshot = hydrateTaskModelSnapshotRuntime(modelSnapshot);
  const snapshotBaseUrl = resolvedSnapshot.baseUrl ?? '';
  const apiKey = await resolveSessionModelApiKeyAsync({
    scope: 'provider',
    providerId: resolvedSnapshot.providerId,
    baseUrl: snapshotBaseUrl,
    modelId: resolvedSnapshot.modelId,
  });
  if (modelSnapshot.runtimeMode === 'api' && !apiKey && !isLoopbackAiBaseUrl(snapshotBaseUrl)) {
    throw new Error('冻结模型没有可用的匹配凭据，已拒绝启动任务。');
  }
  return apiKey;
}

async function credentialForDispatch(
  snapshot: TaskModelSnapshot,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const stopped = new Promise<string>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Credential errors still reach the native Run as an empty exact key. Abort
    // is raced separately so it cannot be mistaken for missing credentials.
    return await Promise.race([resolveDshTaskApiKeyAsync(snapshot).catch(() => ''), stopped]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
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
    let dispatched = false;
    const preparation = new AbortController();
    pendingDispatches.set(input.conversationId, preparation);
    const onAbort = () => {
      preparation.abort(input.cancellationSignal?.reason);
      if (!dispatched) return;
      // Do not synthesize a cancelled result: only the native terminal receipt
      // decides whether cancellation or an already-committed result won the race.
      void dshTaskRuntimeService.cancel(input.conversationId).catch(() => undefined);
    };
    input.cancellationSignal?.addEventListener('abort', onAbort, { once: true });
    if (input.cancellationSignal?.aborted) onAbort();
    try {
      preparation.signal.throwIfAborted();
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
      // Missing exact credentials fail inside the native Run; never substitute a scope.
      const apiKey = input.unifiedRuntime?.localCommand
        ? ''
        : await credentialForDispatch(modelSnapshot, preparation.signal);
      preparation.signal.throwIfAborted();
      const { cancellationSignal, ...nativeInput } = input;
      void cancellationSignal;
      pendingDispatches.delete(input.conversationId);
      dispatched = true;
      return await tauriInvoke<DshTaskRuntimeResult>('dsh_start_task_turn', {
        input: {
          ...nativeInput,
          modelSnapshot,
          apiKey,
          requestPolicy: {
            maxRequestsPerMinute: settings.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE,
            maxConcurrentRequests: settings.maxConcurrentAiRequests ?? 2,
            dailyTokenBudget: settings.dailyTokenBudget,
            dailyCostBudgetUsd: settings.dailyCostBudgetUsd,
            warningPercent: settings.budgetWarningPercent ?? 80,
            timeoutSeconds: modelSnapshot.options.timeoutSeconds ?? settings.timeoutSeconds ?? 120,
          },
        },
      });
    } finally {
      input.cancellationSignal?.removeEventListener('abort', onAbort);
      pendingDispatches.delete(input.conversationId);
      active.delete(input.conversationId);
      unlisten?.();
    }
  },

  cancel(conversationId: string): Promise<DshTaskRuntimeStatus> {
    const pending = pendingDispatches.get(conversationId);
    if (pending) {
      pending.abort();
      return Promise.resolve({
        conversationId,
        runId: '',
        sessionId: '',
        workerId: '',
        status: 'cancel_requested',
        runtime: 'ans-task-ingress',
      });
    }
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

  /** Transport occupancy only; persisted lifecycle state still comes from listStatuses. */
  listInFlightConversationIds(): string[] {
    return [...active];
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
      // Keep credential failures visible to the projection caller.  A remote
      // snapshot without its session credential must not be probed as though
      // it were a credential-free local runtime.
      apiKey = await resolveDshTaskApiKeyAsync(probeSnapshot);
    }
    return tauriInvoke<Record<string, unknown>[]>('dsh_list_current_plugins', {
      conversationId: conversationId ?? null,
      modelSnapshot: probeSnapshot ?? null,
      apiKey,
    });
  },

  /**
   * Synchronize one saved API model with the pinned Runtime.  This is a
   * registration/initialization probe only; it does not send a user turn or
   * manufacture a healthy model row.  The native command validates the exact
   * route, endpoint and credential before publishing health.
   */
  async initializeConfiguredModel(
    modelSnapshot: TaskModelSnapshot,
  ): Promise<Record<string, unknown>[]> {
    if (modelSnapshot.runtimeMode !== 'api') return [];
    return dshTaskRuntimeService.listCurrentPlugins(
      DSH_PLUGIN_PROBE_CONVERSATION_ID,
      modelSnapshot,
    );
  },
};
