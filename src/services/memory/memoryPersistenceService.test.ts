import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryDesktopRequiredError,
  memoryPersistenceService,
} from './memoryPersistenceService';

test('browser mode never fabricates a LocalStorage Memory Snapshot', async () => {
  assert.equal(memoryPersistenceService.isAvailable(), false);
  await assert.rejects(
    () => memoryPersistenceService.create({
      operationId: 'memory-browser-test',
      novelId: 'novel-browser-test',
      targetChapterId: 'chapter-browser-test',
    }),
    (error) => error instanceof MemoryDesktopRequiredError
      && error.code === 'MEMORY_DESKTOP_REQUIRED',
  );
});

