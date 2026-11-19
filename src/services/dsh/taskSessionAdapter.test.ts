import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskModelSnapshot, TaskRun, TaskConversationBundle } from '../../types/conversation';
import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import { taskConversationService } from '../conversation/taskConversationService';
import { taskRuntimeAdapter, type TaskRuntimeInput } from '../conversation/taskRuntimeAdapter';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { taskRetryRecovery } from './taskRetryRecovery';
import {
  buildDesktopTaskRuntimeInput,
  captureLocalConversationalSnapshot,
  isActiveDshTaskRuntimeStatus,
  isModelLedCreativeTurn,
  taskSessionAdapter,
  WORKBENCH_CONVERSATIONAL_REPLY,
} from './taskSessionAdapter';
import {
  CREATIVE_DIALOGUE_ALLOWED_TOOLS,
  dshTaskRuntimeService,
  type DshTaskRuntimeInput,
  type DshTaskRuntimeResult,
} from './taskRuntimeService';

const model: TaskModelSnapshot = {
  providerId: 'fixture-provider',
  modelId: 'fixture-model',
  runtimeMode: 'api',
  baseUrl: 'http://127.0.0.1:15001/v1',
  capabilities: ['conversation_turn', 'tool_calling'],
  options: { maxTokens: 8000 },
  capturedAt: '2026-11-11T00:00:00.000Z',
};

const request: TaskRuntimeInput = {
  conversationId: 'task-1',
  novelId: 'novel-1',
  turnId: 'turn-1',
  chapterId: 'chapter-1',
  goal: '生成下一章',
  modelSnapshot: model,
};

function desktopWindow(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}

function result(
  input: DshTaskRuntimeInput,
  patch: Partial<DshTaskRuntimeResult> = {},
): DshTaskRuntimeResult {
  return {
    run: {
      runId: `run-${input.conversationId}`,
      conversationId: input.conversationId,
      turnId: input.turnId,
      chapterId: input.chapterId,
      status: 'completed',
      modelSnapshot: input.modelSnapshot,
      workerId: `worker-${input.conversationId}`,
      createdAt: '2026-11-11T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:01.000Z',
    },
    sessionId: `session-${input.conversationId}`,
    agentId: `agent-${input.conversationId}`,
    workerId: `worker-${input.conversationId}`,
    runtime: 'dsh-headless-persistent',
    ...patch,
  };
}

test('restricted browser local replies retain the real ANS source', async (t) => {
  let capturedModel: TaskModelSnapshot | undefined;
  let reply = '';
  let current: TaskRun;
  t.mock.method(
    taskConversationService,
    'createRun',
    async (
      conversationId: string,
      turnId: string,
      snapshot: TaskModelSnapshot,
      workerId: string,
    ) => {
      capturedModel = snapshot;
      current = {
        ...result({ ...request, modelSnapshot: snapshot, taskKind: 'read', requiredReadTools: [] })
          .run,
        conversationId,
        turnId,
        workerId,
        status: 'queued',
      };
      return current;
    },
  );
  t.mock.method(
    taskConversationService,
    'updateRun',
    async (_runId: string, status: TaskRun['status'], patch: Partial<TaskRun>) => {
      current = { ...current, ...patch, status };
      return current;
    },
  );
  t.mock.method(
    taskConversationService,
    'appendTurn',
    async (_conversationId: string, _role: string, content: string) => {
      reply = content;
      return { turnId: 'reply' };
    },
  );
  await taskSessionAdapter.startTurn({ ...request, goal: '你能做什么？' });
  assert.equal(capturedModel?.providerId, 'ans-local');
  assert.equal(reply, WORKBENCH_CONVERSATIONAL_REPLY);
  await taskSessionAdapter.startTurn({ ...request, goal: '本任务目标字数设为3200字' });
  assert.match(reply, /3200 字.*2560～3680 字/u);
  assert.match(reply, /未调用模型、未生成或采用正文/u);
});

