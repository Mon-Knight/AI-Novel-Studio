import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../../types/ai';
import type { TaskModelSnapshot } from '../../../types/conversation';
import type { CurrentPluginProjection } from '../../../services/conversation/currentPluginService';
import {
  resetSessionModelCredentialsForTests,
  saveAiSettings,
} from '../../../services/ai/aiSettingsStore';
import { validateWorkbenchModelForSend } from './validateWorkbenchModelForSend';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage,
});

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'session-key-not-for-git',
  modelName: 'deepseek-chat',
  mockMode: false,
};

const snapshot: TaskModelSnapshot = {
  providerId: 'deepseek-official',
  modelId: settings.modelName,
  runtimeMode: 'api',
  baseUrl: settings.baseUrl,
  capabilities: ['conversation_turn'],
  options: {},
  capturedAt: '2026-08-28T00:00:00.000Z',
};

function modelPlugin(model: TaskModelSnapshot): CurrentPluginProjection {
  return {
    id: `model:${model.providerId}:${model.modelId}`,
    name: model.modelId,
    category: 'model',
    version: 'catalog',
    description: 'test model',
    status: 'loaded',
    availability: 'available',
    initialization: 'initialized',
    health: 'healthy',
    source: 'runtime-registry',
    capabilities: [],
  };
}

test('sending hydrates the exact model without probing the Runtime directory', async () => {
  saveAiSettings(settings);
  const probes: Array<{
    allowProbe?: boolean;
    modelId?: string;
    source?: string;
  }> = [];
  const resolved = await validateWorkbenchModelForSend(
    snapshot,
    async (_id, allowProbe, model, source) => {
      probes.push({ allowProbe, modelId: model?.modelId, source });
      return [modelPlugin(model ?? snapshot)];
    },
  );
  assert.equal(resolved.providerId, snapshot.providerId);
  assert.equal(resolved.modelId, snapshot.modelId);
  assert.deepEqual(probes, []);
});

test('missing credentials do not block submission before the runtime can persist its failure', async () => {
  resetSessionModelCredentialsForTests();
  saveAiSettings({ ...settings, apiKey: '' });
  let probed = false;
  const resolved = await validateWorkbenchModelForSend(snapshot, async () => {
    probed = true;
    return [modelPlugin(snapshot)];
  });
  assert.equal(resolved.modelId, snapshot.modelId);
  assert.equal(resolved.baseUrl, snapshot.baseUrl);
  assert.equal(probed, false);
});

test('loopback models retain their identity without a directory refresh or fallback', async () => {
  resetSessionModelCredentialsForTests();
  const loopback: TaskModelSnapshot = {
    ...snapshot,
    providerId: 'openai_compatible',
    modelId: 'local-writer',
    baseUrl: 'http://127.0.0.1:12074/v1',
  };
  const probes: string[] = [];
  const resolved = await validateWorkbenchModelForSend(
    loopback,
    async (_id, _allow, model, source) => {
      probes.push(`${source}:${model?.modelId}`);
      return [modelPlugin(loopback)];
    },
  );
  assert.equal(resolved.baseUrl, loopback.baseUrl);
  assert.deepEqual(probes, []);
});
