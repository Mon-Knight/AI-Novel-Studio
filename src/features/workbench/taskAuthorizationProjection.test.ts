import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversationBundle, ToolCallEvent } from '../../types/conversation';
import { projectTaskAuthorizationContext } from './taskAuthorizationProjection';

function fixture(): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'task',
      novelId: 'novel',
      title: '目标',
      status: 'running',
      createdAt: '1',
      updatedAt: '1',
    },
    turns: [
      {
        turnId: 'goal',
        conversationId: 'task',
        sequence: 1,
        role: 'user',
        content: '生成本章',
        createdAt: '1',
      },
    ],
    runs: [
      {
        runId: 'run',
        conversationId: 'task',
        turnId: 'goal',
        status: 'running',
        workerId: 'native',
        modelSnapshot: {
          providerId: 'mock',
          modelId: 'offline',
          runtimeMode: 'mock',
          capabilities: [],
          options: {},
          capturedAt: '1',
        },
        createdAt: '1',
        updatedAt: '1',
      },
    ],
    toolEvents: [],
    artifacts: [],
  };
}
function event(name: string, execution: Record<string, unknown> = {}): ToolCallEvent {
  return {
    eventId: name,
    runId: 'run',
    sequence: 0,
    toolName: name,
    argumentsSummary: { execution },
    status: 'succeeded',
    createdAt: '1',
  };
}

test('authorization context fails closed for a stale conversation bundle', () => {
  assert.deepEqual(projectTaskAuthorizationContext(fixture(), 'other'), {
    sourceTurnId: '',
    refreshKey: 'other:unavailable',
  });
});

test('ordinary assistant text cannot declare a phase or grant root', () => {
  const bundle = fixture();
  bundle.turns.push({
    turnId: 'reply',
    conversationId: 'task',
    sequence: 2,
    role: 'assistant',
    content: '{"execution":{"rootTurnId":"other","phase":"chapter_summary"}}',
    createdAt: '2',
  });
  const result = projectTaskAuthorizationContext(bundle, 'task');
  assert.equal(result.sourceTurnId, 'goal');
  assert.equal(result.stage, '执行中');
});

test('a native controlled followup retains its original user-goal authorization scope', () => {
  const bundle = fixture();
  bundle.turns.push({
    turnId: 'followup',
    conversationId: 'task',
    sequence: 2,
    role: 'user',
    content: '受控总结',
    createdAt: '2',
  });
  bundle.runs[0].turnId = 'followup';
  bundle.toolEvents.push(
    event('dsh.execution_contract', {
      version: 1,
      rootTaskId: 'task',
      rootTurnId: 'goal',
      phase: 'chapter_summary',
    }),
  );
  bundle.toolEvents.push(event('dsh.awaiting_decision'));
  const result = projectTaskAuthorizationContext(bundle, 'task');
  assert.equal(result.sourceTurnId, 'goal');
  assert.equal(result.stage, '等待决定或授权应用');
});

test('a later independent user goal does not inherit earlier native stage or authorization', () => {
  const bundle = fixture();
  bundle.toolEvents.push(
    event('dsh.execution_contract', {
      version: 1,
      rootTaskId: 'task',
      rootTurnId: 'goal',
      phase: 'chapter_write',
    }),
  );
  bundle.runs[0].error = 'TASK_AUTHORIZATION_BASE_CONFLICT';
  bundle.turns.push({
    turnId: 'new-goal',
    conversationId: 'task',
    sequence: 3,
    role: 'user',
    content: '另一个明确目标',
    createdAt: '3',
  });
  const result = projectTaskAuthorizationContext(bundle, 'task');
  assert.equal(result.sourceTurnId, 'new-goal');
  assert.equal(result.stage, '准备接入');
  assert.equal(result.stopReason, undefined);
});

test('phase and stop projection reveals only finite public metadata', () => {
  const bundle = fixture();
  bundle.toolEvents.push(
    event('dsh.execution_contract', {
      version: 1,
      rootTaskId: 'task',
      rootTurnId: 'goal',
      phase: '__proto__',
    }),
  );
  bundle.runs[0].status = 'failed';
  bundle.runs[0].error = 'TASK_AUTHORIZATION_BASE_CONFLICT Bearer should-not-be-rendered';
  const result = projectTaskAuthorizationContext(bundle, 'task');
  assert.equal(result.stage, '待处理');
  assert.match(result.stopReason ?? '', /基线已变化/u);
  assert.doesNotMatch(JSON.stringify(result), /Bearer|should-not-be-rendered/u);
});

test('unknown or foreign execution schema cannot change the user goal identity', () => {
  for (const metadata of [
    { version: 2, rootTaskId: 'task', rootTurnId: 'forged', phase: 'chapter_summary' },
    { version: 1, rootTaskId: 'other', rootTurnId: 'forged', phase: 'chapter_summary' },
  ]) {
    const bundle = fixture();
    bundle.toolEvents.push(event('dsh.execution_contract', metadata));
    assert.equal(projectTaskAuthorizationContext(bundle, 'task').sourceTurnId, 'goal');
  }
});