test('local browser snapshot never claims generation or model verification capability', () => {
  const local = captureLocalConversationalSnapshot();
  assert.deepEqual(local.capabilities, ['conversation_turn']);
  assert.equal(local.runtime?.adapterProvider, 'ans-local');
  assert.equal(local.runtime?.toolCallingAttestation, undefined);
});

test('active status projection retains attestation and excludes terminal states', () => {
  for (const state of ['attesting', 'queued', 'running', 'cancel_requested']) {
    assert.equal(isActiveDshTaskRuntimeStatus(state), true);
  }
  for (const state of ['idle', 'failed', 'completed', 'cancelled']) {
    assert.equal(isActiveDshTaskRuntimeStatus(state), false);
  }
});

test('all desktop model modes use one native root without Writer or renderer callback dispatch', async (t) => {
  const restore = desktopWindow();
  const inputs: DshTaskRuntimeInput[] = [];
  let callbacks = 0;
  let writerCalls = 0;
  t.mock.method(taskRuntimeAdapter, 'start', async () => {
    writerCalls++;
    throw new Error('retired desktop Writer');
  });
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    inputs.push(input);
    return result(input);
  });
  try {
    for (const selected of [
      model,
      {
        ...model,
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock' as const,
        baseUrl: undefined,
      },
      { ...model, providerId: 'local_llama_cpp', modelId: 'local-model' },
    ]) {
      for (const goal of [
        '你好',
        '读取当前世界设定',
        '生成下一章',
        '生成大纲候选',
        '检查本章质量',
        '总结本章',
      ]) {
        const before = inputs.length;
        const run = await taskSessionAdapter.startTurn({
          ...request,
          goal,
          modelSnapshot: selected,
          preparePlannedAction: async () => {
            callbacks++;
            return {};
          },
        });
        assert.equal(inputs.length, before + 1);
        assert.equal(run.status, 'completed');
        const sent = inputs[inputs.length - 1]!;
        assert.equal(sent.taskKind, 'creative_dialogue');
        assert.equal(sent.goal, goal);
        assert.deepEqual(sent.modelSnapshot, selected);
        assert.deepEqual(sent.allowedTools, CREATIVE_DIALOGUE_ALLOWED_TOOLS);
        assert.deepEqual(sent.requiredReadTools, []);
        assert.equal(sent.unifiedRuntime?.version, 1);
        assert.deepEqual(sent.unifiedRuntime?.writingPreferences?.wordRangePercents, {
          hardMinimumPercent: 80,
          hardMaximumPercent: 115,
        });
        assert.equal(sent.chapterHostGate, undefined);
        assert.equal('preparePlannedAction' in sent, false);
        assert.equal('workflowAction' in sent, false);
        assert.equal('workerId' in sent, false);
      }
    }
    assert.equal(writerCalls, 0);
    assert.equal(callbacks, 0);
  } finally {
    restore();
  }
});

test('an explicit chapter capability narrows tools but still makes one native call', async (t) => {
  const restore = desktopWindow();
  const inputs: DshTaskRuntimeInput[] = [];
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    inputs.push(input);
    return result(input);
  });
  try {
    for (const action of ['generate_chapter', 'polish_chapter'] as const) {
      await taskSessionAdapter.startTurn({ ...request, workflowAction: action });
      const sent = inputs[inputs.length - 1]!;
      assert.equal(
        sent.taskKind,
        action === 'generate_chapter' ? 'chapter_write' : 'chapter_polish',
      );
      assert.equal(sent.expectedTool, action);
      assert.equal(sent.expectedArtifactType, 'chapter_text');
      assert.deepEqual(sent.requiredReadTools, [
        'novel.read_context',
        'chapter.read_outline',
        'get_character_states',
        'search_memory',
      ]);
      assert.deepEqual(sent.allowedTools, [...sent.requiredReadTools, action]);
      assert.equal(sent.unifiedRuntime?.version, 1);
      assert.equal(sent.chapterHostGate, undefined, 'draft/admit are native internal stages');
    }
    assert.equal(inputs.length, 2);
    await taskSessionAdapter.startTurn({
      ...request,
      chapterId: undefined,
      workflowAction: 'generate_chapter',
    });
    assert.equal(
      inputs.length,
      3,
      'missing target is resolved or rejected by the same native lifecycle',
    );
  } finally {
    restore();
  }
});

