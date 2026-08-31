import assert from 'node:assert/strict';
import test from 'node:test';
import {
  restoreContinuousTaskSurface,
  type ContinuousTaskSurfaceState,
} from './continuous-task-surface.ts';

function createController(states: ContinuousTaskSurfaceState[]) {
  const operations: string[] = [];
  let readIndex = 0;
  return {
    operations,
    controller: {
      readState: async () => states[Math.min(readIndex++, states.length - 1)]!,
      openWorkbench: async () => {
        operations.push('open-workbench');
      },
      selectProject: async (novelId: string) => {
        operations.push(`select-project:${novelId}`);
      },
      selectConversation: async (conversationId: string) => {
        operations.push(`select-conversation:${conversationId}`);
      },
    },
  };
}

test('keeps an already selected continuous task untouched', async () => {
  const fixture = createController([
    { workbenchVisible: true, conflictingSurfaceVisible: false, conversationId: 'task-1' },
  ]);
  const result = await restoreContinuousTaskSurface({
    novelId: 'novel-1',
    conversationId: 'task-1',
    controller: fixture.controller,
  });

  assert.deepEqual(result, { restored: false });
  assert.deepEqual(fixture.operations, []);
});

test('restores the original task before workbench-only assertions or retry actions', async () => {
  const fixture = createController([
    { workbenchVisible: false, conflictingSurfaceVisible: true, conversationId: '' },
    { workbenchVisible: true, conflictingSurfaceVisible: false, conversationId: 'task-1' },
  ]);
  const result = await restoreContinuousTaskSurface({
    novelId: 'novel-1',
    conversationId: 'task-1',
    controller: fixture.controller,
  });

  assert.deepEqual(result, { restored: true });
  assert.deepEqual(fixture.operations, [
    'open-workbench',
    'select-project:novel-1',
    'select-conversation:task-1',
  ]);
});

test('fails closed when navigation does not restore the expected task', async () => {
  const fixture = createController([
    { workbenchVisible: false, conflictingSurfaceVisible: true, conversationId: '' },
    {
      workbenchVisible: true,
      conflictingSurfaceVisible: false,
      conversationId: 'another-task',
    },
  ]);

  await assert.rejects(
    restoreContinuousTaskSurface({
      novelId: 'novel-1',
      conversationId: 'task-1',
      controller: fixture.controller,
    }),
    /did not restore its original continuous task surface/i,
  );
});
