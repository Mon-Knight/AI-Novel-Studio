import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversationBundle, TaskRun } from '../../types/conversation';
import { assertRecoverableRun, recoverableTurnRun } from './workbenchRetryRecovery';
import { projectWorkbenchEvents } from '../../features/workbench/workbenchPresentation';

function bundle(): TaskConversationBundle {
  const failed: TaskRun = {
    runId: 'failed',
    conversationId: 'c',
    turnId: 'u',
    chapterId: 'chapter',
    status: 'failed',
    workerId: 'w',
    modelSnapshot: {
      providerId: 'mock',
      modelId: 'mock',
      runtimeMode: 'mock',
      capabilities: [],
      options: {},
      capturedAt: '2026-01-01',
    },
    createdAt: '2026-01-01T00:00:01Z',
    updatedAt: '2026-01-01T00:00:02Z',
  };
  return {
    conversation: {
      conversationId: 'c',
      novelId: 'n',
      title: 'retry',
      status: 'failed',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    turns: [
      {
        turnId: 'u',
        conversationId: 'c',
        sequence: 1,
        role: 'user',
        content: '写本章',
        createdAt: '2026-01-01',
      },
    ],
    runs: [
      failed,
      { ...failed, runId: 'planner', status: 'completed', createdAt: '2026-01-01T00:00:03Z' },
    ],
    toolEvents: [
      {
        eventId: 'p',
        runId: 'planner',
        sequence: 1,
        toolName: 'creative.plan_action',
        argumentsSummary: {},
        status: 'succeeded',
        createdAt: '2026-01-01T00:00:04Z',
      },
    ],
    artifacts: [],
  };
}

test('a later completed planner cannot hide a failed execution stage in either UI or click validation', () => {
  const value = bundle();
  assert.equal(recoverableTurnRun(value, 'u')?.runId, 'failed');
  assert.equal(assertRecoverableRun(value, 'failed').chapterId, 'chapter');
  const ends = projectWorkbenchEvents(value).filter((entry) => entry.kind === 'run_end');
  assert.equal(ends.find((entry) => entry.runId === 'failed')?.recoverable, true);
  assert.equal(ends.find((entry) => entry.runId === 'planner')?.recoverable, false);
  value.toolEvents.push({
    ...value.toolEvents[0],
    eventId: 'contract',
    toolName: 'dsh.execution_contract',
    argumentsSummary: { source: 'ans-host' },
  });
  assert.equal(
    projectWorkbenchEvents(value).some((entry) => entry.id === 'tool:contract'),
    false,
  );
});

test('active, unknown completed, mixed candidate and existing card facts keep recovery closed', () => {
  for (const kind of ['active', 'unknown', 'candidate', 'artifact', 'newer-failure']) {
    const value = bundle();
    if (kind === 'active') value.runs[1].status = 'running';
    if (kind === 'unknown') value.toolEvents = [];
    if (kind === 'candidate')
      value.toolEvents.push({
        ...value.toolEvents[0],
        eventId: 'candidate',
        toolName: 'generate_chapter',
      });
    if (kind === 'artifact')
      value.artifacts.push({
        cardId: 'card',
        conversationId: 'c',
        runId: 'failed',
        artifactType: 'chapter_text',
        title: 'existing',
        summary: '',
        status: 'candidate',
        createdAt: '2026-01-01',
      });
    if (kind === 'newer-failure') value.runs[1].status = 'failed';
    assert.throws(() => assertRecoverableRun(value, 'failed'), /无法重试旧运行/, kind);
  }
});

test('run ordering and unrelated conversations cannot choose a stale failure', () => {
  const value = bundle();
  value.runs.reverse();
  assert.equal(recoverableTurnRun(value, 'u')?.runId, 'failed');
  value.runs.find((run) => run.runId === 'failed')!.conversationId = 'other';
  assert.equal(recoverableTurnRun(value, 'u'), undefined);
});