test('desktop local task-word settings carry a native validated command, never a local renderer Run', async (t) => {
  const restore = desktopWindow();
  const inputs: DshTaskRuntimeInput[] = [];
  t.mock.method(taskConversationService, 'createRun', async () => {
    throw new Error('renderer must not create desktop Runs');
  });
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    inputs.push(input);
    return result(input);
  });
  try {
    await taskSessionAdapter.startTurn({ ...request, goal: '本任务目标字数设为3200字' });
    assert.equal(inputs.length, 1);
    assert.deepEqual(inputs[0].unifiedRuntime?.localCommand, {
      kind: 'task_word_target',
      targetWordCount: 3200,
      wordRange: { target: 3200, minimum: 2560, maximum: 3680 },
    });
    assert.deepEqual(
      inputs[0].modelSnapshot,
      model,
      'native records the actual no-provider execution identity',
    );
    assert.equal(inputs[0].unifiedRuntime?.writingPreferences?.targetWordCount, 3200);
    const once = buildDesktopTaskRuntimeInput({ ...request, goal: '生成下一章，目标9000字' });
    assert.equal(once.unifiedRuntime?.localCommand, undefined);
    assert.equal(once.unifiedRuntime?.writingPreferences?.targetWordCount, 9000);
  } finally {
    restore();
  }
});

test('revision source remains exact and mixed directives or stale hashes are rejected', async (t) => {
  const restore = desktopWindow();
  const content = JSON.stringify({ data: { title: '原全书大纲', chapters: ['深秋'] } });
  const source: ArtifactRevisionSource = {
    conversationId: 'revision-task',
    novelId: 'novel-1',
    cardId: 'old-card',
    artifactId: 'old-artifact',
    artifactHash: await computeContentSha256(content),
    artifactType: 'outline',
    title: '原全书大纲',
  };
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: source.conversationId,
      novelId: source.novelId,
      title: '修订',
      status: 'waiting_user',
      createdAt: '',
      updatedAt: '',
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts: ['old', 'new'].map((id) => ({
      cardId: `${id}-card`,
      artifactId: `${id}-artifact`,
      conversationId: source.conversationId,
      artifactType: 'outline',
      title: id,
      summary: '',
      status: 'candidate',
      createdAt: '',
    })),
    decisions: [
      {
        decisionId: 'decision',
        conversationId: source.conversationId,
        cardId: source.cardId,
        artifactId: source.artifactId,
        artifactHash: source.artifactHash,
        decision: 'request_revision',
        actor: 'user',
        targetType: 'asset',
        targetId: source.novelId,
        idempotencyKey: 'decision',
        createdAt: '',
      },
    ],
  };
  const reads: string[] = [];
  const inputs: DshTaskRuntimeInput[] = [];
  t.mock.method(taskConversationService, 'get', async () => bundle);
  t.mock.method(aiTaskRuntimeService, 'getArtifact', async (id: string) => {
    reads.push(id);
    return {
      artifact: {
        artifactId: source.artifactId,
        artifactType: 'outline',
        sourceNovelId: source.novelId,
        contentHash: source.artifactHash,
        processingStatus: 'valid',
      },
      rawContent: content,
      issues: [],
    };
  });
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    inputs.push(input);
    return result(input);
  });
  const input = {
    ...request,
    conversationId: source.conversationId,
    chapterId: undefined,
    revisionSource: source,
    goal: '请修订所选全书规划候选。第2章写深秋，写深秋的落叶，不生成正文。',
  };
  try {
    await taskSessionAdapter.startTurn(input);
    assert.deepEqual(reads, ['old-artifact']);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].expectedTool, 'generate_outline');
    assert.equal(inputs[0].chapterId, undefined);
    assert.deepEqual(inputs[0].revisionSource, source);
    await assert.rejects(
      taskSessionAdapter.startTurn({ ...input, goal: '修订所选大纲，同时生成第2章正文' }),
      { code: 'WORKBENCH_GOAL_CLARIFICATION_REQUIRED' },
    );
    await assert.rejects(
      taskSessionAdapter.startTurn({
        ...input,
        revisionSource: { ...source, artifactHash: '0'.repeat(64) },
      }),
      /修订来源已失效/u,
    );
    assert.equal(inputs.length, 1);
  } finally {
    restore();
  }
});

