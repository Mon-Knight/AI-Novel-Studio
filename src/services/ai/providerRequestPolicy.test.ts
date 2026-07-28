import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTONOMOUS_CHAPTER_BATCH_MIN_TIMEOUT_SECONDS,
  CONNECTION_TEST_MAX_OUTPUT_TOKENS,
  CONNECTION_TEST_TEMPERATURE,
  buildProviderTransportRequestId,
  createProviderTransportRequestId,
  resolveProviderTimeoutSeconds,
} from './providerRequestPolicy';
import { buildConnectionTestPrompt } from './promptBuilder';

test('long autonomous chapter batches receive a safe timeout floor without changing other tasks', () => {
  assert.equal(
    resolveProviderTimeoutSeconds('autonomous_chapter_batch', 120),
    AUTONOMOUS_CHAPTER_BATCH_MIN_TIMEOUT_SECONDS,
  );
  assert.equal(resolveProviderTimeoutSeconds('autonomous_chapter_batch', 900), 900);
  assert.equal(resolveProviderTimeoutSeconds('connection_test', 120), 120);
  assert.equal(resolveProviderTimeoutSeconds('connection_test', undefined), undefined);
});

test('transport request IDs are bounded, valid and unique across network attempts', () => {
  const logicalId = `operation with spaces/${'x'.repeat(200)}`;
  const first = buildProviderTransportRequestId(logicalId, 'attempt-one');
  const second = buildProviderTransportRequestId(logicalId, 'attempt-two');

  assert.notEqual(first, second);
  assert.ok(first.length <= 128);
  assert.ok(second.length <= 128);
  assert.match(first, /^[A-Za-z0-9_.:-]+$/);
  assert.match(second, /^[A-Za-z0-9_.:-]+$/);

  const oversizedAttempt = buildProviderTransportRequestId('x', 'y'.repeat(500));
  assert.equal(oversizedAttempt.length, 128);
  assert.match(oversizedAttempt, /^[A-Za-z0-9_.:-]+$/);

  const sharedPrefix = 'z'.repeat(500);
  assert.notEqual(
    buildProviderTransportRequestId('x', `${sharedPrefix}-first`),
    buildProviderTransportRequestId('x', `${sharedPrefix}-second`),
  );
  assert.notEqual(
    buildProviderTransportRequestId('x', 'attempt/one'),
    buildProviderTransportRequestId('x', 'attempt one'),
  );

  const generatedFirst = createProviderTransportRequestId('autonomous-volume-1');
  const generatedSecond = createProviderTransportRequestId('autonomous-volume-1');
  assert.notEqual(generatedFirst, generatedSecond);
  assert.match(generatedFirst, /^[A-Za-z0-9_.:-]+$/);
  assert.match(generatedSecond, /^[A-Za-z0-9_.:-]+$/);
});

test('legacy connection prompt uses the shared reasoning-safe output budget', () => {
  assert.equal(buildConnectionTestPrompt().maxTokens, CONNECTION_TEST_MAX_OUTPUT_TOKENS);
  assert.equal(CONNECTION_TEST_MAX_OUTPUT_TOKENS, 128);
  assert.equal(CONNECTION_TEST_TEMPERATURE, 0);
});
