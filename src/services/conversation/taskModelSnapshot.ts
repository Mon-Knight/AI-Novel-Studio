import { getAiSettings } from '../ai/aiSettingsStore';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { AiSettings } from '../../types/ai';

function normalizeApiProviderId(providerId: string): string {
  const normalized = providerId.trim();
  return normalized === 'deepseek' || normalized === 'deepseek-official'
    ? 'deepseek-official'
    : normalized;
}

/**
 * Restores runtime-only defaults for snapshots written by older releases.
 *
 * Endpoint rebinding is intentionally narrow: an explicit snapshot endpoint
 * always wins; a missing endpoint may borrow only the current settings'
 * endpoint when the normalized provider and model IDs match exactly. Saved
 * model cards and endpoints belonging to another identity are not searched,
 * because doing so could silently route an old task to a different service.
 * An unresolved remote snapshot remains endpoint-less and is rejected by the
 * credential/runtime gate; loopback snapshots may still run without a key.
 */
export function hydrateTaskModelSnapshotRuntime(snapshot: TaskModelSnapshot): TaskModelSnapshot {
  if (snapshot.runtimeMode !== 'api') return snapshot;
  const settings = getAiSettings();
  const providerId = normalizeApiProviderId(snapshot.providerId);
  const currentProviderId = normalizeApiProviderId(settings.provider);
  const matchesCurrentIdentity =
    providerId === currentProviderId && snapshot.modelId.trim() === settings.modelName.trim();
  const baseUrl =
    snapshot.baseUrl?.trim() || (matchesCurrentIdentity ? settings.baseUrl.trim() : '');
  const needsRuntime = !snapshot.runtime?.adapterProtocol;
  const needsBaseUrl = !snapshot.baseUrl?.trim() && Boolean(baseUrl);
  if (!needsRuntime && !needsBaseUrl && providerId === snapshot.providerId) return snapshot;
  return {
    ...snapshot,
    providerId,
    ...(baseUrl ? { baseUrl } : {}),
    runtime: needsRuntime
      ? {
          adapterProtocol: 'ans_task_session_v2',
          adapterProvider: providerId,
          dshSourceCommit:
            snapshot.runtime?.dshSourceCommit ?? '47f943859bef60e4160492346772ded9b24f765a',
          bundle: snapshot.runtime?.bundle ?? 'pinned-dsh-carrier',
          profile: snapshot.runtime?.profile ?? 'conversational-workbench-v2',
        }
      : snapshot.runtime,
  };
}

export function captureTaskModelSnapshot(providerId?: string, modelId?: string): TaskModelSnapshot {
  const settings = getAiSettings();
  const useMock = providerId === 'mock' || (!providerId && settings.runtimeMode === 'mock');
  const runtimeMode = useMock ? 'mock' : 'api';
  const frozenProviderId = useMock
    ? 'mock'
    : normalizeApiProviderId(providerId || settings.provider);
  const frozenModelId = modelId || (useMock ? 'Mock' : settings.modelName || 'default');
  const configuration = useMock
    ? settings
    : resolveModelConfiguration(settings, frozenProviderId, frozenModelId);
  return {
    providerId: frozenProviderId,
    modelId: frozenModelId,
    runtimeMode,
    baseUrl: runtimeMode === 'api' ? configuration.baseUrl : undefined,
    capabilities: ['conversation_turn', 'chapter_generate'],
    options: {
      temperature: configuration.temperature,
      maxTokens: configuration.maxTokens,
      timeoutSeconds: configuration.timeoutSeconds,
      contextCompression: {
        novelProviderId: 'ans.novel-context.extractive-v1',
        novelProviderVersion: '1.0.0',
        sessionCompaction: 'dsh-compaction-basic',
        sessionCompactionAuto: true,
      },
    },
    pricing:
      runtimeMode === 'api'
        ? {
            inputPricePerMillionTokens: configuration.inputPricePerMillionTokens,
            outputPricePerMillionTokens: configuration.outputPricePerMillionTokens,
          }
        : undefined,
    runtime: {
      adapterProtocol: useMock ? 'ans_provider_fallback_v1' : 'ans_task_session_v2',
      adapterProvider: useMock ? 'browser-fallback' : frozenProviderId,
      dshSourceCommit: useMock ? undefined : '47f943859bef60e4160492346772ded9b24f765a',
      bundle: useMock ? 'browser-deterministic' : 'pinned-dsh-carrier',
      profile: 'conversational-workbench-v2',
    },
    capturedAt: new Date().toISOString(),
  };
}

type ModelConfiguration = Pick<
  AiSettings,
  | 'baseUrl'
  | 'temperature'
  | 'maxTokens'
  | 'timeoutSeconds'
  | 'inputPricePerMillionTokens'
  | 'outputPricePerMillionTokens'
>;

/** Workbench provider selections cannot borrow gateway/local credential-scope configuration. */
function resolveModelConfiguration(
  settings: AiSettings,
  providerId: string,
  modelId: string,
): ModelConfiguration {
  const matches = (provider: string, model: string) =>
    normalizeApiProviderId(provider) === providerId && model.trim() === modelId.trim();
  if (settings.runtimeMode === 'api' && matches(settings.provider, settings.modelName)) {
    return settings;
  }
  const profiles: ModelConfiguration[] = (settings.savedApiModels ?? []).filter((item) =>
    matches(item.provider, item.modelName),
  );
  const endpoints = new Set(profiles.map((item) => item.baseUrl.trim().replace(/\/+$/, '')));
  if (profiles.length === 1) return profiles[0];
  if (profiles.length > 1 && endpoints.size === 1) {
    throw new Error(`模型 ${providerId}:${modelId} 有多个配置，请在设置中心选定该模型后重试。`);
  }
  throw new Error(
    profiles.length
      ? `模型 ${providerId}:${modelId} 的地址不唯一，请在设置中心选定该模型后重试。`
      : `模型 ${providerId}:${modelId} 尚未配置，请先在设置中心保存该模型的地址与参数。`,
  );
}