test('chapter revision cannot fall back to a read-intent or a latest candidate', () => {
  if (!request.novelId) throw new Error('test fixture requires a novel identity');
  const source: ArtifactRevisionSource = {
    conversationId: request.conversationId,
    novelId: request.novelId,
    chapterId: request.chapterId,
    cardId: 'old-card',
    artifactId: 'old-artifact',
    artifactHash: 'a'.repeat(64),
    artifactType: 'chapter_text',
    title: '正文候选',
  };
  const sent = buildDesktopTaskRuntimeInput({
    ...request,
    goal: '修订所选候选',
    revisionSource: source,
  });
  assert.equal(sent.taskKind, 'chapter_polish');
  assert.equal(sent.expectedTool, 'polish_chapter');
  assert.deepEqual(sent.revisionSource, source);
});

test('explicit retry uses the persisted native model, goal, capability and hard range once', async (t) => {
  const restore = desktopWindow();
  const inputs: DshTaskRuntimeInput[] = [];
  const frozen = { ...model, modelId: 'original-model' };
  t.mock.method(taskRetryRecovery, 'resolve', async () => ({
    sourceRunId: 'failed-original',
    turnId: request.turnId,
    chapterId: request.chapterId,
    modelSnapshot: frozen,
    execution: {
      taskKind: 'chapter_polish',
      expectedTool: 'polish_chapter',
      expectedArtifactType: 'chapter_text',
      requiredReadTools: [
        'novel.read_context',
        'chapter.read_outline',
        'get_character_states',
        'search_memory',
      ],
      goal: '冻结的修订指令',
      chapterWordRange: { target: 3400, minimum: 3060, maximum: 3740 },
    },
  }));
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    inputs.push(input);
    return result(input);
  });
  try {
    await taskSessionAdapter.startTurn({
      ...request,
      retrySourceRunId: 'failed-original',
      explicitChapterRetry: true,
      modelSnapshot: { ...model, modelId: 'new-choice' },
      goal: '当前措辞不能重新规划',
    });
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].taskKind, 'chapter_polish');
    assert.equal(inputs[0].goal, '冻结的修订指令');
    assert.deepEqual(inputs[0].modelSnapshot, frozen);
    assert.deepEqual(inputs[0].chapterWordRange, { target: 3400, minimum: 3060, maximum: 3740 });
    assert.equal(inputs[0].retrySourceRunId, 'failed-original');
    assert.equal(inputs[0].chapterHostGate, undefined);
  } finally {
    restore();
  }
});

test('missing retry contract is not replaced by current goal or Writer', async (t) => {
  const restore = desktopWindow();
  let dispatches = 0;
  t.mock.method(taskRetryRecovery, 'resolve', async () => ({
    sourceRunId: 'failed-original',
    turnId: request.turnId,
    chapterId: request.chapterId,
    modelSnapshot: model,
  }));
  t.mock.method(dshTaskRuntimeService, 'start', async () => {
    dispatches++;
    throw new Error('unexpected dispatch');
  });
  try {
    await assert.rejects(
      taskSessionAdapter.startTurn({ ...request, retrySourceRunId: 'failed-original' }),
      /缺少可恢复的执行契约/u,
    );
    assert.equal(dispatches, 0);
  } finally {
    restore();
  }
});

