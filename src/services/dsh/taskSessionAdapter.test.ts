import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ModelToolCallingAttestation,
  TaskModelSnapshot,
  TaskRun,
  TaskConversationBundle,
} from '../../types/conversation';
import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import { taskConversationService } from '../conversation/taskConversationService';
import { taskRuntimeAdapter, type TaskRuntimeInput } from '../conversation/taskRuntimeAdapter';
import { WRITING_SUBAGENT_FLAG_KEY } from '../agents/writingSubAgentContract';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { volumeRepository } from '../database/volumeRepository';
import { chapterEngineeringService } from '../engineering/chapterEngineeringService';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { taskRetryRecovery } from './taskRetryRecovery';
import {
  captureLocalConversationalSnapshot,
  isActiveDshTaskRuntimeStatus,
  taskSessionAdapter,
  WORKBENCH_CONVERSATIONAL_REPLY,
} from './taskSessionAdapter';
import {
  CREATIVE_DIALOGUE_ALLOWED_TOOLS,
  dshTaskRuntimeService,
  type DshTaskRuntimeInput,
  type DshTaskRuntimeResult,
} from './taskRuntimeService';

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
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-local-help',
      novelId: 'novel-1',
      turnId: 'turn-words',
      goal: '本任务目标字数设为3200字',
      modelSnapshot: selectedModel,
    });
    assert.match(assistantReply, /本任务每章目标字数设为 3200 字/u);
    assert.match(assistantReply, /2560～3680 字/u);
    assert.match(assistantReply, /未调用模型、未生成或采用正文/u);
    assert.equal(capturedModel?.providerId, 'ans-local');
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

function mockTauriWindow(): PropertyDescriptor | undefined {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  chapterEngineeringService.getBundle = async () => ({
    activeState: undefined,
    latestDraft: undefined,
    states: [],
    hasUnappliedDraft: false,
  });
  return originalWindow;
}

function restoreWindow(originalWindow: PropertyDescriptor | undefined): void {
  chapterEngineeringService.getBundle = originalEngineeringGetBundle;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
}

const originalEngineeringGetBundle = chapterEngineeringService.getBundle;

const readModelSnapshot: TaskModelSnapshot = {
  providerId: 'deepseek-official',
  modelId: 'deepseek-chat',
  runtimeMode: 'api',
  capabilities: ['conversation_turn', 'tool_calling'],
  options: {},
  capturedAt: '2026-08-28T00:00:00.000Z',
};

test('ambiguous instructions and greetings reach the real model for conversation without candidate dispatch', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const captured: DshTaskRuntimeInput[] = [];
  dshTaskRuntimeService.start = async (input) => {
    captured.push(input);
    return fakeDshStartResult(input, input.conversationId);
  };
  try {
    for (const goal of [
      '你好',
      '不要生成下一章',
      '生成还是检查本章，你决定',
      '先和我聊聊人物背景，不要生成大纲',
    ]) {
      const run = await taskSessionAdapter.startTurn({
        conversationId: 'clarify',
        novelId: 'novel-1',
        turnId: 'turn-clarify',
        goal,
        chapterId: 'chapter-1',
        modelSnapshot: readModelSnapshot,
      });
      assert.equal(run.status, 'completed');
    }
    assert.equal(captured.length, 4);
    assert.ok(captured.every((input) => input.taskKind === 'creative_dialogue'));
    assert.ok(captured.every((input) => input.expectedTool === undefined));
    assert.ok(captured.every((input) => input.modelSnapshot === readModelSnapshot));
  } finally {
    restoreWindow(originalWindow);
    dshTaskRuntimeService.start = originalStart;
  }
});

test('desktop asset revision verifies the old source before routing chapter details to its candidate tool', async (t) => {
  const originalWindow = mockTauriWindow();
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
  const requested: string[] = [];
  const captured: DshTaskRuntimeInput[] = [];
  t.mock.method(taskConversationService, 'get', async () => bundle);
  t.mock.method(aiTaskRuntimeService, 'getArtifact', async (id: string) => {
    requested.push(id);
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
    captured.push(input);
    return fakeDshStartResult(input, source.conversationId);
  });
  const goal = '请修订所选全书规划候选。第2章写深秋，写深秋的落叶，不生成正文。';
  const input = {
    conversationId: source.conversationId,
    novelId: source.novelId,
    turnId: 'revision-turn',
    goal,
    modelSnapshot: readModelSnapshot,
    revisionSource: source,
  };
  try {
    await taskSessionAdapter.startTurn(input);
    assert.deepEqual(requested, ['old-artifact']);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].expectedTool, 'generate_outline');
    assert.equal(captured[0].expectedArtifactType, 'outline');
    assert.equal(captured[0].chapterId, undefined);
    assert.equal(captured[0].goal, goal);
    assert.deepEqual(captured[0].revisionSource, source);
    await assert.rejects(
      taskSessionAdapter.startTurn({ ...input, goal: '修订所选大纲，同时生成第2章正文' }),
      { code: 'WORKBENCH_GOAL_CLARIFICATION_REQUIRED' },
    );
    await assert.rejects(
      taskSessionAdapter.startTurn({
        ...input,
        revisionSource: { ...source, artifactHash: '0'.repeat(64) },
      }),
      /修订来源已失效/,
    );
    assert.equal(captured.length, 1);
  } finally {
    taskSessionAdapter.clear(source.conversationId);
    restoreWindow(originalWindow);
  }
});

