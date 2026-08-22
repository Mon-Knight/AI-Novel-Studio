import type {
  AiSettings,
  GatewayModelConfig,
  LocalChapterModelSettings,
} from '../../../types/ai';
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

export function gatewayModelRef(gateway: GatewayModelConfig): ModelRef {
  const modelId = gateway.modelName.trim() || 'gateway-model';
  const providerId = gateway.providerId.trim() || 'ai_gateway';
  return {
    endpointId: 'remote.' + providerId + '.' + modelId,
    providerId,
    modelId,
    kind: 'remote',
  };
}

export const remoteModelRef = gatewayModelRef;

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

export function gatewayModelEndpoint(gateway: GatewayModelConfig): ModelEndpoint {
  return {
    ...gatewayModelRef(gateway),
    protocol: 'chat_completions_v1',
    providerFamily: 'openai_compatible',
    capabilities: ['writer.scene_prose', 'writer.beat_prose'],
    contextTokens: gateway.contextTokens ?? 32_000,
    maxOutputTokens: gateway.maxTokens ?? 4_000,
    loopbackRequired: false,
    priced: true,
  };
}

export const remoteModelEndpoint = gatewayModelEndpoint;

export function isCloudEndpointAvailable(settings: AiSettings): boolean {
  if (settings.runtimeMode === 'mock') return true;
  return Boolean(settings.baseUrl.trim() && settings.modelName.trim());
}

export function isGatewayEndpointAvailable(gateway?: GatewayModelConfig): boolean {
  if (!gateway || !gateway.enabled) return false;
  return Boolean(gateway.baseUrl.trim() && gateway.modelName.trim() && gateway.apiKey.trim());
}

export const isRemoteEndpointAvailable = isGatewayEndpointAvailable;

export function allowCloudWriterFallback(local?: LocalChapterModelSettings): boolean {
  return local?.allowCloudWriterFallback !== false;
}

