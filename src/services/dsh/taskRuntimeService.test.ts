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
  DSH_PLUGIN_PROBE_CONVERSATION_ID,
  dshTaskRuntimeService,
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

test('configured model synchronization uses the isolated Runtime probe identity', async () => {
  const original = dshTaskRuntimeService.listCurrentPlugins;
  let requestedConversationId = '';
  let requestedModelId = '';
  dshTaskRuntimeService.listCurrentPlugins = async (conversationId, modelSnapshot) => {
    requestedConversationId = conversationId ?? '';
    requestedModelId = modelSnapshot?.modelId ?? '';
    return [
      {
        id: 'model:deepseek-official:deepseek-chat',
        status: 'loaded',
        initialization: 'initialized',
        availability: 'available',
      },
    ];
  };
  try {
    const rows = await dshTaskRuntimeService.initializeConfiguredModel(snapshot);
    assert.equal(requestedConversationId, DSH_PLUGIN_PROBE_CONVERSATION_ID);
    assert.equal(requestedModelId, 'deepseek-chat');
    assert.equal(rows[0]?.id, 'model:deepseek-official:deepseek-chat');
  } finally {
    dshTaskRuntimeService.listCurrentPlugins = original;
  }
});

test('Mock configuration never initializes the desktop DSH probe', async () => {
  const original = dshTaskRuntimeService.listCurrentPlugins;
  let called = false;
  dshTaskRuntimeService.listCurrentPlugins = async () => {
    called = true;
    return [];
  };
  try {
    const rows = await dshTaskRuntimeService.initializeConfiguredModel({
      ...snapshot,
      providerId: 'mock',
      modelId: 'Mock',
      runtimeMode: 'mock',
    });
    assert.deepEqual(rows, []);
    assert.equal(called, false);
  } finally {
    dshTaskRuntimeService.listCurrentPlugins = original;
  }
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
      __TAURI_INTERNALS__: {
        invoke: () => {
          nativeVaultCalls += 1;
          throw new Error('mock runtime must not query the native credential vault');
        },
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

test('cancelling while exact credentials load prevents native model dispatch and strips renderer signals from IPC', async () => {
  saveAiSettings(settings);
  resetSessionModelCredentialsForTests();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let releaseCredential!: (credential: string) => void;
  let entered!: () => void;
  const credentialEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let nativeStarts = 0;
  let nativeInput: Record<string, unknown> | undefined;
  const bridgeWindow: Record<string, unknown> = { crypto: globalThis.crypto };
  bridgeWindow.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'resolve_session_model_credential') {
        return new Promise<string>((resolve) => {
          releaseCredential = resolve;
          entered();
        });
      }
      if (cmd === 'dsh_start_task_turn') {
        nativeStarts++;
        nativeInput = (args as { input?: Record<string, unknown> } | undefined)?.input;
        return Promise.resolve({ run: { status: 'completed' } });
      }
      return Promise.reject(new Error(`unexpected native test command ${cmd}`));
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: bridgeWindow });
  const controller = new AbortController();
  const input = {
    conversationId: 'cancel-credential-loading',
    novelId: 'novel',
    turnId: 'turn',
    goal: '你好',
    modelSnapshot: snapshot,
    taskKind: 'creative_dialogue' as const,
    requiredReadTools: [],
    cancellationSignal: controller.signal,
  };
  try {
    const pending = dshTaskRuntimeService.start(input);
    await credentialEntered;
    controller.abort();
    releaseCredential('test-session-credential');
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(nativeStarts, 0);
    assert.equal(dshTaskRuntimeService.isRunning(input.conversationId), false);
    await dshTaskRuntimeService.start({
      ...input,
      modelSnapshot: { ...snapshot, options: { ...snapshot.options, timeoutSeconds: 77 } },
      cancellationSignal: new AbortController().signal,
    });
    assert.equal(nativeStarts, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(nativeInput, 'cancellationSignal'), false);
    assert.equal((nativeInput?.requestPolicy as { timeoutSeconds: number }).timeoutSeconds, 77);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    resetSessionModelCredentialsForTests();
  }
});