const modelToolAttestation: ModelToolCallingAttestation = {
  protocol: 'ans_model_tool_attestation_v1',
  provider: 'deepseek-official',
  model: 'deepseek-chat',
  verified: true,
  cached: false,
  verifiedAt: '2026-08-28T00:00:00.000Z',
  expiresAt: '2026-08-28T00:10:00.000Z',
  cacheTtlMs: 600_000,
  finishKind: 'tool-calls',
  observedToolCalls: 1,
};

const CLEAN_CHAPTER = '沈砚把信折好，雨声停在屋檐外。';

function installHostGate(
  draftText: (input: DshTaskRuntimeInput, draftIndex: number) => string,
): DshTaskRuntimeInput[] {
  const calls: DshTaskRuntimeInput[] = [];
  let drafts = 0;
  dshTaskRuntimeService.start = async (input) => {
    calls.push(input);
    const base = fakeDshStartResult(input, input.conversationId);
    if (input.chapterHostGate?.phase === 'admit') {
      return {
        ...base,
        artifactId: 'artifact-chapter-1',
        run: {
          ...base.run,
          runId: input.chapterHostGate.sourceRunId ?? 'run-admitted',
          status: 'completed',
        },
      };
    }
    drafts += 1;
    const text = draftText(input, drafts);
    return {
      ...base,
      pendingChapterCandidate: {
        runId: `run-draft-${drafts}`,
        contentHash: await computeContentSha256(text),
        text,
        wordCount: text.length,
      },
      run: {
        ...base.run,
        runId: `run-draft-${drafts}`,
        status: 'running',
        error: 'DSH_CHAPTER_CANDIDATE_WITHHELD: 候选已通过字数门禁但尚未准入',
      },
    };
  };
  return calls;
}

function fakeDshStartResult(
  input: DshTaskRuntimeInput,
  conversationId: string,
): DshTaskRuntimeResult {
  return {
    run: {
      runId: 'run-dsh-read',
      conversationId,
      turnId: input.turnId,
      status: 'completed',
      modelSnapshot: input.modelSnapshot,
      workerId: 'worker-dsh',
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:01.000Z',
    },
    sessionId: 'session-dsh',
    agentId: 'agent-dsh',
    workerId: 'worker-dsh',
    runtime: 'dsh-headless-persistent',
    modelToolAttestation,
  };
}

test('desktop dialogue lets the model choose optional reads and an explicit workflow tool', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const captured: DshTaskRuntimeInput[] = [];
  dshTaskRuntimeService.start = async (input) => {
    captured.push(input);
    return fakeDshStartResult(input, input.conversationId);
  };
  try {
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-read-canonical',
      novelId: 'novel-1',
      turnId: 'turn-read',
      goal: '读取当前世界设定',
      chapterId: 'ch-1',
      modelSnapshot: readModelSnapshot,
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].taskKind, 'creative_dialogue');
    assert.deepEqual(captured[0].allowedTools, CREATIVE_DIALOGUE_ALLOWED_TOOLS);
    assert.deepEqual(captured[0].requiredReadTools, []);
    assert.equal(captured[0].expectedTool, undefined);
  } finally {
    taskSessionAdapter.clear('conversation-read-canonical');
    dshTaskRuntimeService.start = originalStart;
    restoreWindow(originalWindow);
  }
});

function mockFlagStorage(value: string | null): PropertyDescriptor | undefined {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => (key === WRITING_SUBAGENT_FLAG_KEY ? value : null) },
  });
  return original;
}

