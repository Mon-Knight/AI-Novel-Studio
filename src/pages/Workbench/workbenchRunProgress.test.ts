import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversation } from '../../types/conversation';
import { resolveWorkbenchConversationStatus } from './workbenchRunProgress';

function conversation(status: TaskConversation['status'], updatedAt: string): TaskConversation {
  return {
    conversationId: 'conversation-status',
    novelId: 'novel-status',
    title: '状态投影',
    status,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt,
  };
}

test('a fresh lightweight task status outranks a stale hydrated bundle after run completion', () => {
  assert.equal(
    resolveWorkbenchConversationStatus({
      runtimeActive: false,
      bundleConversation: conversation('running', '2026-08-29T00:00:01.000Z'),
      listedConversation: conversation('waiting_user', '2026-08-29T00:00:02.000Z'),
    }),
    'waiting_user',
  );
});

test('an active runtime remains authoritative while terminal projections are settling', () => {
  assert.equal(
    resolveWorkbenchConversationStatus({
      runtimeActive: true,
      bundleConversation: conversation('waiting_user', '2026-08-29T00:00:02.000Z'),
      listedConversation: conversation('waiting_user', '2026-08-29T00:00:02.000Z'),
    }),
    'running',
  );
});

test('a newer hydrated bundle is retained when the task list is stale', () => {
  assert.equal(
    resolveWorkbenchConversationStatus({
      runtimeActive: false,
      bundleConversation: conversation('failed', '2026-08-29T00:00:03.000Z'),
      listedConversation: conversation('running', '2026-08-29T00:00:02.000Z'),
    }),
    'failed',
  );
});
