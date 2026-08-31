import { getAiSettings } from '../ai/aiSettingsStore';
import type { TaskModelSnapshot } from '../../types/conversation';

function normalizeApiProviderId(providerId: string): string {
  const normalized = providerId.trim();
  return normalized === 'deepseek' || normalized === 'deepseek-official'
    ? 'deepseek-official'
    : normalized;
}

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
  return {
    providerId: frozenProviderId,
    modelId: modelId || (useMock ? 'Mock' : settings.modelName || 'default'),
    runtimeMode,
    baseUrl: runtimeMode === 'api' ? settings.baseUrl : undefined,
    capabilities: ['conversation_turn', 'chapter_generate'],
    options: {
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      timeoutSeconds: settings.timeoutSeconds,
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
            inputPricePerMillionTokens: settings.inputPricePerMillionTokens,
            outputPricePerMillionTokens: settings.outputPricePerMillionTokens,
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