function restoreFlagStorage(original: PropertyDescriptor | undefined): void {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

test('chapter_write keeps the deterministic writer for mock models and for an explicit opt-out', async () => {
  const originalWindow = mockTauriWindow();
  const originalDshStart = dshTaskRuntimeService.start;
  const originalWriterStart = taskRuntimeAdapter.start;
  let dshCalls = 0;
  const writerCalls: TaskRuntimeInput[] = [];
  dshTaskRuntimeService.start = async () => {
    dshCalls += 1;
    throw new Error('DSH must not be used for chapter_write on this path');
  };
  taskRuntimeAdapter.start = async (input) => {
    writerCalls.push(input);
    return { runId: 'run-writer', status: 'completed' } as unknown as TaskRun;
  };
  const mockModel: TaskModelSnapshot = {
    ...readModelSnapshot,
    providerId: 'mock',
    modelId: 'Mock',
    runtimeMode: 'mock',
    baseUrl: undefined,
  };
  let originalStorage = mockFlagStorage(null);
  try {
    // Default flag + mock model snapshot: the DSH runtime only accepts API models.
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-writer',
      novelId: 'novel-1',
      turnId: 'turn-chapter',
      goal: '写第一章正文',
      chapterId: 'ch-1',
      modelSnapshot: mockModel,
    });
    assert.equal(dshCalls, 0);
    assert.equal(writerCalls.length, 1);
    assert.equal(writerCalls[0].workerId, 'worker-conversation-chapter-writer');

    // Explicit opt-out keeps the writer even for a real API model.
    restoreFlagStorage(originalStorage);
    originalStorage = mockFlagStorage('0');
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-writer',
      novelId: 'novel-1',
      turnId: 'turn-chapter-2',
      goal: '写第一章正文',
      chapterId: 'ch-1',
      modelSnapshot: readModelSnapshot,
      workflowAction: 'generate_chapter' as const,
    });
    assert.equal(dshCalls, 0);
    assert.equal(writerCalls.length, 2);
  } finally {
    taskSessionAdapter.clear('conversation-chapter-writer');
    dshTaskRuntimeService.start = originalDshStart;
    taskRuntimeAdapter.start = originalWriterStart;
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('desktop chapter_write with an API model starts a candidate-only DSH turn by default with the narrowed writing allowlist', async (t) => {
  t.mock.method(chapterRepository, 'getById', async () => ({
    id: 'ch-1',
    novelId: 'novel-1',
    targetWordCount: 3000,
  }));
  t.mock.method(chapterRepository, 'getByNovelId', async () => [
    { id: 'ch-1', novelId: 'novel-1' },
  ]);
  t.mock.method(volumeRepository, 'getByNovelId', async () => []);
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns: [],
  }));
  t.mock.method(taskConversationService, 'appendTurn', async () => ({ turnId: 'review' }));
  const originalWindow = mockTauriWindow();
  // No flag set: v3.7.0 opens the SubAgent for real API models.
  const originalStorage = mockFlagStorage(null);
  const originalDshStart = dshTaskRuntimeService.start;
  const originalWriterStart = taskRuntimeAdapter.start;
  const captured = installHostGate(() => CLEAN_CHAPTER);
  taskRuntimeAdapter.start = async () => {
    throw new Error('the deterministic writer must not run for a desktop API-model chapter_write');
  };
  try {
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-subagent',
      novelId: 'novel-1',
      turnId: 'turn-chapter-subagent',
      goal: '写第一章正文',
      chapterId: 'ch-1',
      modelSnapshot: readModelSnapshot,
      workflowAction: 'generate_chapter' as const,
    });
    assert.equal(captured.length, 2);
    assert.equal(captured[0].chapterHostGate?.phase, 'draft');
    assert.equal(captured[0].chapterHostGate?.explicitRetry, undefined);
    assert.equal(captured[0].chapterHostGate?.continuesRunId, undefined);
    assert.equal(captured[1].chapterHostGate?.phase, 'admit');
    assert.equal(captured[0].continuityClaim, undefined);
    captured.length = 0;
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-subagent',
      novelId: 'novel-1',
      turnId: 'turn-chapter-subagent',
      goal: '写第一章正文',
      chapterId: 'ch-1',
      modelSnapshot: readModelSnapshot,
      workflowAction: 'generate_chapter' as const,
      explicitChapterRetry: true,
    });
    assert.equal(captured[0].chapterHostGate?.explicitRetry, true);
    assert.equal(captured[0].chapterHostGate?.continuesRunId, undefined);
    assert.equal(captured[0].taskKind, 'chapter_write');
    assert.equal(captured[0].expectedTool, 'generate_chapter');
    assert.equal(captured[0].expectedArtifactType, 'chapter_text');
    assert.deepEqual(captured[0].requiredReadTools, [
      'novel.read_context',
      'chapter.read_outline',
      'get_character_states',
      'search_memory',
    ]);
    assert.deepEqual(
      [...captured[0].allowedTools!],
      [
        'novel.read_context',
        'chapter.read_outline',
        'get_character_states',
        'search_memory',
        'generate_chapter',
      ],
    );
    assert.equal(
      captured[0].allowedTools?.some((tool) =>
        ['generate_outline', 'expand_settings', 'polish_chapter', 'summarize_chapter'].includes(
          tool,
        ),
      ),
      false,
    );

    let retryTaskKind: 'chapter_write' | 'chapter_polish' = 'chapter_write';
    t.mock.method(taskRetryRecovery, 'resolve', async () => ({
      sourceRunId: 'failed-original',
      turnId: 'turn-chapter-subagent',
      chapterId: 'ch-1',
      modelSnapshot: readModelSnapshot,
      execution: {
        taskKind: retryTaskKind,
        expectedTool: retryTaskKind === 'chapter_polish' ? 'polish_chapter' : 'generate_chapter',
        expectedArtifactType: 'chapter_text',
        requiredReadTools: [
          'novel.read_context',
          'chapter.read_outline',
          'get_character_states',
          'search_memory',
        ],
        goal: '生成本章正文\n冻结的原始规划指令',
        chapterWordRange: { target: 3400, minimum: 3060, maximum: 3740 },
      },
    }));
    captured.length = 0;
    // An opt-out chosen after the failure applies to new tasks, not this frozen DSH retry.
    mockFlagStorage('0');
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-subagent',
      novelId: 'novel-1',
      turnId: 'turn-chapter-subagent',
      chapterId: 'ch-1',
      goal: '当前选择和措辞不应重新规划',
      modelSnapshot: { ...readModelSnapshot, modelId: 'changed' },
      retrySourceRunId: 'failed-original',
      explicitChapterRetry: true,
    });
    assert.deepEqual(
      captured.map((call) => call.taskKind),
      ['chapter_write', 'chapter_write'],
    );
    assert.equal(captured[0].goal, '生成本章正文\n冻结的原始规划指令');
    assert.equal(captured[0].modelSnapshot.modelId, readModelSnapshot.modelId);
    assert.deepEqual(captured[0].chapterWordRange, { target: 3400, minimum: 3060, maximum: 3740 });
    assert.equal(captured[0].retrySourceRunId, 'failed-original');
    assert.equal(captured[0].chapterHostGate?.explicitRetry, true);
    assert.deepEqual(captured[0].allowedTools, [
      'novel.read_context',
      'chapter.read_outline',
      'get_character_states',
      'search_memory',
      'generate_chapter',
    ]);
    assert.equal(
      captured[1].retrySourceRunId,
      undefined,
      'admission binds the new draft, not a stale retry source',
    );

    retryTaskKind = 'chapter_polish';
    captured.length = 0;
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-subagent',
      novelId: 'novel-1',
      turnId: 'turn-chapter-subagent',
      chapterId: 'ch-1',
      goal: '当前措辞仍不能改写旧润色阶段',
      retrySourceRunId: 'failed-original',
      explicitChapterRetry: true,
    });
    assert.equal(captured.length, 2);
    assert.ok(captured.every((call) => call.taskKind === 'chapter_polish'));
    assert.deepEqual(captured[0].chapterWordRange, { target: 3400, minimum: 3060, maximum: 3740 });
    assert.equal(captured[0].modelSnapshot.modelId, readModelSnapshot.modelId);
    assert.deepEqual(captured[0].allowedTools, [
      'novel.read_context',
      'chapter.read_outline',
      'get_character_states',
      'search_memory',
      'polish_chapter',
    ]);
    assert.equal(captured[0].chapterHostGate?.explicitRetry, true);

    // Without a bound chapter the flag is irrelevant: the writer path stays authoritative.
    let writerFallback = 0;
    taskRuntimeAdapter.start = async () => {
      writerFallback += 1;
      return { runId: 'run-writer', status: 'completed' } as unknown as TaskRun;
    };
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-unbound',
      novelId: 'novel-1',
      turnId: 'turn-chapter-unbound',
      goal: '写第一章正文',
      modelSnapshot: readModelSnapshot,
      workflowAction: 'generate_chapter' as const,
    });
    assert.equal(captured.length, 2);
    assert.equal(writerFallback, 1);
  } finally {
    taskSessionAdapter.clear('conversation-chapter-subagent');
    taskSessionAdapter.clear('conversation-chapter-unbound');
    dshTaskRuntimeService.start = originalDshStart;
    taskRuntimeAdapter.start = originalWriterStart;
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('chapter_write withholds an integrity error and admits only the repaired candidate', async (t) => {
  t.mock.method(chapterRepository, 'getById', async () => ({
    id: 'ch-1',
    novelId: 'novel-1',
    targetWordCount: 3000,
  }));
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns: [],
  }));
  const originalWindow = mockTauriWindow();
  const originalStorage = mockFlagStorage('1');
  const originalDshStart = dshTaskRuntimeService.start;
  const originalGetArtifact = aiTaskRuntimeService.getArtifact;
  const originalAppendTurn = taskConversationService.appendTurn;
  const originalChapters = chapterRepository.getByNovelId;
  const originalVolumes = volumeRepository.getByNovelId;
  const appended: Array<{ role: string; content: string }> = [];
  const calls = installHostGate((_input, index) =>
    index === 1 ? '沈砚推开档案馆的门，灰尘在光柱里翻滚。她转身离开。（未完待续）' : CLEAN_CHAPTER,
  );
  aiTaskRuntimeService.getArtifact = async (artifactId) =>
    ({
      artifact: {
        artifactId,
        artifactType: 'chapter_text',
        sourceNovelId: 'novel-1',
        sourceChapterId: 'ch-1',
        contentHash: await computeContentSha256(CLEAN_CHAPTER),
      },
      rawContent: CLEAN_CHAPTER,
      issues: [],
    }) as unknown as Awaited<ReturnType<typeof aiTaskRuntimeService.getArtifact>>;
  taskConversationService.appendTurn = (async (
    _conversationId: string,
    role: string,
    content: string,
  ) => {
    appended.push({ role, content });
    return { turnId: 'turn-review', role, content } as unknown as Awaited<
      ReturnType<typeof taskConversationService.appendTurn>
    >;
  }) as typeof taskConversationService.appendTurn;
  chapterRepository.getByNovelId = async () =>
    [{ id: 'ch-1', novelId: 'novel-1' }] as Awaited<
      ReturnType<typeof chapterRepository.getByNovelId>
    >;
  volumeRepository.getByNovelId = async () => [];
  try {
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-chapter-integrity',
      novelId: 'novel-1',
      turnId: 'turn-chapter-integrity',
      goal: '写第一章正文',
      chapterId: 'ch-1',
      modelSnapshot: readModelSnapshot,
      workflowAction: 'generate_chapter' as const,
    });
    assert.equal(calls.filter((call) => call.chapterHostGate?.phase === 'admit').length, 1);
    assert.deepEqual(calls[1].chapterHostGate?.issueCodes, ['chapter_tail_pollution']);
    assert.equal(calls[1].chapterHostGate?.phase, 'draft');
    assert.equal(calls[0].chapterHostGate?.explicitRetry, undefined);
    assert.equal(calls[1].chapterHostGate?.continuesRunId, 'run-draft-1');
    assert.equal(calls[1].chapterHostGate?.explicitRetry, undefined);
    assert.equal(calls[2].chapterHostGate?.sourceRunId, 'run-draft-2');
    assert.equal(calls[2].chapterHostGate?.contentHash, await computeContentSha256(CLEAN_CHAPTER));
    assert.equal(appended.length, 1);
    assert.equal(appended[0].role, 'assistant');
    assert.match(appended[0].content, /全规则语义检查未执行/u);
    assert.doesNotMatch(appended[0].content, /chapter_tail_pollution/u);
  } finally {
    taskSessionAdapter.clear('conversation-chapter-integrity');
    dshTaskRuntimeService.start = originalDshStart;
    aiTaskRuntimeService.getArtifact = originalGetArtifact;
    taskConversationService.appendTurn = originalAppendTurn;
    chapterRepository.getByNovelId = originalChapters;
    volumeRepository.getByNovelId = originalVolumes;
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('DSH candidate warnings and failed integrity reads remain visible without rewriting the candidate', async (t) => {
  const originalWindow = mockTauriWindow();
  const originalStorage = mockFlagStorage('1');
  const candidateText = '火灾发生在凌晨，嫌疑人的死亡时间则被记录为23:20。';
  const appended: string[] = [];
  const chapter = { id: 'ch-1', novelId: 'novel-1', targetWordCount: 3000 };
  t.mock.method(chapterRepository, 'getById', async () => chapter);
  t.mock.method(chapterRepository, 'getByNovelId', async () => {
    throw new Error('read failure');
  });
  t.mock.method(volumeRepository, 'getByNovelId', async () => []);
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns: [],
  }));
  let generationCalls = 0;
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    generationCalls += 1;
    const base = fakeDshStartResult(input, input.conversationId);
    if (input.chapterHostGate?.phase === 'admit') {
      assert.deepEqual(input.chapterHostGate.issueSeverities, ['warning']);
      return { ...base, artifactId: 'artifact-warning', run: { ...base.run, status: 'completed' } };
    }
    return {
      ...base,
      pendingChapterCandidate: {
        runId: 'run-warning',
        contentHash: await computeContentSha256(candidateText),
        text: candidateText,
        wordCount: candidateText.length,
      },
      run: {
        ...base.run,
        runId: 'run-warning',
        status: 'running',
        error: 'DSH_CHAPTER_CANDIDATE_WITHHELD: withheld',
      },
    };
  });
  t.mock.method(aiTaskRuntimeService, 'getArtifact', async () => ({
    artifact: {
      artifactId: 'artifact-warning',
      artifactType: 'chapter_text',
      sourceNovelId: 'novel-1',
      sourceChapterId: 'ch-1',
      contentHash: await computeContentSha256(candidateText),
    },
    rawContent: candidateText,
    issues: [],
  }));
  t.mock.method(
    taskConversationService,
    'appendTurn',
    async (_conversationId: string, role: string, content: string) => {
      assert.equal(role, 'assistant');
      appended.push(content);
      return { turnId: 'review', content };
    },
  );
  const input = {
    conversationId: 'warning-conversation',
    novelId: 'novel-1',
    chapterId: 'ch-1',
    turnId: 'turn',
    goal: '写本章正文',
    modelSnapshot: readModelSnapshot,
    workflowAction: 'generate_chapter' as const,
  };
  try {
    await assert.rejects(taskSessionAdapter.startTurn(input), /read failure/u);
    assert.equal(generationCalls, 0);
    t.mock.method(chapterRepository, 'getByNovelId', async () => [chapter]);
    await taskSessionAdapter.startTurn(input);
    assert.equal(generationCalls, 2);
    assert.equal(appended.length, 1);
    assert.match(appended[0], /warning.*chapter_temporal_semantics_conflict/u);
    assert.match(appended[0], /首章无前章/u);
    assert.match(appended[0], /全规则语义检查未执行/u);
    assert.match(appended[0], /不触发自动重写/u);
    t.mock.method(aiTaskRuntimeService, 'getArtifact', async () => {
      throw new Error('cannot read candidate');
    });
    await taskSessionAdapter.startTurn(input);
    assert.equal(appended.length, 2);
    assert.match(appended[1], /完整性复核未检查/u);
    assert.match(appended[1], /候选读取、作用域或哈希复核未完成/u);
    assert.match(appended[1], /候选已保留供审阅/u);
    assert.equal(generationCalls, 4);
  } finally {
    taskSessionAdapter.clear(input.conversationId);
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('DSH writing uses durable task word targets and latest per-turn overrides without editing chapter data', async (t) => {
  const originalWindow = mockTauriWindow();
  const originalStorage = mockFlagStorage(null);
  const chapter = { id: 'ch-1', novelId: 'novel-1', targetWordCount: 1000, wordCount: 0 };
  t.mock.method(chapterRepository, 'getById', async () => chapter);
  t.mock.method(chapterRepository, 'getByNovelId', async () => [chapter]);
  t.mock.method(volumeRepository, 'getByNovelId', async () => []);
  const turns = [
    { turnId: 'words', sequence: 1, role: 'user', content: '本任务目标字数设为3200字' },
    { turnId: 'generate', sequence: 2, role: 'user', content: '生成下一章' },
  ];
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns,
  }));
  t.mock.method(taskConversationService, 'appendTurn', async () => ({ turnId: 'review' }));
  const inputs: DshTaskRuntimeInput[] = [];
  t.mock.method(dshTaskRuntimeService, 'start', async (input: DshTaskRuntimeInput) => {
    inputs.push(input);
    const base = fakeDshStartResult(input, input.conversationId);
    if (input.chapterHostGate?.phase === 'admit') {
      return { ...base, artifactId: 'artifact-words', run: { ...base.run, status: 'completed' } };
    }
    return {
      ...base,
      pendingChapterCandidate: {
        runId: `run-${inputs.length}`,
        contentHash: await computeContentSha256(CLEAN_CHAPTER),
        text: CLEAN_CHAPTER,
        wordCount: CLEAN_CHAPTER.length,
      },
      run: { ...base.run, status: 'running', error: 'DSH_CHAPTER_CANDIDATE_WITHHELD: withheld' },
    };
  });
  try {
    const input = {
      conversationId: 'conversation-target-words',
      novelId: 'novel-1',
      chapterId: 'ch-1',
      turnId: 'generate',
      goal: '生成下一章',
      modelSnapshot: readModelSnapshot,
      workflowAction: 'generate_chapter' as const,
    };
    await taskSessionAdapter.startTurn({ ...input, goal: '生成下一章，目标9000字' });
    assert.deepEqual(inputs[0].chapterWordRange, { target: 3200, minimum: 2560, maximum: 3680 });
    turns.push({
      turnId: 'override',
      sequence: 3,
      role: 'user',
      content: '生成下一章，目标3500字',
    });
    await taskSessionAdapter.startTurn({
      ...input,
      turnId: 'override',
      goal: '生成本章正文\n模型规划遗漏了目标字数',
    });
    const drafts = inputs.filter((item) => item.chapterHostGate?.phase === 'draft');
    assert.deepEqual(drafts[1].chapterWordRange, { target: 3500, minimum: 2800, maximum: 4025 });
    assert.equal(inputs[0].modelSnapshot, readModelSnapshot);
    assert.equal(chapter.targetWordCount, 1000);
    assert.equal(chapter.wordCount, 0);
    t.mock.method(chapterRepository, 'getById', async () => {
      throw new Error('chapter read failed');
    });
    await assert.rejects(taskSessionAdapter.startTurn(input), /chapter read failed/u);
    assert.equal(drafts.length, 2);
  } finally {
    taskSessionAdapter.clear('conversation-target-words');
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('an unadopted previous chapter fails closed before DSH and creates no candidate', async (t) => {
  const originalWindow = mockTauriWindow();
  const originalStorage = mockFlagStorage(null);
  t.mock.method(chapterRepository, 'getById', async () => ({
    id: 'ch-2',
    novelId: 'novel-1',
    volumeId: 'v1',
  }));
  t.mock.method(chapterRepository, 'getByNovelId', async () => [
    { id: 'ch-1', novelId: 'novel-1', volumeId: 'v1', orderIndex: 1, sortOrder: 1, createdAt: '1' },
    { id: 'ch-2', novelId: 'novel-1', volumeId: 'v1', orderIndex: 2, sortOrder: 2, createdAt: '2' },
  ]);
  t.mock.method(volumeRepository, 'getByNovelId', async () => [
    { id: 'v1', novelId: 'novel-1', orderIndex: 1, sortOrder: 1 },
  ]);
  t.mock.method(draftVersionService, 'getAdoptedByChapterId', async () => null);
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns: [],
  }));
  let calls = 0;
  t.mock.method(dshTaskRuntimeService, 'start', async () => {
    calls += 1;
    throw new Error('DSH must not start');
  });
  try {
    await assert.rejects(
      taskSessionAdapter.startTurn({
        conversationId: 'conversation-previous-missing',
        novelId: 'novel-1',
        chapterId: 'ch-2',
        turnId: 'turn',
        goal: '写下一章',
        modelSnapshot: readModelSnapshot,
        workflowAction: 'generate_chapter' as const,
      }),
      /尚未采用/u,
    );
    assert.equal(calls, 0);
  } finally {
    taskSessionAdapter.clear('conversation-previous-missing');
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('cancel and exhausted candidate budget never admit a chapter', async (t) => {
  const originalWindow = mockTauriWindow();
  const originalStorage = mockFlagStorage(null);
  t.mock.method(chapterRepository, 'getById', async () => ({ id: 'ch-1', novelId: 'novel-1' }));
  t.mock.method(chapterRepository, 'getByNovelId', async () => [
    { id: 'ch-1', novelId: 'novel-1' },
  ]);
  t.mock.method(volumeRepository, 'getByNovelId', async () => []);
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns: [],
  }));
  const input = {
    conversationId: 'conversation-stop',
    novelId: 'novel-1',
    chapterId: 'ch-1',
    turnId: 'turn',
    goal: '写本章正文',
    modelSnapshot: readModelSnapshot,
    workflowAction: 'generate_chapter' as const,
  };
  try {
    t.mock.method(dshTaskRuntimeService, 'start', async () => {
      throw new Error('DSH_CHAPTER_CANCELLED: 任务已取消');
    });
    await assert.rejects(taskSessionAdapter.startTurn(input), /DSH_CHAPTER_CANCELLED/u);
    let drafts = 0;
    t.mock.method(dshTaskRuntimeService, 'start', async (call: DshTaskRuntimeInput) => {
      if (call.chapterHostGate?.phase === 'admit') throw new Error('admit must not run');
      drafts += 1;
      if (drafts > 1)
        throw new Error('DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED: 章节候选调用总数不得超过 3 次');
      const text = '沈砚离开。（未完待续）';
      const base = fakeDshStartResult(call, call.conversationId);
      return {
        ...base,
        pendingChapterCandidate: {
          runId: 'run-bad',
          contentHash: await computeContentSha256(text),
          text,
          wordCount: text.length,
        },
        run: {
          ...base.run,
          status: 'running' as const,
          error: 'DSH_CHAPTER_CANDIDATE_WITHHELD: withheld',
        },
      };
    });
    await assert.rejects(
      taskSessionAdapter.startTurn(input),
      /DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED/u,
    );
    assert.equal(drafts, 2);
  } finally {
    taskSessionAdapter.clear(input.conversationId);
    restoreFlagStorage(originalStorage);
    restoreWindow(originalWindow);
  }
});

