import { getAiSettings } from '../ai/aiSettingsStore';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { AiSettings } from '../../types/ai';
import { canonicalModelProviderId, normalizeModelBaseUrl, normalizeModelId } from './modelIdentity';
import { isTauri } from '../database/db';

const normalizeApiProviderId = canonicalModelProviderId;

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
  const modelId = normalizeModelId(snapshot.modelId);
  const matchesCurrentIdentity =
    providerId === currentProviderId && modelId === normalizeModelId(settings.modelName);
  const baseUrl =
    normalizeModelBaseUrl(snapshot.baseUrl ?? '') ||
    (matchesCurrentIdentity ? normalizeModelBaseUrl(settings.baseUrl) : '');
  const needsRuntime = !snapshot.runtime?.adapterProtocol;
  const needsBaseUrl = !snapshot.baseUrl?.trim() && Boolean(baseUrl);
  const needsProvider = providerId !== snapshot.providerId;
  const needsModel = modelId !== snapshot.modelId;
  const needsEndpoint = Boolean(snapshot.baseUrl?.trim()) && snapshot.baseUrl !== baseUrl;
  if (!needsRuntime && !needsBaseUrl && !needsProvider && !needsModel && !needsEndpoint) {
    return snapshot;
  }
  return {
    ...snapshot,
    providerId,
    modelId,
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

export function captureTaskModelSnapshotFromSettings(
  settings: AiSettings,
  providerId?: string,
  modelId?: string,
): TaskModelSnapshot {
  const useMock = providerId === 'mock' || (!providerId && settings.runtimeMode === 'mock');
  const runtimeMode = useMock ? 'mock' : 'api';
  const frozenProviderId = useMock
    ? 'mock'
    : normalizeApiProviderId(providerId || settings.provider);
  const frozenModelId = normalizeModelId(
    modelId || (useMock ? 'Mock' : settings.modelName || 'default'),
  );
  const configuration = useMock
    ? settings
    : resolveModelConfiguration(settings, frozenProviderId, frozenModelId);
  const desktop = isTauri();
  return {
    providerId: frozenProviderId,
    modelId: frozenModelId,
    runtimeMode,
    baseUrl: runtimeMode === 'api' ? normalizeModelBaseUrl(configuration.baseUrl) : undefined,
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
      // New captures describe the host that will actually execute them. Hydration
      // above deliberately preserves historical protocol/evidence instead.
      adapterProtocol: desktop ? 'ans_task_session_v2' : 'ans_provider_fallback_v1',
      adapterProvider: !desktop && useMock ? 'browser-fallback' : frozenProviderId,
      dshSourceCommit: desktop ? '47f943859bef60e4160492346772ded9b24f765a' : undefined,
      bundle: desktop ? 'pinned-dsh-carrier' : 'browser-deterministic',
      profile: 'conversational-workbench-v2',
    },
    capturedAt: new Date().toISOString(),
  };
}

export function captureTaskModelSnapshot(providerId?: string, modelId?: string): TaskModelSnapshot {
  return captureTaskModelSnapshotFromSettings(getAiSettings(), providerId, modelId);
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
    normalizeApiProviderId(provider) === providerId &&
    normalizeModelId(model) === normalizeModelId(modelId);
  if (settings.runtimeMode === 'api' && matches(settings.provider, settings.modelName)) {
    return settings;
  }
  const profiles: ModelConfiguration[] = (settings.savedApiModels ?? []).filter((item) =>
    matches(item.provider, item.modelName),
  );
  const endpoints = new Set(profiles.map((item) => normalizeModelBaseUrl(item.baseUrl)));
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
