import assert from 'node:assert/strict';
import test from 'node:test';

// Node 22+ strips erasable TypeScript syntax and executes the exact production
// module, so this test needs no third-party runner or duplicate implementation.
const safety = await import('./documentSafety.ts');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const targetA = { novelId: 'novel-a', chapterId: 'chapter-a' };

test('document target and draft must match the live workspace', () => {
  assert.deepEqual(safety.validateLiveDocumentTarget(targetA, { ...targetA }), { ok: true });
  assert.equal(
    safety.validateLiveDocumentTarget(targetA, { novelId: 'novel-a', chapterId: 'chapter-b' }).code,
    'chapter_target_mismatch',
  );
  assert.equal(
    safety.validateDraftDocumentTarget({ novelId: 'novel-b', chapterId: 'chapter-a' }, targetA).code,
    'draft_novel_mismatch',
  );
});

test('document apply rejects changed base content', () => {
  const identity = {
    resultId: 'result-1',
    target: targetA,
    baseContentHash: 'hash-before',
    mode: 'replace_all',
  };
  assert.deepEqual(safety.validateDocumentApplication(identity, {
    ...targetA,
    contentHash: 'hash-before',
  }), { ok: true });
  assert.equal(safety.validateDocumentApplication(identity, {
    ...targetA,
    contentHash: 'hash-after',
  }).code, 'base_content_hash_conflict');
});

test('same result/target/base/mode is applied only once and failed claims can retry', () => {
  const identity = {
    resultId: 'result-1',
    target: targetA,
    baseContentHash: 'hash-before',
    mode: 'append',
  };
  const guard = new safety.DocumentApplyIdempotencyGuard();
  const first = guard.claim(identity);
  const duplicate = guard.claim(identity);
  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(guard.release(first.key), true);
  assert.equal(guard.claim(identity).accepted, true);
});

test('A to B switch accepts B and discards late A load', async () => {
  const guard = new safety.MonotonicDocumentLoadGuard();
  const targetB = { novelId: 'novel-a', chapterId: 'chapter-b' };
  let liveTarget = targetA;

  const pendingA = deferred();
  const tokenA = guard.issue(targetA);
  const resultA = safety.resolveGuardedDocumentLoad(guard, tokenA, pendingA.promise, () => liveTarget);

  liveTarget = targetB;
  const pendingB = deferred();
  const tokenB = guard.issue(targetB);
  const resultB = safety.resolveGuardedDocumentLoad(guard, tokenB, pendingB.promise, () => liveTarget);

  pendingB.resolve('draft-b');
  assert.deepEqual(await resultB, { accepted: true, token: tokenB, value: 'draft-b' });

  pendingA.resolve('draft-a');
  const lateA = await resultA;
  assert.equal(lateA.accepted, false);
  assert.equal(lateA.reason.code, 'stale_load_token');
});

test('returning to A never resurrects an old A token', () => {
  const guard = new safety.MonotonicDocumentLoadGuard();
  const oldA = guard.issue(targetA);
  guard.issue({ novelId: 'novel-a', chapterId: 'chapter-b' });
  assert.equal(guard.validateCommit(oldA, targetA).code, 'stale_load_token');
});
