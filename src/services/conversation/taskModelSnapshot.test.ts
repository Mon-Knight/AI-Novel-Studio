import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { AiSettings } from '../../types/ai';
import type { CurrentPluginProjection } from './currentPluginService';

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
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

const { saveAiSettings, getDefaultLocalChapterModelSettings, resolveSessionModelApiKey } =
  await import('../ai/aiSettingsStore');
const { captureTaskModelSnapshot, hydrateTaskModelSnapshotRuntime } =
  await import('./taskModelSnapshot');
const { findAvailableWorkbenchModel } = await import('./workbenchModelAvailability');

const deepseekSettings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'session-only-key',
  modelName: 'deepseek-chat',
  mockMode: false,
};

function runtimeModel(providerId: string, modelId: string): CurrentPluginProjection {
  return {
    id: `model:${providerId}:${modelId}`,
    name: modelId,
    category: 'model',
    version: 'test',
    description: 'Runtime model fixture',
    status: 'loaded',
    availability: 'available',
    initialization: 'initialized',
    health: 'healthy',
    source: 'dsh-runtime-health',
    capabilities: ['conversation_turn', 'chapter_generate'],
  };
}

beforeEach(() => storage.clear());

test('default API capture freezes DeepSeek to the Runtime directory identity', () => {
  saveAiSettings(deepseekSettings);

  const snapshot = captureTaskModelSnapshot();

  assert.equal(snapshot.providerId, 'deepseek-official');
  assert.equal(snapshot.modelId, 'deepseek-chat');
  assert.equal(snapshot.runtimeMode, 'api');
  assert.equal(snapshot.runtime?.adapterProvider, snapshot.providerId);
  assert.ok(
    findAvailableWorkbenchModel([runtimeModel('deepseek-official', 'deepseek-chat')], snapshot),
  );
});

test('explicit DeepSeek aliases freeze to one provider identity', () => {
  saveAiSettings(deepseekSettings);

  const configuredAlias = captureTaskModelSnapshot('deepseek', 'deepseek-chat');
  const runtimeAlias = captureTaskModelSnapshot('deepseek-official', 'deepseek-chat');

  assert.equal(configuredAlias.providerId, 'deepseek-official');
  assert.equal(runtimeAlias.providerId, 'deepseek-official');
  assert.equal(configuredAlias.runtime?.adapterProvider, configuredAlias.providerId);
  assert.equal(runtimeAlias.runtime?.adapterProvider, runtimeAlias.providerId);
});

test('openai_compatible provider identity remains unchanged', () => {
  saveAiSettings({
    ...deepseekSettings,
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    modelName: 'custom-model',
  });

  const snapshot = captureTaskModelSnapshot();

  assert.equal(snapshot.providerId, 'openai_compatible');
  assert.equal(snapshot.runtime?.adapterProvider, snapshot.providerId);
});

test('switching captures the selected saved model configuration without changing global settings', () => {
  saveAiSettings({
    ...deepseekSettings,
    savedApiModels: [
      {
        id: 'other-model',
        label: 'Other',
        provider: 'openai_compatible',
        baseUrl: 'https://other-provider.invalid/v1',
        modelName: 'other-model',
        temperature: 0.25,
        maxTokens: 1234,
        timeoutSeconds: 45,
        inputPricePerMillionTokens: 2,
        outputPricePerMillionTokens: 4,
      },
    ],
  });
  const selected = captureTaskModelSnapshot('openai_compatible', 'other-model');
  assert.equal(selected.baseUrl, 'https://other-provider.invalid/v1');
  assert.equal(selected.options.temperature, 0.25);
  assert.equal(selected.options.maxTokens, 1234);
  assert.equal(selected.pricing?.inputPricePerMillionTokens, 2);
  assert.doesNotMatch(JSON.stringify(selected), /session-only-key|apiKey/);
  assert.equal(captureTaskModelSnapshot().modelId, 'deepseek-chat');
});

test('new selections cannot borrow an unrelated endpoint or resolve ambiguous saved profiles', () => {
  saveAiSettings(deepseekSettings);
  assert.throws(() => captureTaskModelSnapshot('openai_compatible', 'not-configured'), /尚未配置/);
  saveAiSettings({
    ...deepseekSettings,
    savedApiModels: ['one', 'two'].map((id) => ({
      id,
      label: id,
      provider: 'openai_compatible',
      modelName: 'same-model',
      baseUrl: `https://${id}.invalid/v1`,
    })),
  });
  assert.throws(() => captureTaskModelSnapshot('openai_compatible', 'same-model'), /地址不唯一/);
});