test('only a successful model action starts the governed workflow, regardless of instruction keywords', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const captured: DshTaskRuntimeInput[] = [];
  let prepared = 0;
  dshTaskRuntimeService.start = async (input) => {
    captured.push(input);
    return {
      ...fakeDshStartResult(input, input.conversationId),
      ...(input.taskKind === 'creative_dialogue'
        ? {
            plannedAction: {
              action: 'prepare_settings' as const,
              instruction: '主角是修复师；以后再生成大纲和章节。',
            },
          }
        : {}),
    };
  };
  try {
    await taskSessionAdapter.startTurn({
      conversationId: 'conversation-structured-legacy',
      novelId: 'novel-1',
      turnId: 'turn-structured',
      goal: '我们先谈谈这个故事',
      modelSnapshot: readModelSnapshot,
      preparePlannedAction: async (action) => {
        prepared++;
        assert.equal(action.action, 'prepare_settings');
        return {};
      },
    });
    assert.equal(prepared, 1);
    assert.equal(captured.length, 2);
    assert.equal(captured[0].taskKind, 'creative_dialogue');
    assert.equal(captured[1].taskKind, 'setting_expand');
    assert.equal(captured[1].expectedTool, 'expand_settings');
    assert.equal(captured[1].expectedArtifactType, 'setting_candidates');
    assert.match(captured[1].goal, /主角是修复师/);
    assert.equal('preparePlannedAction' in captured[0], false);
    assert.equal('preparePlannedAction' in captured[1], false);
  } finally {
    taskSessionAdapter.clear('conversation-structured-legacy');
    dshTaskRuntimeService.start = originalStart;
    restoreWindow(originalWindow);
  }
});

