import { getAiSettings } from '../ai/aiSettingsStore';
import type { TaskModelSnapshot } from '../../types/conversation';

export function captureTaskModelSnapshot(providerId?: string, modelId?: string): TaskModelSnapshot {
  const settings = getAiSettings();
  const useMock = providerId === 'mock' || (!providerId && settings.runtimeMode === 'mock');
  const runtimeMode = useMock ? 'mock' : 'api';
  return {
    providerId: useMock ? 'mock' : providerId || settings.provider,
    modelId: useMock ? 'Mock' : modelId || settings.modelName || 'default',
    runtimeMode,
    baseUrl: runtimeMode === 'api' ? settings.baseUrl : undefined,
    capabilities: ['conversation_turn', 'chapter_generate', 'tool_calling'],
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
      adapterProvider: useMock ? 'browser-fallback' : 'deepseek-official',
      dshSourceCommit: useMock ? undefined : '47f943859bef60e4160492346772ded9b24f765a',
      bundle: useMock ? 'browser-deterministic' : 'pinned-dsh-carrier',
      profile: 'conversational-workbench-v2',
    },
    capturedAt: new Date().toISOString(),
  };
}
