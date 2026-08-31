import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import type { AiSettings } from '../../types/ai';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const {
  getAiSettings,
  getDefaultLocalChapterModelSettings,
  maskAiApiKey,
  normalizeAiSettings,
  resetSessionModelCredentialsForTests,
  resolveSessionModelApiKey,
  saveAiSettings,
} = await import('./aiSettingsStore');

beforeEach(() => {
  storage.clear();
  resetSessionModelCredentialsForTests();
});

test('settings normalization preserves runtime selection and hard governance bounds', () => {
  const normalized = normalizeAiSettings({
    runtimeMode: 'api',
    mockMode: false,
    provider: 'deepseek',
    maxRequestsPerMinute: 999,
    maxConcurrentAiRequests: 0,
    budgetWarningPercent: 1,
    dailyCostBudgetUsd: 10,
  });

  assert.equal(normalized.runtimeMode, 'api');
  assert.equal(normalized.provider, 'deepseek');
  assert.equal(normalized.maxRequestsPerMinute, 120);
  assert.equal(normalized.maxConcurrentAiRequests, 1);
  assert.equal(normalized.budgetWarningPercent, 50);
  assert.equal(normalized.dailyCostBudgetUsd, undefined);
});

test('new settings use the production request limit needed by sparse task recovery', () => {
  const normalized = normalizeAiSettings({});

  assert.equal(normalized.maxRequestsPerMinute, 60);
});

test('settings persistence returns the same normalized pricing snapshot without the pipeline module', () => {
  const settings: AiSettings = {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: '1234567890abcdef',
    modelName: 'model',
    temperature: 0.5,
    maxTokens: 4096,
    timeoutSeconds: 60,
    inputPricePerMillionTokens: 1.25,
    outputPricePerMillionTokens: 2.5,
    maxRequestsPerMinute: 20,
    maxConcurrentAiRequests: 3,
    dailyTokenBudget: 100_000,
    dailyCostBudgetUsd: 5,
    budgetWarningPercent: 75,
    mockMode: false,
    savedApiModels: [
      {
        id: 'legacy-cloud',
        label: 'model',
        provider: 'openai_compatible',
        baseUrl: 'https://provider.invalid/v1',
        modelName: 'model',
        temperature: 0.5,
        maxTokens: 4096,
        timeoutSeconds: 60,
        inputPricePerMillionTokens: 1.25,
        outputPricePerMillionTokens: 2.5,
      },
    ],
    activeSavedApiModelId: 'legacy-cloud',
  };

  saveAiSettings(settings);

  assert.deepEqual(getAiSettings(), settings);
  const persisted = storage.getItem('ai_novel_studio_ai_settings');
  assert.ok(persisted);
  assert.equal(persisted.includes(settings.apiKey), false);
  assert.equal(persisted.includes('"apiKey"'), false);
  assert.equal(maskAiApiKey(settings.apiKey), '1234...cdef');
  assert.equal(maskAiApiKey('short'), '****');
});

test('session credentials stay bound to the exact provider endpoint and model', () => {
  const modelA: AiSettings = {
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'session-key-model-a',
    modelName: 'deepseek-chat',
    mockMode: false,
  };
  const modelB: AiSettings = {
    ...modelA,
    apiKey: 'session-key-model-b',
    modelName: 'deepseek-reasoner',
  };

  saveAiSettings(modelA);
  saveAiSettings(modelB);

  assert.equal(
    resolveSessionModelApiKey({
      scope: 'provider',
      providerId: 'deepseek',
      baseUrl: modelA.baseUrl,
      modelId: modelA.modelName,
    }),
    modelA.apiKey,
  );
  assert.equal(
    resolveSessionModelApiKey({
      scope: 'provider',
      providerId: 'deepseek-official',
      baseUrl: modelB.baseUrl,
      modelId: modelB.modelName,
    }),
    modelB.apiKey,
  );

  const persisted = storage.getItem('ai_novel_studio_ai_settings');
  assert.ok(persisted);
  assert.equal(persisted.includes(modelA.apiKey), false);
  assert.equal(persisted.includes(modelB.apiKey), false);
  assert.equal(persisted.includes('"apiKey"'), false);
});

