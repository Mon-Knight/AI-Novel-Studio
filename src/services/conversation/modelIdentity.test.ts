import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalModelProviderId,
  modelIdentityKey,
  modelRouteKey,
  normalizeModelBaseUrl,
} from './modelIdentity';

test('canonicalizes provider aliases without rewriting unknown provider names', () => {
  assert.equal(canonicalModelProviderId(' DeepSeek '), 'deepseek-official');
  assert.equal(canonicalModelProviderId('DEEPSEEK-OFFICIAL'), 'deepseek-official');
  assert.equal(canonicalModelProviderId('openai-compatible'), 'openai_compatible');
  assert.equal(canonicalModelProviderId('test-provider'), 'test-provider');
});

test('model route and credential identities normalize endpoint and display whitespace', () => {
  assert.equal(normalizeModelBaseUrl(' https://provider.test/v1/// '), 'https://provider.test/v1');
  assert.equal(
    modelRouteKey({ providerId: 'deepseek', modelId: ' deepseek-chat ' }),
    'deepseek-official:deepseek-chat',
  );
  assert.equal(
    modelIdentityKey({
      providerId: 'openai-compatible',
      modelId: ' model-a ',
      baseUrl: 'https://provider.test/v1/',
    }),
    'openai_compatible\u0000model-a\u0000https://provider.test/v1',
  );
});