test('native local-command ingress does not resolve credentials or disguise the selected model', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let vaultCalls = 0;
  let captured: Record<string, unknown> | undefined;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => {
          if (command === 'resolve_session_model_credential') {
            vaultCalls++;
            return Promise.reject(new Error('no credentials permitted'));
          }
          if (command === 'dsh_start_task_turn') {
            captured = args?.input as Record<string, unknown>;
            return Promise.resolve({ run: { status: 'completed' } });
          }
          return Promise.reject(new Error(`unexpected command ${command}`));
        },
      },
    },
  });
  try {
    const selected = { ...snapshot, modelId: 'missing-credential-model' };
    await dshTaskRuntimeService.start({
      conversationId: 'local-setting',
      novelId: 'novel',
      turnId: 'setting-turn',
      goal: '本任务目标字数设为3200字',
      modelSnapshot: selected,
      taskKind: 'creative_dialogue',
      requiredReadTools: [],
      unifiedRuntime: {
        version: 1,
        localCommand: {
          kind: 'task_word_target',
          targetWordCount: 3200,
          wordRange: { target: 3200, minimum: 2560, maximum: 3680 },
        },
      },
    });
    assert.equal(vaultCalls, 0);
    assert.equal(captured?.apiKey, '');
    assert.equal((captured?.modelSnapshot as TaskModelSnapshot).modelId, selected.modelId);
    assert.equal((captured?.unifiedRuntime as { version: number }).version, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('in-flight parent cancellation reaches native authority without falsifying a committed terminal result', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let nativeEntered!: () => void;
  let complete!: (value: unknown) => void;
  const entered = new Promise<void>((resolve) => {
    nativeEntered = resolve;
  });
  let cancellations = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: (command: string) => {
          if (command === 'dsh_start_task_turn') {
            nativeEntered();
            return new Promise<unknown>((resolve) => {
              complete = resolve;
            });
          }
          if (command === 'dsh_cancel_task_run') {
            cancellations++;
            return Promise.resolve({ status: 'cancel_requested' });
          }
          return Promise.reject(new Error(`unexpected command ${command}`));
        },
      },
    },
  });
  const controller = new AbortController();
  try {
    const pending = dshTaskRuntimeService.start({
      conversationId: 'cancel-inflight',
      novelId: 'novel',
      turnId: 'turn',
      goal: '生成下一章',
      modelSnapshot: { ...snapshot, providerId: 'mock', modelId: 'Mock', runtimeMode: 'mock' },
      taskKind: 'creative_dialogue',
      requiredReadTools: [],
      unifiedRuntime: { version: 1 },
      cancellationSignal: controller.signal,
    });
    await entered;
    controller.abort();
    assert.equal(cancellations, 1);
    complete({ run: { status: 'completed' } });
    assert.equal((await pending).run.status, 'completed');
    assert.equal(dshTaskRuntimeService.isRunning('cancel-inflight'), false);
  } finally {
    complete?.({ run: { status: 'completed' } });
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('Stop before credential dispatch cancels ingress promptly and never starts a late native model run', async () => {
  saveAiSettings(settings);
  resetSessionModelCredentialsForTests();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let enteredVault!: () => void;
  let releaseVault!: (credential: string) => void;
  const entered = new Promise<void>((resolve) => {
    enteredVault = resolve;
  });
  let nativeStarts = 0;
  let nativeCancels = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: (command: string) => {
          if (command === 'resolve_session_model_credential') {
            enteredVault();
            return new Promise<string>((resolve) => {
              releaseVault = resolve;
            });
          }
          if (command === 'dsh_start_task_turn') {
            nativeStarts++;
            return Promise.resolve({ run: { status: 'completed' } });
          }
          if (command === 'dsh_cancel_task_run') {
            nativeCancels++;
            return Promise.resolve({ status: 'idle' });
          }
          return Promise.reject(new Error(`unexpected command ${command}`));
        },
      },
    },
  });
  try {
    const pending = dshTaskRuntimeService.start({
      conversationId: 'stop-before-dispatch',
      novelId: 'novel',
      turnId: 'turn',
      goal: '生成下一章',
      modelSnapshot: snapshot,
      taskKind: 'creative_dialogue',
      requiredReadTools: [],
      unifiedRuntime: { version: 1 },
    });
    await entered;
    assert.equal(dshTaskRuntimeService.isRunning('stop-before-dispatch'), true);
    const acknowledgement = await dshTaskRuntimeService.cancel('stop-before-dispatch');
    assert.equal(acknowledgement.status, 'cancel_requested');
    assert.equal(acknowledgement.runtime, 'ans-task-ingress');
    assert.equal(acknowledgement.runId, '', 'no fabricated native Run or terminal state');
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(dshTaskRuntimeService.isRunning('stop-before-dispatch'), false);
    assert.equal(nativeStarts, 0);
    assert.equal(nativeCancels, 0, 'there was not yet a native model execution to cancel');
    releaseVault('late-exact-test-credential');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(nativeStarts, 0, 'a late vault result cannot revive cancelled ingress');
  } finally {
    releaseVault?.('late-exact-test-credential');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    resetSessionModelCredentialsForTests();
  }
});
