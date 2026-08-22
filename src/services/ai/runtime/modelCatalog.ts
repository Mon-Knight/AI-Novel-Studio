import type { AiSettings, LocalChapterModelSettings, RemoteWriterSettings } from '../../../types/ai';
import type { ModelEndpoint, ModelRef } from '../../../types/modelRuntime';

export function mockModelRef(): ModelRef {
  return {
    endpointId: 'cloud.mock.Mock',
    providerId: 'mock',
    modelId: 'Mock',
    kind: 'mock',
  };
}

export function cloudModelRef(settings: AiSettings): ModelRef {
  if (settings.runtimeMode === 'mock') return mockModelRef();
  const modelId = settings.modelName.trim() || 'default';
  return {
    endpointId: 'cloud.' + settings.provider + '.' + modelId,
    providerId: settings.provider,
    modelId,
    kind: 'cloud',
  };
}

export function localModelRef(local: LocalChapterModelSettings): ModelRef {
  const modelId = local.modelName.trim() || 'local-model';
  const providerId = local.providerId.trim() || 'local_llama_cpp';
  return {
    endpointId: 'local.' + providerId + '.' + modelId,
    providerId,
    modelId,
    kind: 'local',
  };
}

export function remoteModelRef(remote: RemoteWriterSettings): ModelRef {
  const modelId = remote.modelName.trim() || 'remote-model';
  const providerId = remote.providerId.trim() || 'remote_openai_compatible';
  return {
    endpointId: 'remote.' + providerId + '.' + modelId,
    providerId,
    modelId,
    kind: 'remote',
  };
}

export function cloudModelEndpoint(settings: AiSettings): ModelEndpoint {
  const ref = cloudModelRef(settings);
  return {
    ...ref,
    protocol: 'chat_completions_v1',
    providerFamily: ref.kind === 'mock' ? 'mock' : 'openai_compatible',
    capabilities: [
      'director.world',
      'director.character',
      'director.plot',
      'director.scene_plan',
      'director.repair',
      'writer.beat_prose',
      'writer.chapter_fallback',
      'critic.quality',
      'critic.review',
      'planner.prepare',
    ],
    contextTokens: 64_000,
    maxOutputTokens: Math.max(1, settings.maxTokens ?? 8_000),
    loopbackRequired: false,
    priced: settings.runtimeMode === 'api',
  };
}

export function localModelEndpoint(local: LocalChapterModelSettings): ModelEndpoint {
  return {
    ...localModelRef(local),
    protocol: 'chat_completions_v1',
    providerFamily: 'local_openai_compatible',
    capabilities: ['writer.scene_prose', 'writer.beat_prose'],
    contextTokens: local.contextTokens,
    maxOutputTokens: local.maxTokens,
    loopbackRequired: true,
    priced: false,
  };
}

export function remoteModelEndpoint(remote: RemoteWriterSettings): ModelEndpoint {
  return {
    ...remoteModelRef(remote),
    protocol: 'chat_completions_v1',
    providerFamily: 'openai_compatible',
    capabilities: ['writer.scene_prose', 'writer.beat_prose'],
    contextTokens: remote.contextTokens ?? 32_000,
    maxOutputTokens: remote.maxTokens ?? 4_000,
    loopbackRequired: false,
    priced: true,
  };
}

export function isCloudEndpointAvailable(settings: AiSettings): boolean {
  if (settings.runtimeMode === 'mock') return true;
  return Boolean(settings.baseUrl.trim() && settings.modelName.trim());
}

export function isRemoteEndpointAvailable(remote?: RemoteWriterSettings): boolean {
  if (!remote || !remote.enabled) return false;
  return Boolean(remote.baseUrl.trim() && remote.modelName.trim() && remote.apiKey.trim());
}

export function allowCloudWriterFallback(local?: LocalChapterModelSettings): boolean {
  return local?.allowCloudWriterFallback !== false;
}