test('missing-asset preparation can suspend work after dialogue, and a failed conversation never dispatches work', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  let calls = 0;
  let fail = false;
  let preparations = 0;
  dshTaskRuntimeService.start = async (input) => {
    calls++;
    const result = fakeDshStartResult(input, input.conversationId);
    return {
      ...result,
      run: { ...result.run, status: fail ? 'failed' : 'completed' },
      plannedAction: {
        action: 'generate_chapter',
        instruction: '生成已经讨论的第一章。',
        chapterId: 'ch-1',
      },
    };
  };
  try {
    const input: TaskRuntimeInput = {
      conversationId: 'gate-after-dialogue',
      novelId: 'novel-1',
      turnId: 'turn',
      goal: '可以开始了吗',
      modelSnapshot: readModelSnapshot,
      preparePlannedAction: async () => {
        preparations++;
        return null;
      },
    };
    await taskSessionAdapter.startTurn(input);
    assert.equal(calls, 1);
    assert.equal(preparations, 1);
    fail = true;
    assert.equal((await taskSessionAdapter.startTurn(input)).status, 'failed');
    assert.equal(calls, 2);
    assert.equal(preparations, 1);
  } finally {
    restoreWindow(originalWindow);
    dshTaskRuntimeService.start = originalStart;
  }
});

