import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import type { TaskModelSnapshot } from '../../types/conversation';
import { saveAiSettings } from '../ai/aiSettingsStore';
import {
  hasUsableDshTaskCredential,
  hasUsableDshTaskCredentialAsync,
  resolveDshTaskApiKey,
  resolveDshTaskApiKeyAsync,
} from './taskRuntimeService';

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
  apiKey: 'dsh-session-key-model-a',
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

test('DSH resolves only the credential bound to its frozen model identity', () => {
  saveAiSettings(settings);

  assert.equal(resolveDshTaskApiKey(snapshot), settings.apiKey);
  assert.throws(
    () => resolveDshTaskApiKey({ ...snapshot, modelId: 'unregistered-model' }),
    /冻结模型没有本次应用会话内的匹配凭据/,
  );
  assert.throws(
    () =>
      resolveDshTaskApiKey({
        ...snapshot,
        baseUrl: 'https://different-provider.invalid/v1',
      }),
    /冻结模型没有本次应用会话内的匹配凭据/,
  );
});

test('DSH permits an unkeyed loopback model without weakening public endpoint checks', () => {
  const loopbackSnapshot = {
    ...snapshot,
    providerId: 'local_llama_cpp',
    modelId: 'local-model',
    baseUrl: 'http://127.0.0.1:8080/v1',
  };
  assert.equal(resolveDshTaskApiKey(loopbackSnapshot), '');
  assert.equal(hasUsableDshTaskCredential(loopbackSnapshot), true);
  assert.equal(hasUsableDshTaskCredential({ ...snapshot, modelId: 'unregistered-model' }), false);
});

test('mock DSH snapshots never resolve session or native credentials', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let nativeVaultCalls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_IPC__: () => {
        nativeVaultCalls += 1;
        throw new Error('mock runtime must not query the native credential vault');
      },
    },
  });

  try {
    saveAiSettings(settings);
    const sessionBoundMockSnapshot: TaskModelSnapshot = {
      ...snapshot,
      runtimeMode: 'mock',
    };
    const nativeOnlyMockSnapshot: TaskModelSnapshot = {
      ...sessionBoundMockSnapshot,
      providerId: 'deepseek-official',
      modelId: 'uncached-native-vault-probe',
      baseUrl: 'https://api.deepseek.com/v1',
    };

    assert.equal(resolveDshTaskApiKey(sessionBoundMockSnapshot), '');
    assert.equal(await resolveDshTaskApiKeyAsync(sessionBoundMockSnapshot), '');
    assert.equal(await resolveDshTaskApiKeyAsync(nativeOnlyMockSnapshot), '');
    assert.equal(nativeVaultCalls, 0);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('async DSH credential readiness resolves the same frozen identity used after renderer restore', async () => {
  saveAiSettings(settings);

  assert.equal(await hasUsableDshTaskCredentialAsync(snapshot), true);
  assert.equal(
    await hasUsableDshTaskCredentialAsync({ ...snapshot, modelId: 'unregistered-model' }),
    false,
  );
});
