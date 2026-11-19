import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import type { IssueTaskAuthorizationInput } from '../../types/taskAuthorization';
import { taskAuthorizationService } from './taskAuthorizationService';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  clearMocks();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
const input: IssueTaskAuthorizationInput = {
  conversationId: 'task-a',
  novelId: 'novel-a',
  sourceTurnId: 'user-turn-a',
  chapterIds: ['chapter-a'],
  allowNovelPlanning: false,
  actions: [{ action: 'adopt_chapter_text', maxWrites: 1 }],
  maxWrites: 1,
  budget: {
    maxRequests: 8,
    maxToolCalls: 24,
    maxRevisions: 2,
    maxTokens: 32_000,
    maxCostUsd: 1,
    maxWallClockMs: 300_000,
  },
  expiresAt: '2026-11-11T09:00:00.000Z',
};

test('browser development cannot issue, apply, revoke or mirror native authority', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  await assert.rejects(taskAuthorizationService.issue(input), /仅由桌面原生服务/);
  await assert.rejects(taskAuthorizationService.list('task-a'), /仅由桌面原生服务/);
  await assert.rejects(
    taskAuthorizationService.revoke({ authorizationId: 'grant-a' }),
    /仅由桌面原生服务/,
  );
  await assert.rejects(
    taskAuthorizationService.apply({
      authorizationId: 'grant-a',
      operationId: 'write-a',
      cardId: 'card-a',
      artifactId: 'artifact-a',
      action: 'adopt_chapter_text',
    }),
    /仅由桌面原生服务/,
  );
  await assert.rejects(taskAuthorizationService.listReceipts('grant-a'), /仅由桌面原生服务/);
});

test('desktop IPC preserves separate action limits and never supplies model, baseline or reviewed authority', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  const calls: Array<{ command: string; args: unknown }> = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    return { authorizationId: 'native-grant' };
  });
  await taskAuthorizationService.issue(input);
  await taskAuthorizationService.list('task-a');
  await taskAuthorizationService.revoke({
    authorizationId: 'native-grant',
    reason: '停止后续写入',
  });
  await taskAuthorizationService.apply({
    authorizationId: 'native-grant',
    operationId: 'exact-operation',
    cardId: 'card-a',
    artifactId: 'artifact-a',
    action: 'adopt_chapter_text',
  });
  await taskAuthorizationService.listReceipts('native-grant');
  assert.deepEqual(
    calls.map(({ command }) => command),
    [
      'issue_task_authorization',
      'list_task_authorizations',
      'revoke_task_authorization',
      'apply_task_authorization',
      'list_task_authorization_receipts',
    ],
  );
  assert.deepEqual(calls[0].args, { input });
  const issuePayload = (calls[0].args as { input: IssueTaskAuthorizationInput }).input;
  for (const forbidden of [
    'actor',
    'authorReviewed',
    'modelSnapshot',
    'baselineHash',
    'issuedAt',
    'authorizationId',
  ]) {
    assert.equal(forbidden in issuePayload, false, forbidden);
  }
  assert.deepEqual(calls[3].args, {
    input: {
      authorizationId: 'native-grant',
      operationId: 'exact-operation',
      cardId: 'card-a',
      artifactId: 'artifact-a',
      action: 'adopt_chapter_text',
    },
  });
});

test('uncertain native application is not retried with a new operation identity', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  let calls = 0;
  mockIPC(() => {
    calls += 1;
    throw { code: 'DATABASE_COMMIT_UNKNOWN', message: '先核对同操作回执', retryable: true };
  });
  await assert.rejects(
    taskAuthorizationService.apply({
      authorizationId: 'grant',
      operationId: 'same-operation',
      cardId: 'card',
      artifactId: 'artifact',
      action: 'apply_summary',
    }),
  );
  assert.equal(calls, 1);
});
