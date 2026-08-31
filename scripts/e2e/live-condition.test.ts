import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isClosedWebDriverSessionError,
  readSequentialLiveConditionSnapshot,
  waitForLiveCondition,
} from './live-condition.ts';

test('reads live-condition snapshot sources strictly in sequence', async () => {
  const calls: string[] = [];
  let resolveFirst: ((value: string) => void) | undefined;
  const firstPending = new Promise<string>((resolve) => {
    resolveFirst = resolve;
  });

  const snapshotPending = readSequentialLiveConditionSnapshot(
    async () => {
      calls.push('first:start');
      const value = await firstPending;
      calls.push('first:end');
      return value;
    },
    async () => {
      calls.push('second:start');
      return 'runtime';
    },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first:start']);
  resolveFirst!('conversation');

  assert.deepEqual(await snapshotPending, ['conversation', 'runtime']);
  assert.deepEqual(calls, ['first:start', 'first:end', 'second:start']);
});

test('does not start the second live-condition source after the first source fails', async () => {
  let secondCalls = 0;
  await assert.rejects(
    readSequentialLiveConditionSnapshot(
      async () => {
        throw new Error('conversation read failed');
      },
      async () => {
        secondCalls += 1;
        return 'runtime';
      },
    ),
    /conversation read failed/,
  );
  assert.equal(secondCalls, 0);
});

test('recognizes unrecoverable WebDriver session errors', () => {
  const fatalMessages = [
    'WebDriverError: invalid session id when running "execute/async" with method "POST"',
    'WebDriverError: browser connection was closed',
    'WebDriver session has been deleted',
    'disconnected: not connected to DevTools',
  ];

  for (const message of fatalMessages) {
    assert.equal(isClosedWebDriverSessionError(new Error(message)), true, message);
  }
  assert.equal(isClosedWebDriverSessionError(new Error('temporary bridge read failed')), false);
});

test('fails immediately when the WebDriver session is invalid', async () => {
  let attempts = 0;
  await assert.rejects(
    waitForLiveCondition(
      async () => {
        attempts += 1;
        throw new Error('WebDriverError: invalid session id when running "execute/async"');
      },
      {
        timeout: 60_000,
        interval: 30_000,
        timeoutMessage: 'should not reach the timeout',
      },
    ),
    /WebDriver session closed.*invalid session id/i,
  );
  assert.equal(attempts, 1);
});

test('fails immediately when the browser connection is closed', async () => {
  let attempts = 0;
  await assert.rejects(
    waitForLiveCondition(
      async () => {
        attempts += 1;
        throw new Error('WebDriverError: browser connection is closed');
      },
      {
        timeout: 60_000,
        interval: 30_000,
        timeoutMessage: 'should not reach the timeout',
      },
    ),
    /WebDriver session closed.*browser connection is closed/i,
  );
  assert.equal(attempts, 1);
});

test('continues retrying recoverable condition errors', async () => {
  let attempts = 0;
  await waitForLiveCondition(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary bridge read failed');
      return true;
    },
    {
      timeout: 1_000,
      interval: 1,
      timeoutMessage: 'recoverable condition did not pass',
    },
  );
  assert.equal(attempts, 2);
});

test('applies the remaining deadline to a condition promise that never settles', async () => {
  let attempts = 0;
  const startedAt = Date.now();

  await assert.rejects(
    waitForLiveCondition(
      () => {
        attempts += 1;
        return new Promise<boolean>(() => {
          // This simulates a bridge call that never returns to the polling loop.
        });
      },
      {
        timeout: 30,
        interval: 10_000,
        timeoutMessage: 'stalled condition reached its deadline',
      },
    ),
    (error: unknown) =>
      error instanceof Error && error.message === 'stalled condition reached its deadline',
  );

  assert.equal(attempts, 1);
  assert.ok(Date.now() - startedAt < 1_000, 'the deadline did not interrupt the stalled condition');
});
