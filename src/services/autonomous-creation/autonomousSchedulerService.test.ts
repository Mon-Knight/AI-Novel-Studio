import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autonomousSchedulerService,
  PersistentSchedulerUnavailableError,
} from './autonomousSchedulerService';

test('browser mode explicitly disables persistent scheduling without local fallback', async () => {
  const capability = autonomousSchedulerService.capability();
  assert.equal(capability.runtime, 'browser');
  assert.equal(capability.persistent, false);
  await assert.rejects(
    autonomousSchedulerService.listRuns('novel-1'),
    PersistentSchedulerUnavailableError,
  );
});
