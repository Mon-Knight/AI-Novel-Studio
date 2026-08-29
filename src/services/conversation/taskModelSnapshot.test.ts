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

const { saveAiSettings } = await import('../ai/aiSettingsStore');
const { captureTaskModelSnapshot } = await import('./taskModelSnapshot');
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