test('cancel between the model reply and asset preparation prevents a later workflow start', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const originalCancel = dshTaskRuntimeService.cancel;
  let calls = 0;
  let release!: (target: { chapterId?: string }) => void;
  const preparing = new Promise<{ chapterId?: string }>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const enteredPreparation = new Promise<void>((resolve) => {
    entered = resolve;
  });
  dshTaskRuntimeService.start = async (input) => {
    calls++;
    return {
      ...fakeDshStartResult(input, input.conversationId),
      plannedAction: { action: 'prepare_settings', instruction: '写入讨论好的背景候选。' },
    };
  };
  dshTaskRuntimeService.cancel = async (conversationId) => ({
    conversationId,
    runId: 'run-chat',
    sessionId: 'session',
    workerId: 'worker',
    status: 'idle',
    runtime: 'dsh-headless-persistent',
  });
  try {
    const pending = taskSessionAdapter.startTurn({
      conversationId: 'cancel-dialogue-chain',
      novelId: 'novel-1',
      turnId: 'turn',
      goal: '确认这个背景',
      modelSnapshot: readModelSnapshot,
      preparePlannedAction: () => {
        entered();
        return preparing;
      },
    });
    await enteredPreparation;
    assert.equal(await taskSessionAdapter.isRunningAuthoritatively('cancel-dialogue-chain'), true);
    assert.equal(await taskSessionAdapter.cancel('cancel-dialogue-chain'), true);
    release({});
    await pending;
    assert.equal(calls, 1);
    assert.equal(taskSessionAdapter.isRunning('cancel-dialogue-chain'), false);
  } finally {
    release({});
    dshTaskRuntimeService.start = originalStart;
    dshTaskRuntimeService.cancel = originalCancel;
    restoreWindow(originalWindow);
  }
});

