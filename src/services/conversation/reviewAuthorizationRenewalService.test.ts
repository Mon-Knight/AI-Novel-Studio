import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { reviewAuthorizationRenewalService } from './reviewAuthorizationRenewalService';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  clearMocks();
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('browser cannot preview, renew, readback or claim native review authority', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  assert.equal(reviewAuthorizationRenewalService.isSupported(), false);
  await assert.rejects(
    reviewAuthorizationRenewalService.preview({ authorizationId: 'old', savedDraftId: 'saved' }),
    /必须由桌面原生服务/,
  );
  await assert.rejects(
    reviewAuthorizationRenewalService.renew({
      authorizationId: 'old',
      operationId: 'operation',
      expectedPreviewHash: 'hash',
      savedDraftId: 'saved',
    }),
    /必须由桌面原生服务/,
  );
  await assert.rejects(
    reviewAuthorizationRenewalService.getResult({
      authorizationId: 'old',
      operationId: 'operation',
    }),
    /必须由桌面原生服务/,
  );
  await assert.rejects(reviewAuthorizationRenewalService.resume('old'), /必须由桌面原生服务/);
});

test('native renewal adapter preserves exact preview and operation identity without model or baseline signing fields', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  const calls: Array<{ command: string; args: unknown }> = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    return null;
  });
  await reviewAuthorizationRenewalService.preview({
    authorizationId: 'old',
    savedDraftId: 'saved',
  });
  const input = {
    authorizationId: 'old',
    operationId: 'same-operation',
    expectedPreviewHash: 'p'.repeat(64),
    savedDraftId: 'saved',
  };
  await reviewAuthorizationRenewalService.renew(input);
  await reviewAuthorizationRenewalService.getResult({
    authorizationId: 'old',
    operationId: 'same-operation',
  });
  await reviewAuthorizationRenewalService.resume('old');
  assert.deepEqual(calls, [
    {
      command: 'preview_review_authorization_renewal',
      args: { input: { authorizationId: 'old', savedDraftId: 'saved' } },
    },
    { command: 'renew_review_authorization', args: { input } },
    {
      command: 'get_review_authorization_renewal',
      args: { authorizationId: 'old', operationId: 'same-operation' },
    },
    { command: 'get_review_authorization_resume', args: { authorizationId: 'old' } },
  ]);
  for (const key of [
    'actor',
    'authorReviewed',
    'chapterBaselineHash',
    'modelSnapshot',
    'newAuthorizationId',
  ])
    assert.equal(key in input, false);
});

test('commit uncertainty never automatically repeats signing', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  const commands: string[] = [];
  mockIPC((command) => {
    commands.push(command);
    throw { code: 'DATABASE_COMMIT_UNKNOWN', message: '核对同一操作', retryable: true };
  });
  await assert.rejects(
    reviewAuthorizationRenewalService.renew({
      authorizationId: 'old',
      operationId: 'fixed-operation',
      expectedPreviewHash: 'p'.repeat(64),
    }),
  );
  assert.deepEqual(commands, ['renew_review_authorization']);
});