test('dedicated gateway/local profiles cannot supply a Workbench provider snapshot', () => {
  saveAiSettings({
    ...deepseekSettings,
    inputPricePerMillionTokens: 9,
    gateway: {
      enabled: true,
      providerId: 'gateway-test',
      modelName: 'gateway-model',
      baseUrl: 'https://gateway.invalid/v1',
      apiKey: 'gateway-only-test-key',
      timeoutSeconds: 70,
      maxTokens: 2048,
    },
    localChapterModel: { ...getDefaultLocalChapterModelSettings(), enabled: true },
  });
  const identity = {
    providerId: 'gateway-test',
    baseUrl: 'https://gateway.invalid/v1',
    modelId: 'gateway-model',
  };
  assert.equal(
    resolveSessionModelApiKey({ ...identity, scope: 'gateway' }),
    'gateway-only-test-key',
  );
  assert.equal(resolveSessionModelApiKey({ ...identity, scope: 'provider' }), '');
  assert.throws(() => captureTaskModelSnapshot('gateway-test', 'gateway-model'), /尚未配置/);
  const local = getDefaultLocalChapterModelSettings();
  assert.throws(() => captureTaskModelSnapshot(local.providerId, local.modelName), /尚未配置/);
});

test('same provider/model in a gateway cannot override its saved provider API configuration', () => {
  saveAiSettings({
    ...deepseekSettings,
    gateway: {
      enabled: true,
      providerId: 'openai_compatible',
      modelName: 'same-model',
      baseUrl: 'https://gateway-only.invalid/v1',
      apiKey: '',
      timeoutSeconds: 70,
      maxTokens: 2048,
      temperature: 1.5,
    },
    savedApiModels: [
      {
        id: 'provider-model',
        label: 'Provider Model',
        provider: 'openai_compatible',
        modelName: 'same-model',
        baseUrl: 'https://provider-only.invalid/v1',
        timeoutSeconds: 45,
        maxTokens: 1234,
        temperature: 0.25,
        inputPricePerMillionTokens: 2,
      },
    ],
  });
  const selected = captureTaskModelSnapshot('openai_compatible', 'same-model');
  assert.equal(selected.baseUrl, 'https://provider-only.invalid/v1');
  assert.equal(selected.options.temperature, 0.25);
  assert.equal(selected.options.timeoutSeconds, 45);
  assert.equal(selected.options.maxTokens, 1234);
  assert.equal(selected.pricing?.inputPricePerMillionTokens, 2);
});

test('legacy API snapshots receive current settings baseUrl and DSH runtime defaults', () => {
  saveAiSettings({
    ...deepseekSettings,
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    modelName: 'custom-model',
  });

  const hydrated = hydrateTaskModelSnapshotRuntime({
    providerId: 'openai_compatible',
    modelId: 'custom-model',
    runtimeMode: 'api',
    capabilities: ['conversation_turn'],
    options: {},
    capturedAt: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(hydrated.baseUrl, 'https://provider.invalid/v1');
  assert.equal(hydrated.runtime?.adapterProtocol, 'ans_task_session_v2');
  assert.equal(hydrated.runtime?.adapterProvider, 'openai_compatible');
});

test('legacy snapshots never borrow a baseUrl from a different frozen model identity', () => {
  saveAiSettings({
    ...deepseekSettings,
    provider: 'openai_compatible',
    baseUrl: 'https://current-provider.invalid/v1',
    modelName: 'current-model',
  });

  const hydrated = hydrateTaskModelSnapshotRuntime({
    providerId: 'openai_compatible',
    modelId: 'older-frozen-model',
    runtimeMode: 'api',
    capabilities: ['conversation_turn'],
    options: {},
    capturedAt: '2026-08-01T00:00:00.000Z',
  });

  assert.equal(hydrated.baseUrl, undefined);
  assert.equal(hydrated.modelId, 'older-frozen-model');
  assert.equal(hydrated.runtime?.adapterProtocol, 'ans_task_session_v2');
});