test('legacy phase-control results fail closed rather than restarting a renderer workflow', async (t) => {
  const restore = desktopWindow();
  let dispatches = 0;
  let preparations = 0;
  const input = {
    ...request,
    preparePlannedAction: async () => {
      preparations++;
      return {};
    },
  };
  let pending = false;
  t.mock.method(dshTaskRuntimeService, 'start', async (sent: DshTaskRuntimeInput) => {
    dispatches++;
    return pending
      ? result(sent, {
          pendingChapterCandidate: {
            runId: 'withheld',
            contentHash: 'a'.repeat(64),
            text: '尚未准入的正文',
            wordCount: 7,
          },
        })
      : result(sent, {
          plannedAction: {
            action: 'generate_chapter',
            chapterId: request.chapterId,
            instruction: '开始写章',
          },
        });
  });
  try {
    await assert.rejects(taskSessionAdapter.startTurn(input), /DSH_UNIFIED_RUNTIME_INCOMPLETE/u);
    pending = true;
    await assert.rejects(taskSessionAdapter.startTurn(input), /DSH_UNIFIED_RUNTIME_INCOMPLETE/u);
    assert.equal(dispatches, 2);
    assert.equal(preparations, 0);
  } finally {
    restore();
  }
});

test('native budget, context, model and cancellation failures are surfaced without automatic replay', async (t) => {
  const restore = desktopWindow();
  let dispatches = 0;
  let error = '';
  t.mock.method(dshTaskRuntimeService, 'start', async (sent: DshTaskRuntimeInput) => {
    dispatches++;
    const native = result(sent);
    return { ...native, run: { ...native.run, status: 'failed', error } };
  });
  try {
    for (const code of [
      'TASK_BUDGET_EXHAUSTED',
      'WORKBENCH_PREVIOUS_CHAPTER_NOT_ADOPTED',
      'MODEL_TOOL_CALLING_UNSUPPORTED',
      'DSH_CHAPTER_INTEGRITY_REJECTED',
    ]) {
      error = code;
      const before = dispatches;
      const run = await taskSessionAdapter.startTurn(request);
      assert.equal(run.status, 'failed');
      assert.equal(run.error, code);
      assert.equal(dispatches, before + 1);
    }
  } finally {
    restore();
  }
});

test('parent cancellation before dispatch never creates a native request', async (t) => {
  const restore = desktopWindow();
  let dispatches = 0;
  const controller = new AbortController();
  controller.abort();
  t.mock.method(dshTaskRuntimeService, 'start', async () => {
    dispatches++;
    throw new Error('unexpected dispatch');
  });
  try {
    await assert.rejects(
      taskSessionAdapter.startTurn({ ...request, cancellationSignal: controller.signal }),
      { name: 'AbortError' },
    );
    assert.equal(dispatches, 0);
  } finally {
    restore();
  }
});

test('renderer reload cancellation and runtime projection always use native authority', async (t) => {
  const restore = desktopWindow();
  const calls: string[] = [];
  let terminal = false;
  let released = false;
  t.mock.method(dshTaskRuntimeService, 'getStatus', async (conversationId: string) => ({
    conversationId,
    runId: 'run',
    sessionId: 'session',
    workerId: 'worker',
    status: 'running',
    runtime: 'dsh-headless-persistent',
  }));
  t.mock.method(dshTaskRuntimeService, 'cancel', async (conversationId: string) => {
    calls.push(conversationId);
    return {
      conversationId,
      runId: 'run',
      sessionId: 'session',
      workerId: 'worker',
      status: terminal ? 'idle' : 'cancel_requested',
      runtime: 'dsh-headless-persistent',
    };
  });
  t.mock.method(
    dshTaskRuntimeService,
    'subscribe',
    async (listener: Parameters<typeof dshTaskRuntimeService.subscribe>[0]) => {
      listener({
        conversationId: request.conversationId,
        runId: 'run',
        kind: 'terminal',
        occurredAt: '2026-11-11T00:00:00Z',
      });
      return () => {
        released = true;
      };
    },
  );
  try {
    assert.equal(taskSessionAdapter.isRunning(request.conversationId), false);
    assert.equal(await taskSessionAdapter.isRunningAuthoritatively(request.conversationId), true);
    assert.equal(await taskSessionAdapter.cancel(request.conversationId), true);
    terminal = true;
    assert.equal(await taskSessionAdapter.cancel(request.conversationId), false);
    assert.deepEqual(calls, [request.conversationId, request.conversationId]);
    let observed = '';
    const unlisten = await taskSessionAdapter.subscribeToRuntimeProjections((notice) => {
      observed = notice.conversationId;
    });
    assert.equal(observed, request.conversationId);
    unlisten();
    assert.equal(released, true);
  } finally {
    restore();
  }
});

