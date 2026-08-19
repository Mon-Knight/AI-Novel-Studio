import assert from 'node:assert/strict';
import test from 'node:test';
import { AiRequestCancelledError } from './aiCancellation';
import { LocalChapterModelQueue } from './localChapterModelQueue';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('local chapter queue runs requests strictly serially', async () => {
  const queue = new LocalChapterModelQueue();
  const events: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const run = (name: string) =>
    queue.enqueue(name, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      events.push(name + ':start');
      await wait(5);
      events.push(name + ':end');
      active -= 1;
      return name;
    });

  const results = await Promise.all([run('one'), run('two'), run('three')]);
  assert.deepEqual(results, ['one', 'two', 'three']);
  assert.equal(maximumActive, 1);
  assert.deepEqual(events, ['one:start', 'one:end', 'two:start', 'two:end', 'three:start', 'three:end']);
});

test('queued local request can be cancelled before it reaches the model', async () => {
  const queue = new LocalChapterModelQueue();
  const controller = new AbortController();
  const first = queue.enqueue('first', async () => {
    await wait(15);
    return 'first';
  });
  const second = queue.enqueue('second', async () => 'second', controller.signal);
  controller.abort();
  await assert.rejects(second, (error: unknown) => error instanceof AiRequestCancelledError);
  assert.equal(await first, 'first');
  assert.equal(queue.pendingCount, 0);
});