test('cancel during deferred chapter hydration prevents the selected writing workflow from calling DSH', async (t) => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const originalCancel = dshTaskRuntimeService.cancel;
  let release!: (chapter: { id: string; novelId: string; targetWordCount: number }) => void;
  const hydration = new Promise<{ id: string; novelId: string; targetWordCount: number }>(
    (resolve) => {
      release = resolve;
    },
  );
  let entered!: () => void;
  const hydrationEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  t.mock.method(chapterRepository, 'getById', () => {
    entered();
    return hydration;
  });
  t.mock.method(chapterRepository, 'getByNovelId', async () => [
    { id: 'ch-1', novelId: 'novel-1' },
  ]);
  t.mock.method(volumeRepository, 'getByNovelId', async () => []);
  t.mock.method(taskConversationService, 'get', async () => ({
    conversation: { novelId: 'novel-1' },
    turns: [],
  }));
  let calls = 0;
  dshTaskRuntimeService.start = async (input) => {
    calls++;
    return {
      ...fakeDshStartResult(input, input.conversationId),
      plannedAction: {
        action: 'generate_chapter',
        chapterId: 'ch-1',
        instruction: '生成已确认的开篇。',
      },
    };
  };
  dshTaskRuntimeService.cancel = async (conversationId) => ({
    conversationId,
    runId: 'chat',
    sessionId: 'session',
    workerId: 'worker',
    status: 'idle',
    runtime: 'dsh-headless-persistent',
  });
  try {
    const pending = taskSessionAdapter.startTurn({
      conversationId: 'cancel-during-hydration',
      novelId: 'novel-1',
      turnId: 'turn',
      goal: '开始第一章吧',
      modelSnapshot: readModelSnapshot,
    });
    await hydrationEntered;
    assert.equal(await taskSessionAdapter.cancel('cancel-during-hydration'), true);
    release({ id: 'ch-1', novelId: 'novel-1', targetWordCount: 3000 });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, 1);
    assert.equal(taskSessionAdapter.isRunning('cancel-during-hydration'), false);
  } finally {
    release({ id: 'ch-1', novelId: 'novel-1', targetWordCount: 3000 });
    dshTaskRuntimeService.start = originalStart;
    dshTaskRuntimeService.cancel = originalCancel;
    restoreWindow(originalWindow);
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
