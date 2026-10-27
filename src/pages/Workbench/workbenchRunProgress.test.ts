import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversation } from '../../types/conversation';
import {
  resolveWorkbenchConversationStatus,
  resolveWorkbenchRunProgress,
} from './workbenchRunProgress';

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

test('completed read tools do not invent a result-processing stage while the model is pending', () => {
  const run = {
    runId: 'r',
    turnId: 'u',
    conversationId: 'c',
    status: 'running' as const,
    workerId: 'w',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:02Z',
    modelSnapshot: {
      providerId: 'mock',
      modelId: 'mock',
      runtimeMode: 'mock' as const,
      capabilities: [],
      options: {},
      capturedAt: '2026-01-01',
    },
  };
  const events = [
    {
      eventId: 'read',
      runId: 'r',
      toolName: 'novel.read_context',
      status: 'succeeded' as const,
      sequence: 1,
      argumentsSummary: {},
      createdAt: run.createdAt,
      finishedAt: run.updatedAt,
    },
  ];
  assert.equal(
    resolveWorkbenchRunProgress(run, events, Date.parse('2026-01-01T00:02:00Z')).stage,
    '等待模型响应',
  );
  assert.equal(
    resolveWorkbenchRunProgress(
      { ...run, error: 'DSH_CHAPTER_CANDIDATE_WITHHELD' },
      events,
      Date.now(),
    ).stage,
    '正在校验章节候选',
  );
  assert.equal(
    resolveWorkbenchRunProgress({ ...run, status: 'cancel_requested' }, events, Date.now()).stage,
    '正在停止',
  );
  const facts = [
    ...events,
    {
      ...events[0],
      eventId: 'contract',
      toolName: 'dsh.execution_contract',
      argumentsSummary: { source: 'ans-host', requestTimeoutSeconds: 120 },
    },
    { ...events[0], eventId: 'retry-announced', toolName: 'dsh.llm.retry' },
    { ...events[0], eventId: 'retry-started', toolName: 'dsh.llm.retry-started' },
  ];
  const progress = resolveWorkbenchRunProgress(run, facts, Date.now());
  assert.equal(progress.requestLimit, '单次模型请求上限 2分00秒');
  assert.equal(progress.providerRetryCount, 1);
  assert.equal(resolveWorkbenchRunProgress(run, events, Date.now()).requestLimit, undefined);
});