test('session credential lookup fails closed on scope, provider, endpoint, or model mismatch', () => {
  const settings: AiSettings = {
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'session-key-exact-identity',
    modelName: 'deepseek-chat',
    mockMode: false,
  };
  saveAiSettings(settings);

  const exactIdentity = {
    scope: 'provider' as const,
    providerId: 'deepseek-official',
    baseUrl: settings.baseUrl,
    modelId: settings.modelName,
  };
  assert.equal(resolveSessionModelApiKey(exactIdentity), settings.apiKey);
  assert.equal(resolveSessionModelApiKey({ ...exactIdentity, scope: 'gateway' }), '');
  assert.equal(
    resolveSessionModelApiKey({ ...exactIdentity, providerId: 'openai_compatible' }),
    '',
  );
  assert.equal(
    resolveSessionModelApiKey({ ...exactIdentity, baseUrl: 'https://other.invalid/v1' }),
    '',
  );
  assert.equal(resolveSessionModelApiKey({ ...exactIdentity, modelId: 'unregistered-model' }), '');
});

test('legacy persistent credentials are moved into session memory and removed from storage', () => {
  const legacy = normalizeAiSettings({
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'legacy-provider-secret',
    modelName: 'model',
    mockMode: false,
    localChapterModel: {
      ...getDefaultLocalChapterModelSettings(),
      apiKey: 'legacy-local-secret',
    },
  });
  storage.setItem('ai_novel_studio_ai_settings', JSON.stringify(legacy));

  const loaded = getAiSettings();

  assert.equal(loaded.apiKey, 'legacy-provider-secret');
  assert.equal(loaded.localChapterModel?.apiKey, 'legacy-local-secret');
  const migrated = storage.getItem('ai_novel_studio_ai_settings');
  assert.ok(migrated);
  assert.equal(migrated.includes('legacy-provider-secret'), false);
  assert.equal(migrated.includes('legacy-local-secret'), false);
  assert.equal(migrated.includes('"apiKey"'), false);
});

test('local chapter model settings normalize to the verified scene protocol', () => {
  const normalized = normalizeAiSettings({
    runtimeMode: 'mock',
    provider: 'mock',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    mockMode: true,
    localChapterModel: {
      enabled: true,
      providerId: ' local_llama_cpp ',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: '',
      modelName: 'qwen35-9b-novel-v3',
      timeoutSeconds: 9999,
      contextTokens: 128000,
      maxTokens: 12000,
      temperature: 3,
      topP: 2,
      topK: 5000,
      repeatPenalty: 4,
      seed: 42,
    },
  });

  assert.equal(normalized.localChapterModel?.enabled, true);
  assert.equal(normalized.localChapterModel?.providerId, 'local_llama_cpp');
  assert.equal(normalized.localChapterModel?.contextTokens, 4096);
  assert.equal(normalized.localChapterModel?.maxTokens, 1024);
  assert.equal(normalized.localChapterModel?.temperature, 2);
  assert.equal(normalized.localChapterModel?.topP, 1);
  assert.equal(normalized.localChapterModel?.topK, 4096);
  assert.equal(normalized.localChapterModel?.repeatPenalty, 3);
  assert.equal(normalized.localChapterModel?.seed, 42);
  assert.equal(normalized.localChapterModel?.allowCloudWriterFallback, true);
});