test('model-led desktop admission does not distinguish Mock, cloud or local routes', () => {
  const restore = desktopWindow();
  try {
    for (const selected of [
      model,
      { ...model, runtimeMode: 'mock' as const },
      { ...model, providerId: 'local_llama_cpp' },
    ]) {
      assert.equal(isModelLedCreativeTurn({ ...request, modelSnapshot: selected }), true);
      assert.equal(
        isModelLedCreativeTurn({
          ...request,
          modelSnapshot: selected,
          goal: '本任务目标字数设为3200字',
        }),
        false,
      );
    }
  } finally {
    restore();
  }
});

test('retired renderer runtime explicitly rejects desktop execution', async () => {
  const restore = desktopWindow();
  try {
    await assert.rejects(taskRuntimeAdapter.start(request), /DESKTOP_TASK_RUNTIME_REQUIRED/u);
  } finally {
    restore();
  }
});

test('pending native ingress remains occupied and visible beside authoritative runtime statuses', async (t) => {
  const restore = desktopWindow();
  t.mock.method(dshTaskRuntimeService, 'isRunning', (id: string) => id === 'pending-1');
  t.mock.method(dshTaskRuntimeService, 'listInFlightConversationIds', () => ['pending-1']);
  t.mock.method(dshTaskRuntimeService, 'getStatus', async () => {
    throw new Error('pending dispatch already owns the send slot');
  });
  t.mock.method(dshTaskRuntimeService, 'listStatuses', async () => [
    {
      conversationId: 'native-active',
      runId: 'run-native',
      sessionId: 'session-native',
      workerId: 'worker-native',
      status: 'running',
      runtime: 'dsh-headless-persistent',
    },
    {
      conversationId: 'pending-1',
      runId: 'run-created',
      sessionId: 'session-created',
      workerId: 'worker-created',
      status: 'queued',
      runtime: 'dsh-headless-persistent',
    },
    {
      conversationId: 'done',
      runId: 'run-done',
      sessionId: 'session-done',
      workerId: 'worker-done',
      status: 'completed',
      runtime: 'dsh-headless-persistent',
    },
  ]);
  try {
    assert.equal(await taskSessionAdapter.isRunningAuthoritatively('pending-1'), true);
    assert.deepEqual(await taskSessionAdapter.listRunningConversationIds(), [
      'pending-1',
      'native-active',
    ]);
  } finally {
    restore();
  }
});

