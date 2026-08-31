import assert from 'node:assert/strict';
import test from 'node:test';
import type { CurrentPluginProjection } from './currentPluginService';
import {
  assertWorkbenchModelAvailable,
  getWorkbenchModelAvailability,
  listAvailableWorkbenchModels,
  WorkbenchModelUnavailableError,
} from './workbenchModelAvailability';

function plugin(
  overrides: Partial<CurrentPluginProjection> & Pick<CurrentPluginProjection, 'id' | 'name'>,
): CurrentPluginProjection {
  return {
    category: 'model',
    version: 'catalog',
    description: 'test projection',
    status: 'loaded',
    availability: 'available',
    initialization: 'initialized',
    health: 'unknown',
    source: 'dsh-runtime-health',
    capabilities: [],
    ...overrides,
  };
}

test('lists only initialized loaded model catalog entries', () => {
  const options = listAvailableWorkbenchModels([
    plugin({ id: 'provider:deepseek-official', name: 'DeepSeek Provider' }),
    plugin({ id: 'model:deepseek-official:deepseek-chat', name: 'DeepSeek Chat' }),
    plugin({
      id: 'model:openai:gpt-settings-only',
      name: 'Settings only',
      status: 'unavailable',
      initialization: 'not_initialized',
      source: 'provider-settings',
    }),
    plugin({
      id: 'model:openai:gpt-failed',
      name: 'Failed model',
      health: 'failed',
    }),
  ]);

  assert.deepEqual(options, [
    {
      key: 'deepseek-official:deepseek-chat',
      providerId: 'deepseek-official',
      modelId: 'deepseek-chat',
      name: 'DeepSeek Chat',
      pluginId: 'model:deepseek-official:deepseek-chat',
      source: 'dsh-runtime-health',
    },
  ]);
});

test('requires an exact provider and model match', () => {
  const plugins = [plugin({ id: 'model:deepseek-official:deepseek-chat', name: 'DeepSeek Chat' })];

  assert.equal(
    assertWorkbenchModelAvailable(plugins, {
      providerId: 'deepseek-official',
      modelId: 'deepseek-chat',
    }).pluginId,
    'model:deepseek-official:deepseek-chat',
  );
  assert.throws(
    () =>
      assertWorkbenchModelAvailable(plugins, {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
      }),
    WorkbenchModelUnavailableError,
  );
  assert.throws(
    () =>
      assertWorkbenchModelAvailable(plugins, {
        providerId: 'deepseek-official',
        modelId: 'deepseek-reasoner',
      }),
    WorkbenchModelUnavailableError,
  );
});

test('allows Mock only through the explicit loaded browser fallback projection', () => {
  const loadedBrowserMock = plugin({
    id: 'model:browser-fallback:Mock',
    name: 'Mock',
    source: 'browser-fallback',
    health: 'healthy',
  });
  const unavailableDesktopMock = plugin({
    id: 'model:browser-fallback:Mock',
    name: 'Mock',
    source: 'browser-fallback',
    status: 'unavailable',
    availability: 'unavailable',
    initialization: 'not_initialized',
  });

  assert.equal(
    assertWorkbenchModelAvailable([loadedBrowserMock], {
      providerId: 'mock',
      modelId: 'Mock',
    }).key,
    'mock:Mock',
  );
  assert.throws(
    () =>
      assertWorkbenchModelAvailable([unavailableDesktopMock], {
        providerId: 'mock',
        modelId: 'Mock',
      }),
    WorkbenchModelUnavailableError,
  );
  assert.throws(
    () => assertWorkbenchModelAvailable([], { providerId: 'mock', modelId: 'Mock' }),
    WorkbenchModelUnavailableError,
  );
});

test('fails closed while the directory refreshes, fails, or misses the selection', () => {
  const plugins = [plugin({ id: 'model:openai:gpt-5', name: 'GPT-5' })];
  const selectedModel = { providerId: 'openai', modelId: 'gpt-5' };

  assert.deepEqual(
    getWorkbenchModelAvailability({
      plugins,
      selectedModel,
      refreshing: true,
    }),
    {
      status: 'refreshing',
      options: listAvailableWorkbenchModels(plugins),
      selectedOption: listAvailableWorkbenchModels(plugins)[0],
      canSend: false,
      message: '正在刷新 Runtime 模型目录；可以继续编辑，完成后即可发送依赖模型的创作任务。',
    },
  );

  const failed = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing: false,
    refreshError: 'catalog failed',
  });
  assert.equal(failed.canSend, false);
  assert.match(failed.message, /刷新失败/);

  const missing = getWorkbenchModelAvailability({
    plugins,
    selectedModel: { providerId: 'openai', modelId: 'gpt-4' },
    refreshing: false,
  });
  assert.equal(missing.canSend, false);
  assert.match(missing.message, /未进入/);

  const localFallback = getWorkbenchModelAvailability({
    plugins: [
      plugin({ id: 'model:deepseek-official:deepseek-chat', name: 'DeepSeek Chat' }),
      plugin({
        id: 'model:local_llama_cpp:qwen-local',
        name: 'Local Qwen',
        health: 'failed',
      }),
    ],
    selectedModel: { providerId: 'local_llama_cpp', modelId: 'qwen-local' },
    refreshing: false,
    allowLocalFallback: true,
  });
  assert.equal(localFallback.canSend, true);
  assert.equal(localFallback.selectedOption, undefined);
  assert.equal(localFallback.fallbackOption?.key, 'deepseek-official:deepseek-chat');
  assert.match(localFallback.message, /本地模型当前不可用/);

  const fixedTaskModel = getWorkbenchModelAvailability({
    plugins: localFallback.options.map((option) =>
      plugin({ id: `model:${option.key}`, name: option.name }),
    ),
    selectedModel: { providerId: 'local_llama_cpp', modelId: 'qwen-local' },
    refreshing: false,
  });
  assert.equal(fixedTaskModel.canSend, false);
  assert.equal(fixedTaskModel.fallbackOption, undefined);
  assert.match(fixedTaskModel.message, /未进入/);

  const available = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing: false,
  });
  assert.equal(available.canSend, true);
  assert.equal(available.status, 'available');
});

test('surfaces the sanitized runtime probe reason when the model directory is empty', () => {
  const unavailable = getWorkbenchModelAvailability({
    plugins: [
      plugin({
        id: 'dsh-carrier:unavailable',
        name: 'Pinned DSH Carrier',
        category: 'other',
        description: '代理进程树隔离失败: AssignProcessToJobObject failed',
        status: 'failed',
        availability: 'unavailable',
        initialization: 'failed',
        health: 'failed',
        source: 'dsh-runtime-projection',
      }),
    ],
    selectedModel: { providerId: 'openai_compatible', modelId: 'gpt-test' },
    refreshing: false,
  });

  assert.equal(unavailable.canSend, false);
  assert.match(unavailable.message, /AssignProcessToJobObject failed/);
});