test('local writer fallback can be disabled and defaults to enabled', () => {
  const enabled = normalizeAiSettings({
    runtimeMode: 'mock',
    provider: 'mock',
    mockMode: true,
    localChapterModel: getDefaultLocalChapterModelSettings(),
  });
  const disabled = normalizeAiSettings({
    runtimeMode: 'mock',
    provider: 'mock',
    mockMode: true,
    localChapterModel: {
      ...getDefaultLocalChapterModelSettings(),
      allowCloudWriterFallback: false,
    },
  });
  assert.equal(enabled.localChapterModel?.allowCloudWriterFallback, true);
  assert.equal(disabled.localChapterModel?.allowCloudWriterFallback, false);
});

test('real-provider E2E opt-in uses sanitized settings while ordinary E2E stays deterministic', async () => {
  const apiSettings: AiSettings = {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:12074/v1',
    apiKey: 'real-e2e-session-only-key',
    modelName: 'real-e2e-model',
    mockMode: false,
  };

  for (const [realEnabled, expectedMode] of [
    ['0', 'mock'],
    ['1', 'api'],
  ] as const) {
    storage.clear();
    const vite = await createServer({
      appType: 'custom',
      define: {
        'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
        'import.meta.env.VITE_AI_NOVEL_STUDIO_REAL_E2E': JSON.stringify(realEnabled),
      },
      server: { middlewareMode: true, hmr: false },
    });
    try {
      const isolated = (await vite.ssrLoadModule(
        '/src/services/ai/aiSettingsStore.ts',
      )) as typeof import('./aiSettingsStore');
      isolated.saveAiSettings(apiSettings);

      assert.equal(isolated.getAiSettings().runtimeMode, expectedMode);
      const persisted = storage.getItem('ai_novel_studio_ai_settings') ?? '';
      assert.doesNotMatch(persisted, /real-e2e-session-only-key|apiKey/);
    } finally {
      await vite.close();
    }
  }
});

test('legacy cloud settings seed a saved API model card without persisting keys', () => {
  saveAiSettings({
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'card-seed-secret',
    modelName: 'deepseek-chat',
    mockMode: false,
  } as AiSettings);

  const loaded = getAiSettings();
  assert.equal(loaded.savedApiModels?.length, 1);
  assert.equal(loaded.savedApiModels?.[0]?.label, 'deepseek-chat');
  assert.equal(loaded.savedApiModels?.[0]?.provider, 'deepseek');
  assert.equal(loaded.activeSavedApiModelId, loaded.savedApiModels?.[0]?.id);
  assert.equal(loaded.apiKey, 'card-seed-secret');
  const persisted = storage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(persisted.includes('card-seed-secret'), false);
  assert.equal(persisted.includes('"apiKey"'), false);
  assert.equal(JSON.parse(persisted).savedApiModels[0].baseUrl, 'https://api.deepseek.com/v1');
});

test('saving a second API model keeps both cards and session keys isolated', () => {
  saveAiSettings({
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'first-card-secret',
    modelName: 'deepseek-chat',
    mockMode: false,
    savedApiModels: [
      {
        id: 'model-a',
        label: '写作模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        modelName: 'deepseek-chat',
      },
    ],
    activeSavedApiModelId: 'model-a',
  } as AiSettings);

  saveAiSettings({
    ...getAiSettings(),
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'second-card-secret',
    modelName: 'gpt-4',
  });

  const loaded = getAiSettings();
  assert.equal(loaded.savedApiModels?.length, 2);
  assert.equal(loaded.modelName, 'gpt-4');
  assert.equal(loaded.apiKey, 'second-card-secret');
  assert.equal(
    resolveSessionModelApiKey({
      scope: 'provider',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
    }),
    'first-card-secret',
  );
  const persisted = storage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(persisted.includes('first-card-secret'), false);
  assert.equal(persisted.includes('second-card-secret'), false);
  assert.equal(persisted.includes('"apiKey"'), false);
});