test('waiting-decision roots do not occupy generation while between-stage native roots remain active', async (t) => {
  const restore = desktopWindow();
  const waiting = {
    conversationId: 'waiting',
    runId: 'completed-candidate-run',
    sessionId: 'session-waiting',
    workerId: 'worker-idle',
    status: 'waiting_decision',
    runtime: 'dsh-headless-persistent',
  };
  const between = {
    ...waiting,
    conversationId: 'between-stages',
    runId: 'root-active',
    status: 'running',
  };
  t.mock.method(dshTaskRuntimeService, 'isRunning', () => false);
  t.mock.method(dshTaskRuntimeService, 'listInFlightConversationIds', () => []);
  t.mock.method(dshTaskRuntimeService, 'getStatus', async (id: string) =>
    id === waiting.conversationId ? waiting : between,
  );
  t.mock.method(dshTaskRuntimeService, 'listStatuses', async () => [waiting, between]);
  try {
    assert.equal(isActiveDshTaskRuntimeStatus(waiting.status), false);
    assert.equal(
      await taskSessionAdapter.isRunningAuthoritatively(waiting.conversationId),
      false,
      'the author may decide, grant or send another message',
    );
    assert.equal(
      await taskSessionAdapter.isRunningAuthoritatively(between.conversationId),
      true,
      'native root occupancy survives a worker gap or renderer reload',
    );
    assert.deepEqual(await taskSessionAdapter.listRunningConversationIds(), ['between-stages']);
    assert.equal(
      waiting.runId,
      'completed-candidate-run',
      'pending task state does not reinterpret the completed candidate run',
    );
  } finally {
    restore();
  }
});

test('pending cancellation acknowledgement preserves completed Runs and receipts without claiming rollback', async (t) => {
  const restore = desktopWindow();
  const completed = Object.freeze(
    result({
      ...request,
      modelSnapshot: model,
      taskKind: 'read',
      requiredReadTools: [],
    }).run,
  );
  const receipt = Object.freeze({
    transactionId: 'committed-transaction',
    artifactId: 'candidate-artifact',
    adoptedDraftId: 'adopted-draft',
    status: 'committed',
  });
  const before = JSON.stringify({ completed, receipt });
  const waiting = {
    conversationId: request.conversationId,
    runId: completed.runId,
    sessionId: 'session',
    workerId: 'idle-worker',
    status: 'waiting_decision',
    runtime: 'dsh-headless-persistent',
  };
  let publicError: string | undefined = 'DSH_TASK_CANCELLED: 停止后续执行，已提交结果保留';
  let nativeStatus = 'idle';
  const cancellations: string[] = [];
  t.mock.method(dshTaskRuntimeService, 'isRunning', () => false);
  t.mock.method(dshTaskRuntimeService, 'listInFlightConversationIds', () => []);
  t.mock.method(dshTaskRuntimeService, 'getStatus', async () => waiting);
  t.mock.method(dshTaskRuntimeService, 'listStatuses', async () => [waiting]);
  t.mock.method(dshTaskRuntimeService, 'cancel', async (id: string) => {
    cancellations.push(id);
    return { ...waiting, status: nativeStatus, error: publicError };
  });
  t.mock.method(taskConversationService, 'updateRun', async () => {
    throw new Error('cancellation wrapper cannot rewrite persisted Run state');
  });
  try {
    assert.equal(await taskSessionAdapter.isRunningAuthoritatively(request.conversationId), false);
    assert.deepEqual(await taskSessionAdapter.listRunningConversationIds(), []);
    assert.equal(
      await taskSessionAdapter.cancel(request.conversationId),
      true,
      'native accepted stopping future work, not rolling back prior commits',
    );
    assert.deepEqual(cancellations, [request.conversationId]);
    assert.equal(JSON.stringify({ completed, receipt }), before);
    assert.equal(completed.status, 'completed');
    assert.equal(receipt.status, 'committed');
    for (const unrecognized of [
      undefined,
      'DSH_TASK_CANCELLED',
      'DSH_TASK_CANCELLED_OTHER: not the acknowledgement',
      'other error: DSH_TASK_CANCELLED: not a prefix',
    ]) {
      publicError = unrecognized;
      assert.equal(await taskSessionAdapter.cancel(request.conversationId), false);
    }
    publicError = 'DSH_TASK_CANCELLED: 停止后续执行，已提交结果保留';
    nativeStatus = 'failed';
    assert.equal(
      await taskSessionAdapter.cancel(request.conversationId),
      false,
      'a failure is not acknowledgement merely because its text mentions cancellation',
    );
    assert.equal(JSON.stringify({ completed, receipt }), before);
  } finally {
    restore();
  }
});
