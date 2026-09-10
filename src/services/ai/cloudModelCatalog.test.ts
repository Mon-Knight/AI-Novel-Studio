import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenAiModelsUrl,
  formatTokenBudget,
  mergeFetchedModelIds,
  parseOpenAiModelIds,
  parseTokenBudget,
} from './cloudModelCatalog';

test('buildOpenAiModelsUrl mirrors chat-completions root rules', () => {
  assert.equal(buildOpenAiModelsUrl('https://api.x.test/v1'), 'https://api.x.test/v1/models');
  assert.equal(buildOpenAiModelsUrl('https://api.x.test/v1/'), 'https://api.x.test/v1/models');
  assert.equal(buildOpenAiModelsUrl('https://api.x.test'), 'https://api.x.test/v1/models');
  assert.equal(
    buildOpenAiModelsUrl('https://api.x.test/v1/models'),
    'https://api.x.test/v1/models',
  );
  assert.equal(
    buildOpenAiModelsUrl('https://api.x.test/v1/chat/completions'),
    'https://api.x.test/v1/models',
  );
});

test('parseOpenAiModelIds reads OpenAI data arrays and string lists', () => {
  assert.deepEqual(
    parseOpenAiModelIds({
      data: [{ id: 'grok-4.6' }, { id: 'grok-4.6' }, { name: 'other' }],
      models: ['extra'],
    }),
    ['grok-4.6', 'other', 'extra'],
  );
  assert.deepEqual(parseOpenAiModelIds({ models: [{ model: 'local-7b' }] }), ['local-7b']);
  assert.deepEqual(parseOpenAiModelIds(null), []);
});

test('mergeFetchedModelIds keeps existing names and appends new ids', () => {
  assert.deepEqual(
    mergeFetchedModelIds([{ modelName: 'keep' }, { modelName: ' ' }], ['keep', 'added']),
    ['keep', 'added'],
  );
});

test('token budget helpers round-trip K suffixes', () => {
  assert.equal(formatTokenBudget(256000), '256K');
  assert.equal(formatTokenBudget(32000), '32K');
  assert.equal(formatTokenBudget(8000), '8K');
  assert.equal(parseTokenBudget('256K', 0), 256000);
  assert.equal(parseTokenBudget('32k', 0), 32000);
  assert.equal(parseTokenBudget('12000', 0), 12000);
  assert.equal(parseTokenBudget('', 8000), 8000);
});
