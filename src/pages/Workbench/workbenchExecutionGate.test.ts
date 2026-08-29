import assert from 'node:assert/strict';
import test from 'node:test';
import { executeWorkbenchTurnAfterContextReady } from './workbenchExecutionGate';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('context-dependent workbench entry goals wait at the shared execution gate', async () => {
  const entryGoals = [
    ['ordinary send', '生成下一章'],
    ['retry', '审计本章质量并检查人物与设定一致性'],
    ['automatic asset preparation', '生成世界与规则设定候选'],
    ['resumed chapter goal', '继续生成本章正文'],
    ['automatic chapter summary', '总结本章'],
  ] as const;

  for (const [entry, goal] of entryGoals) {
    const migration = createDeferred();
    let waitCalls = 0;
    let executeCalls = 0;
    const pending = executeWorkbenchTurnAfterContextReady({
      goal,
      coordinator: {
        waitForContextMigration() {
          waitCalls += 1;
          return migration.promise;
        },
      },
      async execute() {
        executeCalls += 1;
        return entry;
      },
    });

    await Promise.resolve();
    assert.equal(waitCalls, 1, `${entry} should enter the shared migration gate once`);
    assert.equal(executeCalls, 0, `${entry} should remain blocked while migration is pending`);

    migration.resolve();
    assert.equal(await pending, entry);
    assert.equal(executeCalls, 1, `${entry} should execute once after migration settles`);
  }
});

test('local conversational replies bypass the context migration gate', async () => {
  let waitCalls = 0;
  let executeCalls = 0;

  const result = await executeWorkbenchTurnAfterContextReady({
    goal: '你能做什么？',
    coordinator: {
      async waitForContextMigration() {
        waitCalls += 1;
        await new Promise<void>(() => undefined);
      },
    },
    async execute() {
      executeCalls += 1;
      return 'local reply';
    },
  });

  assert.equal(result, 'local reply');
  assert.equal(waitCalls, 0);
  assert.equal(executeCalls, 1);
});

test('context migration failure blocks creative execution instead of using stale context', async () => {
  let executeCalls = 0;
  await assert.rejects(
    executeWorkbenchTurnAfterContextReady({
      goal: '继续生成下一章',
      coordinator: {
        async waitForContextMigration() {
          throw new Error('上下文迁移失败');
        },
      },
      async execute() {
        executeCalls += 1;
        return 'should not execute';
      },
    }),
    /上下文迁移失败/,
  );
  assert.equal(executeCalls, 0);
});
