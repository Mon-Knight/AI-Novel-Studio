import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrailingRefreshQueue,
  shouldRefreshRuntimeBundleAfterPoll,
} from './trailingRefreshQueue';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('collapses a refresh burst into one in-flight and one trailing read', async () => {
  const gates = [deferred(), deferred()];
  const calls: string[] = [];
  const requestRefresh = createTrailingRefreshQueue(async (key) => {
    calls.push(key);
    await gates[calls.length - 1]!.promise;
  });

  const first = requestRefresh('conversation-1');
  await Promise.resolve();
  const burst = Array.from({ length: 20 }, () => requestRefresh('conversation-1'));
  assert.deepEqual(calls, ['conversation-1']);
  assert.ok(burst.every((promise) => promise === first));

  gates[0]!.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ['conversation-1', 'conversation-1']);

  gates[1]!.resolve();
  await first;
  assert.equal(calls.length, 2);
});

test('does not serialize independent conversation refreshes', async () => {
  const gate = deferred();
  const calls: string[] = [];
  const requestRefresh = createTrailingRefreshQueue(async (key) => {
    calls.push(key);
    await gate.promise;
  });

  const first = requestRefresh('conversation-1');
  const second = requestRefresh('conversation-2');
  await Promise.resolve();
  assert.deepEqual(calls.sort(), ['conversation-1', 'conversation-2']);

  gate.resolve();
  await Promise.all([first, second]);
});

test('allows a new refresh after an earlier read fails', async () => {
  let attempts = 0;
  const requestRefresh = createTrailingRefreshQueue(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('read failed');
  });

  await assert.rejects(requestRefresh('conversation-1'), /read failed/);
  await requestRefresh('conversation-1');
  assert.equal(attempts, 2);
});

test('polling refreshes a selected bundle only when runtime ownership changes', () => {
  assert.equal(
    shouldRefreshRuntimeBundleAfterPoll(new Set(), new Set(['conversation-1']), 'conversation-1'),
    true,
  );
  assert.equal(
    shouldRefreshRuntimeBundleAfterPoll(
      new Set(['conversation-1']),
      new Set(['conversation-1']),
      'conversation-1',
    ),
    false,
  );
  assert.equal(
    shouldRefreshRuntimeBundleAfterPoll(new Set(['conversation-1']), new Set(), 'conversation-1'),
    true,
  );
  assert.equal(
    shouldRefreshRuntimeBundleAfterPoll(new Set(['conversation-2']), new Set(), 'conversation-1'),
    false,
  );
});
