import assert from 'node:assert/strict';
import test from 'node:test';
import { submitWorkbenchTask, type WorkbenchTaskSubmissionInput } from './workbenchTaskSubmission';

function fixture(): { input: WorkbenchTaskSubmissionInput; calls: string[] } {
  const calls: string[] = [];
  const input: WorkbenchTaskSubmissionInput = {
    goal: '生成还是检查呢，先讨论一下我的人物背景',
    requestedChapterId: '',
    taskModel: {
      providerId: 'openai_compatible',
      modelId: 'conversation-model',
      runtimeMode: 'api',
      capabilities: [],
      options: {},
      capturedAt: '2026-10-15T00:00:00Z',
    },
    selectedNovelId: 'novel',
    chapters: [],
    creatingTask: false,
    contextPending: false,
    contextFailed: false,
    submissionRef: { current: false },
    validateModelForSend: async (model) => {
      calls.push('validate');
      return model;
    },
    selectChapter: async () => {
      calls.push('select');
    },
    createTask: async (_goal, model) => {
      assert.equal(model, input.taskModel);
      calls.push('create');
      return {
        conversation: { conversationId: 'chat', novelId: 'novel' },
        turn: { turnId: 'turn' },
      };
    },
    startInitializedTask: async (request) => {
      assert.equal(request.goal, input.goal);
      calls.push('start');
    },
    onError: (message) => {
      if (message) calls.push(`error:${message}`);
    },
    onCreated: () => {
      calls.push('created');
    },
  };
  return { input, calls };
}

test('first desktop API dialogue persists without a model probe or asset-intent preflight', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  try {
    const { input, calls } = fixture();
    await submitWorkbenchTask(input);
    assert.deepEqual(calls, ['select', 'create', 'created', 'start']);
    assert.equal(input.submissionRef.current, false);
    for (const contextFailed of [false, true]) {
      const blocked = fixture();
      blocked.input.goal = '你好';
      blocked.input.contextFailed = contextFailed;
      blocked.input.contextPending = !contextFailed;
      await submitWorkbenchTask(blocked.input);
      assert.equal(blocked.calls.length, 1);
      assert.match(blocked.calls[0], /上下文/);
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('first dialogue still rejects a chapter outside the selected novel', async () => {
  const { input, calls } = fixture();
  input.contextPending = false;
  input.requestedChapterId = 'foreign';
  await submitWorkbenchTask(input);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /所选章节不属于当前小说/);
});
