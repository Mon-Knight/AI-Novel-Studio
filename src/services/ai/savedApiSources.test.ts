import assert from 'node:assert/strict';
import test from 'node:test';
import type { SavedApiModelProfile } from '../../types/ai';
import {
  groupSavedApiModelsBySource,
  inferApiSourceLabel,
  primaryProfileInSource,
  profilesFromSourceCatalog,
  replaceSavedApiSourceModels,
  savedApiSourceKey,
} from './savedApiSources';

function profile(
  overrides: Partial<SavedApiModelProfile> & Pick<SavedApiModelProfile, 'id' | 'modelName'>,
): SavedApiModelProfile {
  return {
    label: overrides.label ?? overrides.modelName,
    provider: 'openai_compatible',
    baseUrl: 'https://api.example.test/v1',
    ...overrides,
  };
}

test('savedApiSourceKey prefers sourceId over shared endpoint', () => {
  assert.equal(
    savedApiSourceKey({
      provider: 'openai_compatible',
      baseUrl: 'https://api.example.test/v1/',
      sourceId: 'src-a',
    }),
    'id:src-a',
  );
  assert.equal(
    savedApiSourceKey({
      provider: 'openai_compatible',
      baseUrl: 'https://api.example.test/v1/',
    }),
    'ep:openai_compatible:https://api.example.test/v1',
  );
});

test('groupSavedApiModelsBySource collapses same endpoint without sourceId', () => {
  const groups = groupSavedApiModelsBySource([
    profile({ id: 'a', modelName: 'grok-4.6', label: 'Grok 4.6' }),
    profile({ id: 'b', modelName: 'grok-imagine', label: 'Imagine' }),
    profile({
      id: 'c',
      modelName: 'other',
      baseUrl: 'https://other.example.test/v1',
      label: 'Other',
    }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.find((group) => group.baseUrl.includes('api.example'))?.models.map((item) => item.id),
    ['a', 'b'],
  );
});

test('groupSavedApiModelsBySource keeps same URL apart when sourceId differs', () => {
  const groups = groupSavedApiModelsBySource([
    profile({ id: 'a', modelName: 'one', sourceId: 'src-a', sourceLabel: 'cpa' }),
    profile({ id: 'b', modelName: 'two', sourceId: 'src-b', sourceLabel: 'recardaigrok' }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.label).sort(), ['cpa', 'recardaigrok']);
});

test('inferApiSourceLabel uses hostname when labels are model ids', () => {
  assert.equal(
    inferApiSourceLabel(
      [
        profile({ id: 'a', modelName: 'grok-4.6', label: 'grok-4.6' }),
        profile({ id: 'b', modelName: 'grok-imagine', label: 'grok-imagine' }),
      ],
      'https://api.661055.xyz/v1',
    ),
    'api.661055.xyz',
  );
});

test('replaceSavedApiSourceModels updates one source and keeps others', () => {
  const previous = [
    profile({ id: 'a', modelName: 'keep-a', baseUrl: 'https://cloud-a.invalid/v1' }),
    profile({ id: 'b', modelName: 'old-b', baseUrl: 'https://cloud-b.invalid/v1' }),
  ];
  const next = replaceSavedApiSourceModels(previous, savedApiSourceKey(previous[1]!), [
    profile({ id: 'b', modelName: 'new-b', baseUrl: 'https://cloud-b.invalid/v1' }),
  ]);
  assert.deepEqual(
    next.map((item) => item.modelName),
    ['keep-a', 'new-b'],
  );
});

test('profilesFromSourceCatalog reuses ids by model name and writes source fields', () => {
  const saved = profilesFromSourceCatalog({
    sourceId: 'src-1',
    sourceLabel: 'cpa',
    provider: 'openai_compatible',
    baseUrl: 'https://api.example.test/v1',
    temperature: 0.4,
    timeoutSeconds: 90,
    previous: [profile({ id: 'keep', modelName: 'grok-4.6', label: 'Old' })],
    models: [
      {
        id: 'ignored',
        modelName: 'grok-4.6',
        label: 'Grok 4.6',
        maxTokens: 12000,
        contextTokens: 256000,
      },
      { modelName: 'grok-imagine', label: '', maxTokens: 8000 },
      { modelName: '   ', label: 'blank', maxTokens: 1 },
    ],
  });
  assert.equal(saved.length, 2);
  assert.equal(saved[0]?.id, 'keep');
  assert.equal(saved[0]?.sourceId, 'src-1');
  assert.equal(saved[0]?.sourceLabel, 'cpa');
  assert.equal(saved[0]?.label, 'Grok 4.6');
  assert.equal(saved[0]?.contextTokens, 256000);
  assert.equal(saved[1]?.label, 'grok-imagine');
});

test('primaryProfileInSource prefers the active model', () => {
  const group = groupSavedApiModelsBySource([
    profile({ id: 'a', modelName: 'one' }),
    profile({ id: 'b', modelName: 'two' }),
  ])[0]!;
  assert.equal(primaryProfileInSource(group, 'b').id, 'b');
  assert.equal(primaryProfileInSource(group, 'missing').id, 'a');
});
