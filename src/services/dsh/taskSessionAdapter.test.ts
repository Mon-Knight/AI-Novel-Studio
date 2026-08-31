import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskModelSnapshot, TaskRun } from '../../types/conversation';
import { taskConversationService } from '../conversation/taskConversationService';
import {
  captureLocalConversationalSnapshot,
  isActiveDshTaskRuntimeStatus,
  taskSessionAdapter,
  WORKBENCH_CONVERSATIONAL_REPLY,
} from './taskSessionAdapter';
import { dshTaskRuntimeService } from './taskRuntimeService';

test('local conversational replies record their real ANS source instead of the selected model', async () => {
  const originalCreateRun = taskConversationService.createRun;
  const originalUpdateRun = taskConversationService.updateRun;
  const originalAppendTurn = taskConversationService.appendTurn;
  const selectedModel: TaskModelSnapshot = {
    providerId: 'deepseek-official',
    modelId: 'deepseek-chat',
    runtimeMode: 'api',
    capabilities: ['conversation_turn'],
    options: {},
    capturedAt: '2026-08-28T00:00:00.000Z',
  };
  let capturedModel: TaskModelSnapshot | undefined;
  let capturedWorker = '';
  let assistantReply = '';
  let currentRun: TaskRun | undefined;

  try {
    taskConversationService.createRun = async (conversationId, turnId, modelSnapshot, workerId) => {
      capturedModel = modelSnapshot;
      capturedWorker = workerId;
      currentRun = {
        runId: 'run-local-help',
        conversationId,
        turnId,
        status: 'queued',
        modelSnapshot,
        workerId,
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z',
      };
      return currentRun;
    };
    taskConversationService.updateRun = async (_runId, status, patch) => {
      assert.ok(currentRun);
      currentRun = { ...currentRun, ...patch, status };
      return currentRun;
    };
    taskConversationService.appendTurn = async (conversationId, role, content) => {
      assert.equal(role, 'assistant');
      assistantReply = content;
      return {
        turnId: 'turn-local-help-reply',
        conversationId,
        sequence: 2,
        role,
        content,
        createdAt: '2026-08-28T00:00:01.000Z',
      };
    };

    const result = await taskSessionAdapter.startTurn({
      conversationId: 'conversation-local-help',
      novelId: 'novel-1',
      turnId: 'turn-local-help',
      goal: '你能做什么？',
      modelSnapshot: selectedModel,
    });

    assert.equal(result.status, 'completed');
    assert.equal(capturedModel?.providerId, 'ans-local');
    assert.equal(capturedModel?.modelId, 'workbench-help-v1');
    assert.notEqual(capturedModel?.providerId, selectedModel.providerId);
    assert.equal(capturedWorker, 'worker-ans-local-conversation-local-help');
    assert.equal(assistantReply, WORKBENCH_CONVERSATIONAL_REPLY);
  } finally {
    taskSessionAdapter.clear('conversation-local-help');
    taskConversationService.createRun = originalCreateRun;
    taskConversationService.updateRun = originalUpdateRun;
    taskConversationService.appendTurn = originalAppendTurn;
  }
});

test('local conversational snapshot exposes only the capability it actually provides', () => {
  const snapshot = captureLocalConversationalSnapshot();
  assert.deepEqual(snapshot.capabilities, ['conversation_turn']);
  assert.equal(snapshot.runtime?.adapterProtocol, 'ans_local_conversation_v1');
  assert.equal(snapshot.runtime?.adapterProvider, 'ans-local');
});

test('native model attestation remains an active task state before a run is persisted', () => {
  assert.equal(isActiveDshTaskRuntimeStatus('attesting'), true);
  assert.equal(isActiveDshTaskRuntimeStatus('queued'), true);
  assert.equal(isActiveDshTaskRuntimeStatus('running'), true);
  assert.equal(isActiveDshTaskRuntimeStatus('cancel_requested'), true);
  assert.equal(isActiveDshTaskRuntimeStatus('idle'), false);
  assert.equal(isActiveDshTaskRuntimeStatus('failed'), false);
});

test('renderer reload cancellation always reaches the Rust runtime authority', async () => {
  const originalWindow = globalThis.window;
  const originalCancel = dshTaskRuntimeService.cancel;
  const originalGetStatus = dshTaskRuntimeService.getStatus;
  const calls: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  dshTaskRuntimeService.getStatus = async (conversationId) => ({
    conversationId,
    runId: 'run-reloaded',
    sessionId: 'session-reloaded',
    workerId: 'worker-reloaded',
    status: 'running',
    runtime: 'dsh-headless-persistent',
  });
  dshTaskRuntimeService.cancel = async (conversationId) => {
    calls.push(conversationId);
    return {
      conversationId,
      runId: 'run-reloaded',
      sessionId: 'session-reloaded',
      workerId: 'worker-reloaded',
      status: 'cancel_requested',
      runtime: 'dsh-headless-persistent',
    };
  };

  try {
    assert.equal(taskSessionAdapter.isRunning('conversation-reloaded'), false);
    assert.equal(await taskSessionAdapter.isRunningAuthoritatively('conversation-reloaded'), true);
    assert.equal(await taskSessionAdapter.cancel('conversation-reloaded'), true);
    assert.deepEqual(calls, ['conversation-reloaded']);
  } finally {
    dshTaskRuntimeService.cancel = originalCancel;
    dshTaskRuntimeService.getStatus = originalGetStatus;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('native cancellation does not report success without a cancel-requested acknowledgement', async () => {
  const originalWindow = globalThis.window;
  const originalCancel = dshTaskRuntimeService.cancel;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  dshTaskRuntimeService.cancel = async (conversationId) => ({
    conversationId,
    runId: 'run-terminal',
    sessionId: 'session-terminal',
    workerId: 'worker-terminal',
    status: 'idle',
    runtime: 'dsh-headless-persistent',
  });

  try {
    assert.equal(await taskSessionAdapter.cancel('conversation-terminal'), false);
  } finally {
    dshTaskRuntimeService.cancel = originalCancel;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('renderer reload projection subscription is delegated to the native runtime', async () => {
  const originalWindow = globalThis.window;
  const originalSubscribe = dshTaskRuntimeService.subscribe;
  let deliveredConversationId = '';
  let released = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  dshTaskRuntimeService.subscribe = async (listener) => {
    listener({
      conversationId: 'conversation-reloaded',
      runId: 'run-reloaded',
      kind: 'terminal',
      occurredAt: '2026-08-29T03:00:00.000Z',
    });
    return () => {
      released = true;
    };
  };

  try {
    const unlisten = await taskSessionAdapter.subscribeToRuntimeProjections((notice) => {
      deliveredConversationId = notice.conversationId;
    });
    assert.equal(deliveredConversationId, 'conversation-reloaded');
    unlisten();
    assert.equal(released, true);
  } finally {
    dshTaskRuntimeService.subscribe = originalSubscribe;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});
