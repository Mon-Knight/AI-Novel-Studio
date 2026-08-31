import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreContextSource, type CoreContextSourceReadError } from './contextBuilder';

test('core context read failures preserve their source and original cause', async () => {
  const cause = new Error('sqlite unavailable');

  await assert.rejects(
    () =>
      loadCoreContextSource('world_setting', '世界设定', async () => {
        throw cause;
      }),
    (error: unknown) => {
      const readError = error as CoreContextSourceReadError & { cause?: unknown };
      assert.equal(readError.code, 'GENERATION_CORE_SOURCE_READ_FAILED');
      assert.equal(readError.source, 'world_setting');
      assert.equal(readError.cause, cause);
      assert.match(readError.message, /无法读取世界设定/);
      return true;
    },
  );
});

test('an absent core source remains distinguishable from a failed read', async () => {
  const result = await loadCoreContextSource('protagonist', '主角设定', async () => null);

  assert.equal(result, null);
});