test('saving existing model cards preserves their custom display labels', () => {
  const localChapterModel = {
    ...getDefaultLocalChapterModelSettings(),
    enabled: true,
  };
  const gateway = {
    enabled: true,
    providerId: 'ai_gateway',
    baseUrl: 'https://gateway.invalid/v1',
    apiKey: 'gateway-session-key',
    modelName: 'gateway-model',
    timeoutSeconds: 120,
  };
  saveAiSettings({
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'provider-session-key',
    modelName: 'model-x',
    mockMode: false,
    localChapterModel,
    gateway,
    savedApiModels: [
      {
        id: 'custom-api',
        label: '我的写作模型',
        provider: 'openai_compatible',
        baseUrl: 'https://provider.invalid/v1',
        modelName: 'model-x',
      },
    ],
    activeSavedApiModelId: 'custom-api',
    savedLocalModels: [
      {
        id: 'custom-local',
        label: '我的本地模型',
        providerId: localChapterModel.providerId,
        baseUrl: localChapterModel.baseUrl,
        modelName: localChapterModel.modelName,
      },
    ],
    activeSavedLocalModelId: 'custom-local',
    savedGatewayModels: [
      {
        id: 'custom-gateway',
        label: '我的网关模型',
        providerId: gateway.providerId,
        baseUrl: gateway.baseUrl,
        modelName: gateway.modelName,
        timeoutSeconds: gateway.timeoutSeconds,
      },
    ],
    activeSavedGatewayModelId: 'custom-gateway',
  } as AiSettings);

  const loaded = getAiSettings();
  assert.equal(loaded.savedApiModels?.[0]?.label, '我的写作模型');
  assert.equal(loaded.savedLocalModels?.[0]?.label, '我的本地模型');
  assert.equal(loaded.savedGatewayModels?.[0]?.label, '我的网关模型');

  saveAiSettings(loaded);
  const persisted = JSON.parse(storage.getItem('ai_novel_studio_ai_settings') ?? '{}');
  assert.equal(persisted.savedApiModels[0].label, '我的写作模型');
  assert.equal(persisted.savedLocalModels[0].label, '我的本地模型');
  assert.equal(persisted.savedGatewayModels[0].label, '我的网关模型');
});

test('local and gateway models seed saved cards without persisting keys', () => {
  saveAiSettings({
    runtimeMode: 'mock',
    provider: 'mock',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    mockMode: true,
    localChapterModel: {
      ...getDefaultLocalChapterModelSettings(),
      enabled: true,
      apiKey: 'local-card-secret',
    },
    gateway: {
      enabled: true,
      providerId: 'ai_gateway',
      baseUrl: 'https://gateway.invalid/v1',
      apiKey: 'gateway-card-secret',
      modelName: 'qwen-gateway',
      timeoutSeconds: 120,
    },
  } as AiSettings);

  const loaded = getAiSettings();
  assert.equal(loaded.savedLocalModels?.length, 1);
  assert.equal(loaded.savedGatewayModels?.length, 1);
  assert.equal(loaded.savedLocalModels?.[0]?.modelName, 'qwen35-9b-novel-v3');
  assert.equal(loaded.savedGatewayModels?.[0]?.label, 'qwen-gateway');
  const persisted = storage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(persisted.includes('local-card-secret'), false);
  assert.equal(persisted.includes('gateway-card-secret'), false);
  assert.equal(persisted.includes('"apiKey"'), false);
});

test('API keys disappear after the current application session ends', () => {
  saveAiSettings({
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'session-only-key',
    modelName: 'deepseek-chat',
    mockMode: false,
  } as AiSettings);

  const settingsJson = storage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(settingsJson.includes('session-only-key'), false);
  assert.equal(settingsJson.includes('"apiKey"'), false);
  assert.equal(storage.getItem('ai_novel_studio_ai_credentials'), null);

  resetSessionModelCredentialsForTests();
  assert.equal(
    resolveSessionModelApiKey({
      scope: 'provider',
      providerId: 'deepseek-official',
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
    }),
    '',
  );

  const restored = getAiSettings();
  assert.equal(restored.apiKey, '');
});
