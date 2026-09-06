import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import type { TaskModelSnapshot } from '../../types/conversation';
import { resetSessionModelCredentialsForTests, saveAiSettings } from '../ai/aiSettingsStore';
import {
  buildDshTaskStartContract,
  CANONICAL_READ_ALLOWED_TOOLS,
  hasUsableDshTaskCredential,
  hasUsableDshTaskCredentialAsync,
  resolveDshTaskApiKey,
  resolveDshTaskApiKeyAsync,
} from './taskRuntimeService';
import { hydrateTaskModelSnapshotRuntime } from '../conversation/taskModelSnapshot';

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
    /冻结模型没有可用的匹配凭据/,
  );
  assert.throws(
    () =>
      resolveDshTaskApiKey({
        ...snapshot,
        baseUrl: 'https://different-provider.invalid/v1',
      }),
    /冻结模型没有可用的匹配凭据/,
  );
});

test('legacy snapshots without baseUrl use the same exact active identity for credential readiness', async () => {
  saveAiSettings(settings);
  const { baseUrl: _omittedBaseUrl, ...legacySnapshot } = snapshot;

  assert.equal(resolveDshTaskApiKey(legacySnapshot), settings.apiKey);
  assert.equal(await resolveDshTaskApiKeyAsync(legacySnapshot), settings.apiKey);
  assert.equal(hasUsableDshTaskCredential(legacySnapshot), true);
  assert.equal(await hasUsableDshTaskCredentialAsync(legacySnapshot), true);
});

test('legacy snapshots without baseUrl stay fail-closed when the active model identity differs', async () => {
  saveAiSettings({ ...settings, modelName: 'different-active-model' });
  const { baseUrl: _omittedBaseUrl, ...legacySnapshot } = snapshot;

  assert.throws(() => resolveDshTaskApiKey(legacySnapshot), /冻结模型没有可用的匹配凭据/);
  await assert.rejects(
    () => resolveDshTaskApiKeyAsync(legacySnapshot),
    /冻结模型没有可用的匹配凭据/,
  );
  assert.equal(hasUsableDshTaskCredential(legacySnapshot), false);
  assert.equal(await hasUsableDshTaskCredentialAsync(legacySnapshot), false);
});

test('legacy snapshots can recover a credential-free loopback endpoint', async () => {
  const loopbackSettings: AiSettings = {
    ...settings,
    provider: 'openai_compatible',
    baseUrl: 'http://127.0.0.1:12074/v1',
    apiKey: '',
    modelName: 'local-compatible-model',
  };
  saveAiSettings(loopbackSettings);
  const { baseUrl: _omittedBaseUrl, ...legacySnapshot } = {
    ...snapshot,
    providerId: 'openai_compatible',
    modelId: loopbackSettings.modelName,
    baseUrl: undefined,
  };

  const hydratedLegacy = hydrateTaskModelSnapshotRuntime(legacySnapshot);
  assert.equal(hydratedLegacy.baseUrl, loopbackSettings.baseUrl);
  assert.equal(resolveDshTaskApiKey(legacySnapshot), '');
  assert.equal(await resolveDshTaskApiKeyAsync(legacySnapshot), '');
  assert.equal(hasUsableDshTaskCredential(legacySnapshot), true);
  assert.equal(await hasUsableDshTaskCredentialAsync(legacySnapshot), true);
});

test('an explicit historical endpoint is never rebound to the current endpoint', async () => {
  saveAiSettings(settings);
  const historicalEndpointSnapshot = {
    ...snapshot,
    baseUrl: 'https://historical-provider.invalid/v1',
  };

  assert.throws(
    () => resolveDshTaskApiKey(historicalEndpointSnapshot),
    /冻结模型没有可用的匹配凭据/,
  );
  await assert.rejects(
    () => resolveDshTaskApiKeyAsync(historicalEndpointSnapshot),
    /冻结模型没有可用的匹配凭据/,
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

test('async DSH credential readiness fails closed after the application process restarts', async () => {
  saveAiSettings(settings);
  resetSessionModelCredentialsForTests();

  await assert.rejects(() => resolveDshTaskApiKeyAsync(snapshot), /冻结模型没有可用的匹配凭据/);
  assert.equal(await hasUsableDshTaskCredentialAsync(snapshot), false);
});

test('read-intent DSH start contracts request Canonical-only tools', () => {
  assert.deepEqual(
    [...CANONICAL_READ_ALLOWED_TOOLS],
    ['novel.read', 'structure.read', 'context.read', 'memory.search'],
  );

  const readContract = buildDshTaskStartContract('读取当前世界设定', 'ch-1');
  assert.equal(readContract.taskKind, 'read');
  assert.deepEqual([...readContract.allowedTools!], [...CANONICAL_READ_ALLOWED_TOOLS]);
  assert.equal(
    readContract.allowedTools?.some((tool) =>
      ['novel.read_context', 'generate_chapter', 'expand_settings'].includes(tool),
    ),
    false,
  );

  const conversationalRead = buildDshTaskStartContract('你好', 'ch-1');
  assert.equal(conversationalRead.taskKind, 'read');
  assert.deepEqual([...conversationalRead.allowedTools!], [...CANONICAL_READ_ALLOWED_TOOLS]);
});

test('structured-write DSH start contracts keep the legacy allowlist unset', () => {
  const structured = buildDshTaskStartContract('为本作品生成角色候选');
  assert.equal(structured.taskKind, 'character_generate');
  assert.equal(structured.expectedTool, 'generate_characters');
  assert.equal(structured.allowedTools, undefined);

  const audit = buildDshTaskStartContract('审计人物一致性', 'ch-1');
  assert.equal(audit.taskKind, 'quality_check');
  assert.equal(audit.allowedTools, undefined);
});
