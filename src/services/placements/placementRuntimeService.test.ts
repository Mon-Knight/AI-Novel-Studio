import assert from 'node:assert/strict';
import test from 'node:test';
import { placementRuntimeServicePrivate } from './placementRuntimeService';

test('commit-unknown safe apply replay reuses the same operation without duplicating caller intent', async () => {
  let calls = 0;
  const result = await placementRuntimeServicePrivate.withCommitReplay(async () => {
    calls += 1;
    if (calls === 1) {
      throw {
        code: 'DATABASE_COMMIT_UNKNOWN',
        message: 'commit response lost',
        retryable: true,
        operationId: 'apply-placement:plan-1',
      };
    }
    return { targetId: 'world-setting-1' };
  });

  assert.deepEqual(result, { targetId: 'world-setting-1' });
  assert.equal(calls, 2);
});

test('safe apply does not replay ordinary conflicts', async () => {
  let calls = 0;
  await assert.rejects(
    placementRuntimeServicePrivate.withCommitReplay(async () => {
      calls += 1;
      throw {
        code: 'PLACEMENT_TARGET_CONFLICT',
        message: 'target changed',
        retryable: false,
      };
    }),
    (error: unknown) => (error as { code?: string }).code === 'PLACEMENT_TARGET_CONFLICT',
  );
  assert.equal(calls, 1);
});
