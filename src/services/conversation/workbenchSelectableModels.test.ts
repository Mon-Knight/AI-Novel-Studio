import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import type { CurrentPluginProjection } from './currentPluginService';
import { listSelectableWorkbenchModels } from './workbenchSelectableModels';
import { getWorkbenchModelAvailability } from './workbenchModelAvailability';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'openai_compatible',
  modelName: 'A',
  baseUrl: 'https://a.invalid/v1',
  apiKey: '',
  mockMode: false,
  savedApiModels: [
    {
      id: 'B',
      label: 'Model B',
      provider: 'deepseek',
      modelName: 'B',
      baseUrl: 'https://b.invalid/v1',
    },
  ],
};
const loaded: CurrentPluginProjection = {
  id: 'model:openai_compatible:A',
  name: 'Model A',
  category: 'model',
  version: '1',
  description: '',
  status: 'loaded',
  availability: 'available',
  initialization: 'initialized',
  health: 'healthy',
  source: 'dsh-runtime-health',
  capabilities: ['conversation_turn'],
};

test('configured B remains selectable while a task worker exposes only loaded A', () => {
  const choices = listSelectableWorkbenchModels([loaded], settings);
  assert.deepEqual(
    choices.map((choice) => choice.key),
    ['openai_compatible:A', 'deepseek-official:B'],
  );
  assert.equal(choices[0].source, 'dsh-runtime-health');
  assert.equal(choices[1].source, 'saved-model-settings');
  assert.doesNotMatch(choices[1].name, /待验证|已验证/);
  assert.equal(
    getWorkbenchModelAvailability({
      plugins: [loaded],
      selectedModel: choices[1],
      refreshing: false,
    }).canSend,
    true,
  );
});

test('an unavailable directory does not lock out configured choices or fake runtime admission', () => {
  const choices = listSelectableWorkbenchModels([], settings);
  assert.equal(choices.length, 2);
  assert.equal(
    getWorkbenchModelAvailability({
      plugins: [],
      selectedModel: choices[1],
      refreshing: false,
      refreshError: 'old model probe failed',
    }).canSend,
    true,
  );
});

test('unconfigured and desktop Mock settings do not manufacture selectable Runtime models', () => {
  assert.deepEqual(
    listSelectableWorkbenchModels([], {
      ...settings,
      runtimeMode: 'mock',
      provider: 'mock',
      modelName: 'Mock',
      savedApiModels: [],
    }),
    [],
  );
  assert.deepEqual(
    listSelectableWorkbenchModels([], {
      ...settings,
      baseUrl: '',
      modelName: '',
      savedApiModels: [],
    }),
    [],
  );
});

test('a loaded model replaces its pending configuration entry without duplicates', () => {
  const modelB = { ...loaded, id: 'model:deepseek-official:B', name: 'Verified B' };
  const choices = listSelectableWorkbenchModels([modelB], settings);
  assert.equal(choices.filter((choice) => choice.key === 'deepseek-official:B').length, 1);
  assert.equal(choices[0].name, 'Verified B');
});

test('dedicated gateway/local credential scopes do not manufacture provider choices', () => {
  const gateway = {
    enabled: true,
    providerId: 'gateway-test',
    modelName: 'G',
    baseUrl: 'https://gateway.invalid/v1',
    apiKey: '',
    timeoutSeconds: 60,
  };
  const local = {
    enabled: true,
    providerId: 'local_llama_cpp',
    modelName: 'L',
    baseUrl: 'http://127.0.0.1:8181/v1',
    apiKey: '',
    timeoutSeconds: 60,
    contextTokens: 4096,
    maxTokens: 1024,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.08,
  };
  const optionalSettings: AiSettings = {
    ...settings,
    gateway,
    localChapterModel: local,
    savedGatewayModels: [{ ...gateway, id: 'gateway', label: 'Gateway' }],
    savedLocalModels: [{ ...local, id: 'local', label: 'Local' }],
  };
  const choices = listSelectableWorkbenchModels([], optionalSettings);
  assert.deepEqual(
    choices.map((choice) => choice.key),
    ['openai_compatible:A', 'deepseek-official:B'],
  );
  const loadedGateway = { ...loaded, id: 'model:gateway-test:G', name: 'Loaded Gateway' };
  const retained = listSelectableWorkbenchModels([loadedGateway], optionalSettings);
  assert.equal(retained[0].key, 'gateway-test:G');
  assert.equal(retained[0].source, loadedGateway.source);
  assert.equal(retained[0].name, 'Loaded Gateway');
});

test('static rendering without browser storage retains runtime choices without reading settings', () => {
  assert.equal(typeof localStorage, 'undefined');
  assert.equal(listSelectableWorkbenchModels([loaded])[0].key, 'openai_compatible:A');
});
