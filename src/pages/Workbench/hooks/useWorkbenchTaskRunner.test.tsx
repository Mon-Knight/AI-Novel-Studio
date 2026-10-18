import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  ArtifactDecision,
  ConversationArtifactCard,
  ReviewAuthorization,
  TaskConversationBundle,
  TaskModelSnapshot,
  TaskRun,
} from '../../../types/conversation';
import type { ResultArtifactBundle } from '../../../types/result-artifact';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { useRef, useState } = await import('react');
const { act, cleanup, renderHook, waitFor } = await import('@testing-library/react');
const { taskConversationService } =
  await import('../../../services/conversation/taskConversationService');
const { taskConversationWindow } =
  await import('../../../services/conversation/taskConversationWindow');
const { taskSessionAdapter } = await import('../../../services/dsh/taskSessionAdapter');
const { chapterSummaryService } = await import('../../../services/context/chapterSummaryService');
const { buildCoreAssetGenerationGoal, chapterAssetReadinessService, chapterAssetRecoveryStore } =
  await import('../../../services/conversation/chapterAssetReadiness');
const { encodeWorkbenchTurnContent } =
  await import('../../../services/conversation/workbenchTurnOrigin');
const { artifactDecisionService } =
  await import('../../../services/conversation/artifactDecisionService');
const { aiTaskRuntimeService } = await import('../../../services/ai-tasks/aiTaskRuntimeService');
const { draftVersionService } = await import('../../../services/database/draftVersionService');
const { chapterRepository } = await import('../../../services/database/chapterRepository');
const { volumeRepository } = await import('../../../services/database/volumeRepository');
const { computeContentSha256 } = await import('../../../utils/contentIntegrity');
const { useWorkbenchTaskRunner } = await import('./useWorkbenchTaskRunner');
const { useWorkbenchDraftStore } = await import('../../../store/workbenchDraftStore');

const original = {
  getConversation: taskConversationService.get,
  appendTurn: taskConversationService.appendTurn,
  createRun: taskConversationService.createRun,
  updateRun: taskConversationService.updateRun,
  isPersistent: taskConversationService.isPersistent,
  listRunning: taskSessionAdapter.listRunningConversationIds,
  isRunning: taskSessionAdapter.isRunning,
  isRunningAuthoritatively: taskSessionAdapter.isRunningAuthoritatively,
  subscribe: taskSessionAdapter.subscribeToRuntimeProjections,
  startTurn: taskSessionAdapter.startTurn,
  summaries: chapterSummaryService.getByNovelId,
  inspectAssets: chapterAssetReadinessService.inspect,
  applyStructured: artifactDecisionService.applyStructured,
  recordDecision: artifactDecisionService.record,
  adoptDraft: artifactDecisionService.adoptReviewAuthorizedDraft,
  getArtifact: aiTaskRuntimeService.getArtifact,
  createDraft: draftVersionService.create,
  chapters: chapterRepository.getByNovelId,
  volumes: volumeRepository.getByNovelId,
};

const MODEL: TaskModelSnapshot = {
  providerId: 'mock',
  modelId: 'Mock',
  runtimeMode: 'mock',
  capabilities: ['chat'],
  options: {},
  capturedAt: '2026-08-31T00:00:00.000Z',
};

const CHAPTER: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '第一章',
  chapterNumber: 1,
  orderIndex: 0,
  sortOrder: 0,
  status: 'draft_generated',
  wordCount: 0,
  currentWords: 0,
  targetWords: 3000,
  drafts: [],
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

let liveBundle: TaskConversationBundle;
let providerGoals: string[];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function artifact(
  artifactType: ConversationArtifactCard['artifactType'],
  suffix: string,
  evidence: Partial<NonNullable<ConversationArtifactCard['artifactEvidence']>> = {},
): ConversationArtifactCard {
  return {
    cardId: `card-${suffix}`,
    conversationId: 'conversation-1',
    artifactId: `artifact-${suffix}`,
    artifactType,
    title: `${suffix} candidate`,
    summary: `${suffix} summary`,
    status: 'candidate',
    createdAt: '2026-08-31T00:00:01.000Z',
    artifactEvidence: {
      sourceNovelId: 'novel-1',
      processingStatus: 'valid',
      validationIssues: [],
      ...evidence,
    },
  };
}

function decision(
  card: ConversationArtifactCard,
  kind: ArtifactDecision['decision'],
  applyTransactionId?: string,
): ArtifactDecision {
  return {
    decisionId: `decision-${card.cardId}-${kind}`,
    artifactId: card.artifactId!,
    artifactHash: `hash-${card.artifactId}`,
    cardId: card.cardId,
    conversationId: card.conversationId,
    decision: kind,
    idempotencyKey: `${card.cardId}:${kind}`,
    actor: 'user',
    targetType: card.artifactType === 'chapter_text' ? 'chapter' : 'asset',
    targetId: card.artifactEvidence?.sourceChapterId ?? 'novel-1',
    applyTransactionId,
    createdAt: '2026-08-31T00:00:02.000Z',
  };
}

function bundleWith(artifacts: ConversationArtifactCard[]): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      title: '真实短提示创作',
      status: 'idle',
      defaultModel: MODEL,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts,
    decisions: [],
    authorizations: [],
  };
}

function installConversationStore(): void {
  taskConversationService.get = async (conversationId) =>
    conversationId === liveBundle.conversation.conversationId ? liveBundle : null;
  taskConversationService.appendTurn = async (conversationId, role, content, revisionSource) => {
    const turn = {
      turnId: `turn-${liveBundle.turns.length + 1}`,
      conversationId,
      sequence: liveBundle.turns.length,
      role,
      content,
      ...(revisionSource ? { revisionSource } : {}),
      createdAt: new Date().toISOString(),
    };
    liveBundle.turns.push(turn);
    return turn;
  };
  taskConversationService.createRun = async (
    conversationId,
    turnId,
    modelSnapshot,
    workerId,
    chapterId,
  ) => {
    const run: TaskRun = {
      runId: `run-${liveBundle.runs.length + 1}`,
      conversationId,
      turnId,
      chapterId,
      status: 'queued',
      modelSnapshot,
      workerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    liveBundle.runs.push(run);
    return run;
  };
  taskConversationService.updateRun = async (runId, status, patch = {}) => {
    const run = liveBundle.runs.find((candidate) => candidate.runId === runId);
    if (!run) throw new Error('missing test run');
    Object.assign(run, patch, { status, updatedAt: new Date().toISOString() });
    return run;
  };
}

function renderRunner(
  chapters: Chapter[] = [CHAPTER],
  reloadChapters: (
    novelId: string,
  ) => Promise<{ chapters: Chapter[]; chapterId: string | undefined } | null> = async () => ({
    chapters,
    chapterId: chapters[0]?.id,
  }),
  modelSelectionPendingRef?: { current: () => boolean },
  selectedModelRef?: { current: TaskModelSnapshot },
) {
  return renderHook(() => {
    const selectedModel = selectedModelRef?.current ?? MODEL;
    const selectedNovelRef = useRef('novel-1');
    const [chapterId, setChapterId] = useState<string | undefined>(chapters[0]?.id);
    const [renderedChapters, setRenderedChapters] = useState(chapters);
    const [conversations, setConversations] = useState([liveBundle.conversation]);
    const reloadRenderedChapters = async (novelId: string) => {
      const refreshed = await reloadChapters(novelId);
      if (refreshed) {
        setRenderedChapters(refreshed.chapters);
        setChapterId(refreshed.chapterId);
      }
      return refreshed;
    };
    return useWorkbenchTaskRunner({
      selectedNovelId: 'novel-1',
      selectedConversationId: 'conversation-1',
      chapterId,
      chapters: renderedChapters,
      bundle: liveBundle,
      conversations,
      setConversations,
      selectedModel,
      modelSelectionPendingRef,
      selectedNovelRef,
      selectChapter: async (nextChapterId) => setChapterId(nextChapterId),
      reloadChapters: reloadRenderedChapters,
      refreshBundle: async () => undefined,
      loadConversations: async () => undefined,
      refreshPlugins: async (_conversationId, _allowProbe, snapshot) => [
        {
          id: `model:mock:${(snapshot ?? selectedModel).modelId}`,
          name: (snapshot ?? selectedModel).modelId,
          category: 'model',
          version: 'catalog',
          description: 'test model',
          status: 'loaded',
          availability: 'available',
          initialization: 'initialized',
          health: 'healthy',
          source: 'browser-fallback',
          capabilities: [],
        },
      ],
    });
  });
}

interface ScopedRunnerInput {
  selectedNovelId: string;
  selectedConversationId: string;
  chapterId: string | undefined;
  chapters: Chapter[];
  bundle: TaskConversationBundle;
}

function renderScopedRunner(
  initialScope: ScopedRunnerInput,
  callbacks: {
    reloadChapters: (
      novelId: string,
    ) => Promise<{ chapters: Chapter[]; chapterId: string | undefined } | null>;
    selectChapter: (chapterId: string) => Promise<void>;
  },
) {
  const refreshBundle = async () => undefined;
  const loadConversations = async () => undefined;
  const refreshPlugins = async () => [
    {
      id: 'model:browser-fallback:Mock',
      name: 'Mock',
      category: 'model' as const,
      version: 'catalog',
      description: 'test model',
      status: 'loaded' as const,
      availability: 'available' as const,
      initialization: 'initialized' as const,
      health: 'healthy' as const,
      source: 'browser-fallback',
      capabilities: [],
    },
  ];
  return renderHook(
    ({ scope }: { scope: ScopedRunnerInput }) => {
      const selectedNovelRef = useRef(scope.selectedNovelId);
      selectedNovelRef.current = scope.selectedNovelId;
      const [conversations, setConversations] = useState([scope.bundle.conversation]);
      return useWorkbenchTaskRunner({
        selectedNovelId: scope.selectedNovelId,
        selectedConversationId: scope.selectedConversationId,
        chapterId: scope.chapterId,
        chapters: scope.chapters,
        bundle: scope.bundle,
        conversations,
        setConversations,
        selectedModel: MODEL,
        selectedNovelRef,
        selectChapter: callbacks.selectChapter,
        reloadChapters: callbacks.reloadChapters,
        refreshBundle,
        loadConversations,
        refreshPlugins,
      });
    },
    { initialProps: { scope: initialScope } },
  );
}

async function submit(runner: ReturnType<typeof renderRunner>, command: string): Promise<void> {
  await act(async () => runner.result.current.setDraft(command));
  await waitFor(() => assert.equal(runner.result.current.draft, command));
  await act(async () => runner.result.current.sendMessage());
}

beforeEach(() => {
  useWorkbenchDraftStore.setState({ drafts: {} });
  localStorage.clear();
  window.sessionStorage.clear();
  liveBundle = bundleWith([]);
  providerGoals = [];
  installConversationStore();
  taskConversationService.isPersistent = () => false;
  taskSessionAdapter.listRunningConversationIds = async () => [];
  taskSessionAdapter.isRunning = () => false;
  taskSessionAdapter.isRunningAuthoritatively = async () => false;
  taskSessionAdapter.subscribeToRuntimeProjections = async () => () => undefined;
  taskSessionAdapter.startTurn = async (input) => {
    providerGoals.push(input.goal);
    const run: TaskRun = {
      runId: `provider-run-${providerGoals.length}`,
      conversationId: input.conversationId,
      turnId: input.turnId,
      chapterId: input.chapterId,
      status: 'completed',
      modelSnapshot: input.modelSnapshot!,
      workerId: 'provider-worker',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    liveBundle.runs.push(run);
    return run;
  };
  chapterSummaryService.getByNovelId = async () => [];
  chapterAssetReadinessService.inspect = async () => ({ ready: true, missingAssets: [] });
  chapterRepository.getByNovelId = async () => [CHAPTER];
  volumeRepository.getByNovelId = async () => [];
});

afterEach(() => {
  cleanup();
  chapterAssetRecoveryStore.remove('conversation-1');
  chapterAssetRecoveryStore.remove('conversation-2');
  taskConversationService.get = original.getConversation;
  taskConversationService.appendTurn = original.appendTurn;
  taskConversationService.createRun = original.createRun;
  taskConversationService.updateRun = original.updateRun;
  taskConversationService.isPersistent = original.isPersistent;
  taskSessionAdapter.listRunningConversationIds = original.listRunning;
  taskSessionAdapter.isRunning = original.isRunning;
  taskSessionAdapter.isRunningAuthoritatively = original.isRunningAuthoritatively;
  taskSessionAdapter.subscribeToRuntimeProjections = original.subscribe;
  taskSessionAdapter.startTurn = original.startTurn;
  chapterSummaryService.getByNovelId = original.summaries;
  chapterAssetReadinessService.inspect = original.inspectAssets;
  artifactDecisionService.applyStructured = original.applyStructured;
  artifactDecisionService.record = original.recordDecision;
  artifactDecisionService.adoptReviewAuthorizedDraft = original.adoptDraft;
  aiTaskRuntimeService.getArtifact = original.getArtifact;
  draftVersionService.create = original.createDraft;
  chapterRepository.getByNovelId = original.chapters;
  volumeRepository.getByNovelId = original.volumes;
});

test('model selection persistence pauses new runs without losing the unsent draft', async () => {
  const pending = { current: () => true };
  const runner = renderRunner([CHAPTER], undefined, pending);
  await act(async () => runner.result.current.setDraft('生成本章正文'));
  await act(async () => runner.result.current.sendMessage());
  assert.equal(providerGoals.length, 0);
  assert.equal(liveBundle.turns.length, 0);
  assert.equal(runner.result.current.draft, '生成本章正文');
  pending.current = () => false;
  await act(async () => runner.result.current.sendMessage());
  assert.equal(providerGoals.length, 1);
});

test('an accepted send clears the submitted draft while running and keeps newer input after failure', async () => {
  const running = deferred<TaskRun>();
  taskSessionAdapter.startTurn = async (input) => {
    providerGoals.push(input.goal);
    return running.promise;
  };
  const runner = renderRunner();
  await act(async () => runner.result.current.setDraft('生成本章正文'));
  let sendPromise = Promise.resolve();
  act(() => {
    sendPromise = runner.result.current.sendMessage();
  });
  await waitFor(() => assert.deepEqual(providerGoals, ['生成本章正文']));
  assert.equal(liveBundle.turns.filter((turn) => turn.role === 'user').length, 1);
  assert.equal(runner.result.current.draft, '');
  await act(async () => runner.result.current.setDraft('下一条独立意见'));
  await act(async () => {
    running.reject(new Error('模型生成失败'));
    await sendPromise;
  });
  assert.equal(runner.result.current.draft, '下一条独立意见');
  assert.match(runner.result.current.composerError, /模型生成失败/u);
});

test('real-model conversation persists and clears a vague creative brief before checking chapter assets', async () => {
  const tauriWindow = window as unknown as Record<string, unknown>;
  tauriWindow.__TAURI_INTERNALS__ = {};
  const model = {
    current: {
      ...MODEL,
      providerId: 'openai_compatible',
      modelId: 'real-model',
      runtimeMode: 'api' as const,
    },
  };
  let assetChecks = 0;
  chapterAssetReadinessService.inspect = async () => {
    assetChecks++;
    return { ready: false, missingAssets: ['world_setting'], chapterId: CHAPTER.id };
  };
  const originalTargets = taskConversationWindow.listRunningTargets;
  taskConversationWindow.listRunningTargets = async () => [];
  let prepare: Parameters<typeof taskSessionAdapter.startTurn>[0]['preparePlannedAction'];
  taskSessionAdapter.startTurn = async (input) => {
    prepare = input.preparePlannedAction;
    assert.equal(input.goal, '我想写一个悬疑故事，先聊聊背景，不要生成正文');
    assert.equal(input.modelSnapshot, model.current);
    return {
      runId: 'chat-run',
      conversationId: input.conversationId,
      turnId: input.turnId,
      status: 'completed',
      modelSnapshot: model.current,
      workerId: 'chat-worker',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };
  try {
    const runner = renderRunner([], undefined, undefined, model);
    await submit(runner, '我想写一个悬疑故事，先聊聊背景，不要生成正文');
    assert.equal(liveBundle.turns.filter((turn) => turn.role === 'user').length, 1);
    assert.equal(runner.result.current.draft, '');
    assert.equal(assetChecks, 0);
    await act(async () =>
      runner.result.current.startInitializedTask({
        conversationId: 'conversation-1',
        novelId: 'novel-1',
        turnId: liveBundle.turns[0].turnId,
        goal: '我想写一个悬疑故事，先聊聊背景，不要生成正文',
        modelSnapshot: model.current,
      }),
    );
    assert.equal(liveBundle.turns.filter((turn) => turn.role === 'user').length, 1);
    assert.equal(assetChecks, 0);
    assert.ok(prepare);
    await act(async () => {
      assert.equal(
        await prepare!({
          action: 'generate_chapter',
          instruction: '写已讨论的开篇',
          chapterId: CHAPTER.id,
        }),
        null,
      );
    });
    assert.ok(assetChecks > 0);
  } finally {
    delete tauriWindow.__TAURI_INTERNALS__;
    taskConversationWindow.listRunningTargets = originalTargets;
  }
});

test('word-target-only send works without model readiness, credentials or a chapter and records ANS-local receipt', async () => {
  taskSessionAdapter.startTurn = original.startTurn;
  let modelPreflights = 0;
  const unavailableModel: TaskModelSnapshot = {
    ...MODEL,
    runtimeMode: 'api',
    providerId: 'unavailable',
    modelId: 'Offline',
    baseUrl: 'https://offline.invalid/v1',
  };
  const selectedNovelRef = { current: 'novel-1' };
  const runner = renderHook(() => {
    const [conversations, setConversations] = useState([liveBundle.conversation]);
    return useWorkbenchTaskRunner({
      selectedNovelId: 'novel-1',
      selectedConversationId: 'conversation-1',
      chapterId: undefined,
      chapters: [],
      bundle: liveBundle,
      conversations,
      setConversations,
      selectedModel: unavailableModel,
      selectedNovelRef,
      selectChapter: async () => undefined,
      reloadChapters: async () => null,
      refreshBundle: async () => undefined,
      loadConversations: async () => undefined,
      refreshPlugins: async () => {
        modelPreflights += 1;
        throw new Error('model offline');
      },
    });
  });
  await act(async () => runner.result.current.sendMessage('本任务目标字数设为3200字'));
  assert.equal(runner.result.current.composerError, '');
  assert.equal(modelPreflights, 0);
  assert.deepEqual(providerGoals, []);
  assert.equal(liveBundle.runs.length, 1);
  assert.equal(liveBundle.runs[0].modelSnapshot.providerId, 'ans-local');
  assert.equal(liveBundle.runs[0].status, 'completed');
  assert.match(
    liveBundle.turns.find((turn) => turn.role === 'assistant')?.content ?? '',
    /本任务每章目标字数设为 3200 字/u,
  );
  assert.equal(liveBundle.artifacts.length, 0);
  await act(async () => runner.result.current.sendMessage('本章目标字数设为3200字'));
  assert.match(runner.result.current.composerError, /本任务目标字数设为3200字/u);
  assert.equal(modelPreflights, 0);
  assert.equal(liveBundle.runs.length, 1);
});

test('send preflight exposes preparing and blocks a duplicate send for the conversation', async () => {
  const readiness = deferred<Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>>();
  let inspectCalls = 0;
  chapterAssetReadinessService.inspect = async () => {
    inspectCalls += 1;
    return readiness.promise;
  };
  const runner = renderRunner();
  await act(async () => runner.result.current.setDraft('继续写'));

  let sendPromise = Promise.resolve();
  act(() => {
    sendPromise = runner.result.current.sendMessage();
  });
  await waitFor(() => {
    assert.equal(inspectCalls, 1);
    assert.equal(runner.result.current.selectedConversationPreparing, true);
    assert.equal(runner.result.current.selectedConversationRunning, false);
  });

  await act(async () => runner.result.current.sendMessage());
  assert.equal(inspectCalls, 1);
  assert.equal(liveBundle.turns.length, 1);
  assert.deepEqual(providerGoals, []);

  await act(async () => {
    readiness.resolve({ ready: true, missingAssets: [] });
    await sendPromise;
  });
  await waitFor(() => assert.equal(runner.result.current.selectedConversationPreparing, false));
  assert.deepEqual(providerGoals, ['继续写']);
});

test('a failed send preflight releases preparing so the same draft can be retried', async () => {
  const readiness = deferred<Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>>();
  chapterAssetReadinessService.inspect = async () => readiness.promise;
  const runner = renderRunner();
  await act(async () => runner.result.current.setDraft('继续写'));

  let failedSend = Promise.resolve();
  act(() => {
    failedSend = runner.result.current.sendMessage();
  });
  await waitFor(() => assert.equal(runner.result.current.selectedConversationPreparing, true));
  await act(async () => {
    readiness.reject(new Error('预检失败'));
    await failedSend;
  });

  await waitFor(() => {
    assert.equal(runner.result.current.selectedConversationPreparing, false);
    assert.match(runner.result.current.composerError, /预检失败/);
  });
  assert.equal(runner.result.current.draft, '继续写');

  chapterAssetReadinessService.inspect = async () => ({ ready: true, missingAssets: [] });
  await act(async () => runner.result.current.sendMessage());
  assert.deepEqual(providerGoals, ['继续写']);
  assert.equal(runner.result.current.selectedConversationPreparing, false);
});

test('initialized task startup uses the same preparing mutex and releases it after startup', async () => {
  const readiness = deferred<Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>>();
  let inspectCalls = 0;
  chapterAssetReadinessService.inspect = async () => {
    inspectCalls += 1;
    return readiness.promise;
  };
  const runner = renderRunner();
  const request = {
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    turnId: 'turn-initialized',
    goal: '继续写',
    modelSnapshot: MODEL,
  };

  let startupPromise = Promise.resolve();
  act(() => {
    startupPromise = runner.result.current.startInitializedTask(request);
  });
  await waitFor(() => {
    assert.equal(inspectCalls, 1);
    assert.equal(runner.result.current.selectedConversationPreparing, true);
  });

  await act(async () => runner.result.current.startInitializedTask(request));
  assert.equal(inspectCalls, 1);

  await act(async () => {
    readiness.resolve({ ready: true, missingAssets: [] });
    await startupPromise;
  });
  await waitFor(() => assert.equal(runner.result.current.selectedConversationPreparing, false));
  assert.deepEqual(providerGoals, ['继续写']);
});

test('asset decision command uses a fresh bundle and an ans-local run before refreshing recovery', async () => {
  const candidate = artifact('setting_candidates', 'world');
  liveBundle = bundleWith([candidate]);
  installConversationStore();
  chapterAssetRecoveryStore.set({
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    originalGoal: '继续写',
    missingAssets: ['world_setting'],
    modelSnapshot: MODEL,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'world_setting',
      candidateArtifactId: candidate.artifactId,
      updatedAt: '2026-08-31T00:00:01.000Z',
    },
    createdAt: '2026-08-31T00:00:00.000Z',
    checkedAt: '2026-08-31T00:00:01.000Z',
  });
  chapterAssetReadinessService.inspect = async () => ({
    ready: false,
    missingAssets: ['world_setting'],
  });
  let applyCardId = '';
  const reloadedNovelIds: string[] = [];
  artifactDecisionService.applyStructured = async (input) => {
    applyCardId = input.cardId;
    return { decision: decision(candidate, 'request_apply', 'transaction-world') };
  };

  const runner = renderRunner([CHAPTER], async (novelId) => {
    reloadedNovelIds.push(novelId);
    return { chapters: [CHAPTER], chapterId: CHAPTER.id };
  });
  await waitFor(() =>
    assert.equal(runner.result.current.assetRecovery?.orchestration.phase, 'awaiting_apply'),
  );
  await submit(runner, '应用当前资产候选');

  assert.equal(applyCardId, candidate.cardId);
  assert.deepEqual(providerGoals, []);
  assert.deepEqual(
    liveBundle.turns.map((turn) => [turn.role, turn.content]),
    [
      ['user', '应用当前资产候选'],
      ['assistant', '创作资产候选已应用到作品，系统将继续准备缺失资产或恢复原创作目标。'],
    ],
  );
  assert.equal(liveBundle.runs.length, 1);
  assert.equal(liveBundle.runs[0].modelSnapshot.providerId, 'ans-local');
  assert.equal(liveBundle.runs[0].status, 'completed');
  assert.deepEqual(reloadedNovelIds, ['novel-1']);
  assert.equal(runner.result.current.assetRecovery?.orchestration.phase, 'failed');
});

test('late conversational asset apply settles its original recovery without reloading a newly selected novel', async () => {
  const candidate = artifact('setting_candidates', 'world-late-conversation');
  liveBundle = bundleWith([candidate]);
  installConversationStore();
  chapterAssetRecoveryStore.set({
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    originalGoal: '继续写',
    missingAssets: ['world_setting'],
    modelSnapshot: MODEL,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'world_setting',
      candidateArtifactId: candidate.artifactId,
      updatedAt: '2026-08-31T00:00:01.000Z',
    },
    createdAt: '2026-08-31T00:00:00.000Z',
    checkedAt: '2026-08-31T00:00:01.000Z',
  });
  chapterAssetReadinessService.inspect = async () => ({
    ready: false,
    missingAssets: ['world_setting'],
  });
  const applyGate = deferred<void>();
  let applyCalls = 0;
  artifactDecisionService.applyStructured = async () => {
    applyCalls += 1;
    await applyGate.promise;
    return { decision: decision(candidate, 'request_apply', 'transaction-world-late') };
  };

  const secondChapter: Chapter = {
    ...CHAPTER,
    id: 'chapter-2',
    novelId: 'novel-2',
    title: '另一部作品的第一章',
  };
  const secondBundle = bundleWith([]);
  secondBundle.conversation = {
    ...secondBundle.conversation,
    conversationId: 'conversation-2',
    novelId: 'novel-2',
    title: '另一部作品的任务',
  };
  const reloads: string[] = [];
  const selections: string[] = [];
  const runner = renderScopedRunner(
    {
      selectedNovelId: 'novel-1',
      selectedConversationId: 'conversation-1',
      chapterId: CHAPTER.id,
      chapters: [CHAPTER],
      bundle: liveBundle,
    },
    {
      reloadChapters: async (novelId) => {
        reloads.push(novelId);
        return { chapters: [CHAPTER], chapterId: CHAPTER.id };
      },
      selectChapter: async (chapterId) => {
        selections.push(chapterId);
      },
    },
  );
  await waitFor(() =>
    assert.equal(runner.result.current.assetRecovery?.orchestration.phase, 'awaiting_apply'),
  );
  await act(async () => runner.result.current.setDraft('应用当前资产候选'));
  await waitFor(() => assert.equal(runner.result.current.draft, '应用当前资产候选'));

  let sendPromise = Promise.resolve();
  act(() => {
    sendPromise = runner.result.current.sendMessage();
  });
  await waitFor(() => assert.equal(applyCalls, 1));
  act(() => {
    runner.rerender({
      scope: {
        selectedNovelId: 'novel-2',
        selectedConversationId: 'conversation-2',
        chapterId: secondChapter.id,
        chapters: [secondChapter],
        bundle: secondBundle,
      },
    });
  });

  await act(async () => {
    applyGate.resolve();
    await sendPromise;
  });
  await waitFor(() =>
    assert.equal(chapterAssetRecoveryStore.get('conversation-1')?.orchestration.phase, 'failed'),
  );

  assert.deepEqual(reloads, []);
  assert.deepEqual(selections, []);
  assert.equal(chapterAssetRecoveryStore.get('conversation-2'), null);
  assert.equal(liveBundle.runs[0]?.status, 'completed');
  assert.match(liveBundle.turns[1]?.content ?? '', /创作资产候选已应用/);
});

test('generic retry restores a failed asset stage even after a completed planning run', async () => {
  const originalGoal = '写个六万字左右的悬疑故事。';
  const goal = buildCoreAssetGenerationGoal('world_setting', originalGoal);
  const turnId = 'turn-world-setting';
  const failedRun: TaskRun = {
    runId: 'run-world-setting-failed',
    conversationId: 'conversation-1',
    turnId,
    status: 'failed',
    modelSnapshot: MODEL,
    workerId: 'provider-worker-failed',
    error: 'DSH 回合以错误结束: HTTP_408',
    createdAt: '2026-08-31T00:00:01.000Z',
    updatedAt: '2026-08-31T00:00:02.000Z',
    finishedAt: '2026-08-31T00:00:02.000Z',
  };
  liveBundle.turns.push({
    turnId,
    conversationId: 'conversation-1',
    sequence: 0,
    role: 'user',
    content: encodeWorkbenchTurnContent(goal, 'workbench_asset_preparation'),
    createdAt: '2026-08-31T00:00:00.000Z',
  });
  liveBundle.runs.push(failedRun);
  liveBundle.runs.push({
    ...failedRun,
    runId: 'later-plan',
    status: 'completed',
    createdAt: '2026-08-31T00:00:02.500Z',
  });
  liveBundle.toolEvents.push({
    eventId: 'plan-event',
    runId: 'later-plan',
    sequence: 1,
    toolName: 'creative.plan_action',
    argumentsSummary: {},
    status: 'succeeded',
    createdAt: '2026-08-31T00:00:02.600Z',
  });
  liveBundle.conversation.status = 'failed';
  chapterAssetRecoveryStore.set({
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    originalGoal,
    missingAssets: ['world_setting'],
    modelSnapshot: MODEL,
    orchestration: {
      phase: 'failed',
      asset: 'world_setting',
      preparationTurnId: turnId,
      preparationRunId: failedRun.runId,
      error: failedRun.error,
      updatedAt: failedRun.updatedAt,
    },
    createdAt: '2026-08-31T00:00:00.000Z',
    checkedAt: failedRun.updatedAt,
  });
  chapterAssetReadinessService.inspect = async () => ({
    ready: false,
    missingAssets: ['world_setting'],
  });
  const startedInputs: Parameters<typeof taskSessionAdapter.startTurn>[0][] = [];
  taskSessionAdapter.startTurn = async (input) => {
    startedInputs.push(input);
    const completedRun: TaskRun = {
      runId: 'run-world-setting-retry',
      conversationId: input.conversationId,
      turnId: input.turnId,
      status: 'completed',
      modelSnapshot: input.modelSnapshot!,
      workerId: 'provider-worker-retry',
      createdAt: '2026-08-31T00:00:03.000Z',
      updatedAt: '2026-08-31T00:00:04.000Z',
      finishedAt: '2026-08-31T00:00:04.000Z',
    };
    const candidate = artifact('setting_candidates', 'world-retry');
    candidate.turnId = input.turnId;
    candidate.runId = completedRun.runId;
    liveBundle.runs.push(completedRun);
    liveBundle.artifacts.push(candidate);
    return completedRun;
  };

  const runner = renderRunner();
  await waitFor(() => assert.equal(runner.result.current.retryRunBlockedReason, ''));
  await act(async () => runner.result.current.retryRun(failedRun.runId));
  await waitFor(() =>
    assert.equal(runner.result.current.assetRecovery?.orchestration.phase, 'awaiting_apply'),
  );

  assert.equal(liveBundle.turns.length, 1);
  assert.equal(liveBundle.runs.length, 3);
  assert.equal(startedInputs.length, 1);
  assert.equal(startedInputs[0]?.turnId, turnId);
  assert.equal(startedInputs[0]?.retrySourceRunId, failedRun.runId);
  assert.equal(startedInputs[0]?.goal, goal);
  assert.deepEqual(startedInputs[0]?.modelSnapshot, MODEL);
  assert.equal(
    runner.result.current.assetRecovery?.orchestration.candidateArtifactId,
    'artifact-world-retry',
  );
});

test('queued asset uses B and retries B after the task selection changes to C', async () => {
  const selectedModelRef = { current: { ...MODEL, modelId: 'Model-B' } };
  chapterAssetRecoveryStore.set({
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    originalGoal: '继续写',
    missingAssets: ['world_setting'],
    modelSnapshot: MODEL,
    orchestration: { phase: 'queued', asset: 'world_setting', updatedAt: MODEL.capturedAt },
    createdAt: MODEL.capturedAt,
    checkedAt: MODEL.capturedAt,
  });
  chapterAssetReadinessService.inspect = async () => ({
    ready: false,
    missingAssets: ['world_setting'],
  });
  const startedInputs: Parameters<typeof taskSessionAdapter.startTurn>[0][] = [];
  taskSessionAdapter.startTurn = async (input) => {
    startedInputs.push(input);
    const failedRun: TaskRun = {
      runId: `failed-asset-${startedInputs.length}`,
      conversationId: input.conversationId,
      turnId: input.turnId,
      status: 'failed',
      modelSnapshot: input.modelSnapshot!,
      workerId: 'worker-asset',
      error: 'HTTP_408',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    liveBundle.runs.push(failedRun);
    return failedRun;
  };
  const runner = renderRunner([CHAPTER], undefined, undefined, selectedModelRef);
  await waitFor(() => {
    assert.equal(runner.result.current.assetRecovery?.orchestration.phase, 'failed');
    assert.equal(runner.result.current.selectedConversationPreparing, false);
  });
  assert.equal(startedInputs.length, 1);
  assert.equal(startedInputs[0].modelSnapshot?.modelId, 'Model-B');
  assert.equal(chapterAssetRecoveryStore.get('conversation-1')?.modelSnapshot?.modelId, 'Model-B');
  selectedModelRef.current = { ...MODEL, modelId: 'Model-C' };
  act(() => runner.rerender());
  await act(async () => runner.result.current.generateMissingAsset('world_setting'));
  assert.equal(startedInputs.length, 2);
  assert.equal(startedInputs[1].modelSnapshot?.modelId, 'Model-B');
  assert.equal(liveBundle.runs[0].modelSnapshot.modelId, 'Model-B');
});

test('a failed original-model read retains asset Run identity for the next explicit retry', async () => {
  const originalGoal = '继续写';
  const preparationTurnId = 'turn-asset-original';
  const originalRun: TaskRun = {
    runId: 'run-asset-original',
    conversationId: 'conversation-1',
    turnId: preparationTurnId,
    status: 'failed',
    modelSnapshot: { ...MODEL, modelId: 'Model-B' },
    workerId: 'original-worker',
    createdAt: MODEL.capturedAt,
    updatedAt: MODEL.capturedAt,
  };
  liveBundle.runs.push(originalRun);
  liveBundle.turns.push({
    turnId: preparationTurnId,
    conversationId: 'conversation-1',
    sequence: 0,
    role: 'user',
    content: encodeWorkbenchTurnContent(
      buildCoreAssetGenerationGoal('world_setting', originalGoal),
      'workbench_asset_preparation',
    ),
    createdAt: MODEL.capturedAt,
  });
  chapterAssetRecoveryStore.set({
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    originalGoal,
    missingAssets: ['world_setting'],
    modelSnapshot: MODEL,
    orchestration: {
      phase: 'failed',
      asset: 'world_setting',
      preparationTurnId,
      preparationRunId: originalRun.runId,
      updatedAt: MODEL.capturedAt,
    },
    createdAt: MODEL.capturedAt,
    checkedAt: MODEL.capturedAt,
  });
  chapterAssetReadinessService.inspect = async () => ({
    ready: false,
    missingAssets: ['world_setting'],
  });
  const modelIds: string[] = [];
  const startTurn = taskSessionAdapter.startTurn;
  taskSessionAdapter.startTurn = async (input, listener) => {
    modelIds.push(input.modelSnapshot!.modelId);
    return startTurn(input, listener);
  };
  const runner = renderRunner([CHAPTER], undefined, undefined, {
    current: { ...MODEL, modelId: 'Model-C' },
  });
  await waitFor(() =>
    assert.equal(runner.result.current.assetRecovery?.orchestration.phase, 'failed'),
  );
  let readFailed = false;
  taskConversationService.get = async () => {
    if (!readFailed) {
      readFailed = true;
      throw new Error('temporary model read failure');
    }
    return liveBundle;
  };
  await act(async () => runner.result.current.generateMissingAsset('world_setting'));
  assert.deepEqual(modelIds, []);
  assert.equal(
    runner.result.current.assetRecovery?.orchestration.preparationRunId,
    originalRun.runId,
  );
  assert.equal(
    runner.result.current.assetRecovery?.orchestration.preparationTurnId,
    preparationTurnId,
  );
  await act(async () => runner.result.current.generateMissingAsset('world_setting'));
  assert.deepEqual(modelIds, ['Model-B']);
});

test('chapter adoption command stays on the ans-local run while preserving the guarded adoption chain', async () => {
  const content = '第一章\n\n雨夜里，门铃响了三次。';
  const contentHash = await computeContentSha256(content);
  const candidate = artifact('chapter_text', 'chapter', { sourceChapterId: 'chapter-1' });
  liveBundle = bundleWith([candidate]);
  installConversationStore();
  const authorization: ReviewAuthorization = {
    authorizationId: 'authorization-1',
    artifactId: candidate.artifactId!,
    chapterId: 'chapter-1',
    novelId: 'novel-1',
    decisionId: 'decision-chapter',
    status: 'issued',
    issuedAt: '2026-08-31T00:00:02.000Z',
  };
  const resultArtifact: ResultArtifactBundle = {
    artifact: {
      artifactId: candidate.artifactId!,
      taskId: 'task-1',
      attemptId: 'attempt-1',
      sourceInputSnapshotId: 'snapshot-1',
      artifactType: 'chapter_text',
      schemaVersion: 1,
      rawContentRefId: 'raw-1',
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      contentHash,
      contentLength: Array.from(content).length,
      processingStatus: 'valid',
      createdAt: '2026-08-31T00:00:01.000Z',
    },
    rawContent: content,
    issues: [],
  };
  const draft: ChapterDraft = {
    id: 'draft-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    content,
    source: 'ai_generated',
    versionNo: 1,
    wordCount: 12,
    isAdopted: false,
    createdAt: '2026-08-31T00:00:03.000Z',
    updatedAt: '2026-08-31T00:00:03.000Z',
  };
  let adoptedAuthorizationId = '';
  const reloadedNovelIds: string[] = [];
  aiTaskRuntimeService.getArtifact = async () => resultArtifact;
  artifactDecisionService.record = async () => ({
    decision: decision(candidate, 'confirm'),
    authorization,
  });
  draftVersionService.create = async () => draft;
  artifactDecisionService.adoptReviewAuthorizedDraft = async (input) => {
    adoptedAuthorizationId = input.authorizationId;
    const consumedAuthorization: ReviewAuthorization = {
      ...authorization,
      status: 'consumed',
      consumedByDraftId: draft.id,
    };
    liveBundle.authorizations = [consumedAuthorization];
    return {
      authorization: consumedAuthorization,
      adoptedDraft: { ...draft, isAdopted: true },
      summaryFollowUp: {
        status: 'pending_generation',
        nextAction: 'summarize_chapter',
        instruction: '总结本章',
        chapterId: 'chapter-1',
        adoptedDraftId: draft.id,
      },
    };
  };

  const adoptedChapter: Chapter = {
    ...CHAPTER,
    status: 'adopted',
    adoptedDraftId: draft.id,
  };
  const runner = renderRunner([CHAPTER], async (novelId) => {
    reloadedNovelIds.push(novelId);
    return { chapters: [adoptedChapter], chapterId: adoptedChapter.id };
  });
  await submit(runner, '采用本章正文候选');
  await waitFor(() =>
    assert.equal(runner.result.current.chapterSummaryOrchestration.phase, 'ensure_turn'),
  );

  assert.equal(adoptedAuthorizationId, authorization.authorizationId);
  assert.deepEqual(reloadedNovelIds, ['novel-1']);
  assert.deepEqual(providerGoals, []);
  assert.equal(liveBundle.runs[0].modelSnapshot.providerId, 'ans-local');
  assert.equal(liveBundle.runs[0].status, 'completed');
  assert.match(liveBundle.turns[1]?.content ?? '', /已采用为正式正文/);
});

test('late conversational chapter adoption does not reload or select chapters in a newly selected novel', async () => {
  const content = '第一章\n\n雨停以后，旧信封出现在门槛上。';
  const contentHash = await computeContentSha256(content);
  const candidate = artifact('chapter_text', 'chapter-late-conversation', {
    sourceChapterId: 'chapter-1',
  });
  liveBundle = bundleWith([candidate]);
  installConversationStore();
  const authorization: ReviewAuthorization = {
    authorizationId: 'authorization-late-conversation',
    artifactId: candidate.artifactId!,
    chapterId: 'chapter-1',
    novelId: 'novel-1',
    decisionId: 'decision-chapter-late-conversation',
    status: 'issued',
    issuedAt: '2026-08-31T00:00:02.000Z',
  };
  const resultArtifact: ResultArtifactBundle = {
    artifact: {
      artifactId: candidate.artifactId!,
      taskId: 'task-late-conversation',
      attemptId: 'attempt-late-conversation',
      sourceInputSnapshotId: 'snapshot-late-conversation',
      artifactType: 'chapter_text',
      schemaVersion: 1,
      rawContentRefId: 'raw-late-conversation',
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      contentHash,
      contentLength: Array.from(content).length,
      processingStatus: 'valid',
      createdAt: '2026-08-31T00:00:01.000Z',
    },
    rawContent: content,
    issues: [],
  };
  const draft: ChapterDraft = {
    id: 'draft-late-conversation',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    content,
    source: 'ai_generated',
    versionNo: 1,
    wordCount: 16,
    isAdopted: false,
    createdAt: '2026-08-31T00:00:03.000Z',
    updatedAt: '2026-08-31T00:00:03.000Z',
  };
  const adoptionGate = deferred<void>();
  let adoptionCalls = 0;
  aiTaskRuntimeService.getArtifact = async () => resultArtifact;
  artifactDecisionService.record = async () => ({
    decision: decision(candidate, 'confirm'),
    authorization,
  });
  draftVersionService.create = async () => draft;
  artifactDecisionService.adoptReviewAuthorizedDraft = async () => {
    adoptionCalls += 1;
    await adoptionGate.promise;
    const consumedAuthorization: ReviewAuthorization = {
      ...authorization,
      status: 'consumed',
      consumedByDraftId: draft.id,
    };
    return {
      authorization: consumedAuthorization,
      adoptedDraft: { ...draft, isAdopted: true },
      summaryFollowUp: {
        status: 'pending_generation',
        nextAction: 'summarize_chapter',
        instruction: '总结本章',
        chapterId: 'chapter-1',
        adoptedDraftId: draft.id,
      },
    };
  };

  const secondChapter: Chapter = {
    ...CHAPTER,
    id: 'chapter-2',
    novelId: 'novel-2',
    title: '另一部作品的第一章',
  };
  const secondBundle = bundleWith([]);
  secondBundle.conversation = {
    ...secondBundle.conversation,
    conversationId: 'conversation-2',
    novelId: 'novel-2',
    title: '另一部作品的任务',
  };
  const reloads: string[] = [];
  const selections: string[] = [];
  const runner = renderScopedRunner(
    {
      selectedNovelId: 'novel-1',
      selectedConversationId: 'conversation-1',
      chapterId: CHAPTER.id,
      chapters: [CHAPTER],
      bundle: liveBundle,
    },
    {
      reloadChapters: async (novelId) => {
        reloads.push(novelId);
        return { chapters: [CHAPTER], chapterId: CHAPTER.id };
      },
      selectChapter: async (chapterId) => {
        selections.push(chapterId);
      },
    },
  );
  await act(async () => runner.result.current.setDraft('采用本章正文候选'));
  await waitFor(() => assert.equal(runner.result.current.draft, '采用本章正文候选'));

  let sendPromise = Promise.resolve();
  act(() => {
    sendPromise = runner.result.current.sendMessage();
  });
  await waitFor(() => assert.equal(adoptionCalls, 1));
  act(() => {
    runner.rerender({
      scope: {
        selectedNovelId: 'novel-2',
        selectedConversationId: 'conversation-2',
        chapterId: secondChapter.id,
        chapters: [secondChapter],
        bundle: secondBundle,
      },
    });
  });

  await act(async () => {
    adoptionGate.resolve();
    await sendPromise;
  });

  assert.deepEqual(reloads, []);
  assert.deepEqual(selections, []);
  assert.equal(adoptionCalls, 1);
  assert.equal(liveBundle.runs[0]?.status, 'completed');
  assert.match(liveBundle.turns[1]?.content ?? '', /已采用为正式正文/);
});

test('summary application continues through the normal writer only after an explicit continue suffix', async () => {
  const adoptedChapter: Chapter = {
    ...CHAPTER,
    status: 'adopted',
    adoptedDraftId: 'draft-adopted-1',
  };
  const nextChapter: Chapter = {
    ...CHAPTER,
    id: 'chapter-2',
    title: '第二章',
    chapterNumber: 2,
    orderIndex: 1,
  };
  const authorization: ReviewAuthorization = {
    authorizationId: 'authorization-summary',
    artifactId: 'artifact-chapter-source',
    chapterId: 'chapter-1',
    novelId: 'novel-1',
    decisionId: 'decision-source',
    status: 'consumed',
    consumedByDraftId: 'draft-adopted-1',
    issuedAt: '2026-08-31T00:00:01.000Z',
    consumedAt: '2026-08-31T00:00:02.000Z',
  };
  const candidate = artifact('chapter_summary', 'summary', {
    sourceChapterId: 'chapter-1',
    sourceDraftId: 'draft-adopted-1',
  });
  candidate.turnId = `summary-generation-${authorization.authorizationId}`;
  candidate.runId = 'run-summary-provider';
  liveBundle = bundleWith([candidate]);
  liveBundle.authorizations = [authorization];
  liveBundle.turns.push({
    turnId: candidate.turnId,
    conversationId: 'conversation-1',
    sequence: 0,
    role: 'user',
    content: '总结本章',
    createdAt: '2026-08-31T00:00:03.000Z',
  });
  liveBundle.runs.push({
    runId: candidate.runId,
    conversationId: 'conversation-1',
    turnId: candidate.turnId,
    chapterId: 'chapter-1',
    status: 'completed',
    modelSnapshot: MODEL,
    workerId: 'summary-provider',
    createdAt: '2026-08-31T00:00:03.000Z',
    updatedAt: '2026-08-31T00:00:04.000Z',
    finishedAt: '2026-08-31T00:00:04.000Z',
  });
  installConversationStore();
  let summaryApplied = false;
  chapterSummaryService.getByNovelId = async () =>
    summaryApplied
      ? [
          {
            id: 'summary-1',
            novelId: 'novel-1',
            chapterId: 'chapter-1',
            adoptedDraftId: 'draft-adopted-1',
            summary: '雨夜门铃成为新的案件线索。',
            enabled: true,
            isExpired: false,
            version: 1,
            createdAt: '2026-08-31T00:00:05.000Z',
            updatedAt: '2026-08-31T00:00:05.000Z',
          },
        ]
      : [];
  artifactDecisionService.applyStructured = async () => {
    summaryApplied = true;
    return { decision: decision(candidate, 'request_apply', 'transaction-summary') };
  };
  chapterRepository.getByNovelId = async () => [adoptedChapter, nextChapter];

  const runner = renderRunner([adoptedChapter, nextChapter]);
  await waitFor(() =>
    assert.equal(runner.result.current.chapterSummaryOrchestration.phase, 'awaiting_apply'),
  );
  await submit(runner, '应用本章总结候选并继续写下一章');

  await waitFor(() => assert.deepEqual(providerGoals, ['继续写']), { timeout: 2_000 });
  const decisionRun = liveBundle.runs.find((run) => run.modelSnapshot.providerId === 'ans-local');
  assert.equal(decisionRun?.status, 'completed');
  assert.equal(
    liveBundle.turns.some(
      (turn) => turn.role === 'assistant' && (turn.content ?? '').includes('正在继续下一章'),
    ),
    true,
  );
});

test('sending a selected old candidate retains exact identity in the user turn and runtime', async () => {
  const selected = artifact('chapter_text', 'old-a', { sourceChapterId: CHAPTER.id });
  selected.content = JSON.stringify({
    data: { novelId: 'novel-1', chapterId: CHAPTER.id, text: '旧候选A的完整正文。' },
  });
  const hash = await computeContentSha256(selected.content);
  const source = {
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    chapterId: CHAPTER.id,
    cardId: selected.cardId,
    artifactId: selected.artifactId!,
    artifactHash: hash,
    artifactType: 'chapter_text',
    title: selected.title,
  };
  liveBundle.artifacts = [
    selected,
    artifact('chapter_text', 'new-b', { sourceChapterId: CHAPTER.id }),
  ];
  liveBundle.decisions = [{ ...decision(selected, 'request_revision'), artifactHash: hash }];
  const originalStart = taskSessionAdapter.startTurn;
  let receivedSource: unknown;
  taskSessionAdapter.startTurn = async (input, onEvent) => {
    receivedSource = input.revisionSource;
    return originalStart(input, onEvent);
  };
  const runner = renderRunner();
  await act(async () => {
    runner.result.current.setDraft('请修改所选章节正文候选，节奏放慢。');
    useWorkbenchDraftStore.getState().bindRevisionSource('conversation-1', source);
  });
  await act(async () => runner.result.current.sendMessage());
  assert.equal(runner.result.current.composerError, '');
  assert.deepEqual(receivedSource, source);
  assert.deepEqual(liveBundle.turns.find((turn) => turn.role === 'user')?.revisionSource, source);
  assert.equal(runner.result.current.revisionSource, null);
  assert.equal(runner.result.current.draft, '');
});
test('setting revision with a chapter reference sends its source without preparing missing chapter assets', async () => {
  const selected = artifact('setting_candidates', 'old-settings');
  selected.content = JSON.stringify({
    data: { settings: [{ name: '创作准备模板', content: '旧模板' }] },
  });
  const hash = await computeContentSha256(selected.content);
  const source = {
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    cardId: selected.cardId,
    artifactId: selected.artifactId!,
    artifactHash: hash,
    artifactType: 'setting_candidates',
    title: selected.title,
  };
  liveBundle.artifacts = [selected];
  liveBundle.decisions = [{ ...decision(selected, 'request_revision'), artifactHash: hash }];
  let assetChecks = 0;
  chapterAssetReadinessService.inspect = async () => {
    assetChecks++;
    return { ready: false, missingAssets: ['story_plan'], chapterId: undefined };
  };
  const originalStart = taskSessionAdapter.startTurn;
  let receivedSource: unknown;
  taskSessionAdapter.startTurn = async (input, onEvent) => {
    receivedSource = input.revisionSource;
    return originalStart(input, onEvent);
  };
  const runner = renderRunner([]);
  await act(async () => {
    runner.result.current.setDraft(
      '请仅修订所选设定候选，生成设定修正候选。第2章感谢信只提出疑点，暂不生成人物大纲正文。',
    );
    useWorkbenchDraftStore.getState().bindRevisionSource('conversation-1', source);
  });
  await act(async () => runner.result.current.sendMessage());
  assert.equal(runner.result.current.composerError, '');
  assert.equal(assetChecks, 0);
  assert.deepEqual(receivedSource, source);
  assert.deepEqual(liveBundle.turns.find((turn) => turn.role === 'user')?.revisionSource, source);
  assert.equal(liveBundle.turns.filter((turn) => turn.role === 'user').length, 1);
  assert.equal(runner.result.current.draft, '');
  assert.equal(runner.result.current.revisionSource, null);
});

test('outline revision uses the bound novel scope despite selected chapter, bare edits and prose negation', async () => {
  const selected = artifact('outline', 'old-outline');
  selected.content = JSON.stringify({ data: { title: '全书规划', chapters: ['旧大纲'] } });
  const hash = await computeContentSha256(selected.content);
  const source = {
    conversationId: 'conversation-1',
    novelId: 'novel-1',
    cardId: selected.cardId,
    artifactId: selected.artifactId!,
    artifactHash: hash,
    artifactType: 'outline',
    title: selected.title,
  };
  liveBundle.artifacts = [selected, artifact('outline', 'new-outline')];
  liveBundle.decisions = [{ ...decision(selected, 'request_revision'), artifactHash: hash }];
  let assetChecks = 0;
  chapterAssetReadinessService.inspect = async () => {
    assetChecks++;
    return { ready: false, missingAssets: ['story_plan'], chapterId: CHAPTER.id };
  };
  const originalStart = taskSessionAdapter.startTurn;
  let request: { chapterId?: string; goal: string; revisionSource?: unknown } | undefined;
  taskSessionAdapter.startTurn = async (input, onEvent) => {
    request = input;
    return originalStart(input, onEvent);
  };
  const runner = renderRunner();
  const goal =
    '请修订所选全书规划候选。第2章写深秋，写深秋的落叶，其他章节时间线保持一致。不生成正文。';
  await act(async () => {
    runner.result.current.setDraft(goal);
    useWorkbenchDraftStore.getState().bindRevisionSource('conversation-1', source);
  });
  await act(async () => runner.result.current.sendMessage());
  assert.equal(runner.result.current.composerError, '');
  assert.equal(assetChecks, 0);
  assert.equal(request?.chapterId, undefined);
  assert.equal(request?.goal, goal);
  assert.deepEqual(request?.revisionSource, source);
  assert.equal(liveBundle.turns.filter((turn) => turn.role === 'user').length, 1);
  assert.equal(runner.result.current.draft, '');
});

test('failed source revalidation preserves the draft and never appends a turn or calls runtime', async () => {
  const selected = artifact('chapter_text', 'old-a', { sourceChapterId: CHAPTER.id });
  selected.content = JSON.stringify({
    data: { novelId: 'novel-1', chapterId: CHAPTER.id, text: '旧候选A' },
  });
  const hash = await computeContentSha256(selected.content);
  liveBundle.artifacts = [selected];
  liveBundle.decisions = [{ ...decision(selected, 'request_revision'), artifactHash: hash }];
  const runner = renderRunner();
  await act(async () => {
    runner.result.current.setDraft('修改所选章节正文候选');
    useWorkbenchDraftStore.getState().bindRevisionSource('conversation-1', {
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      chapterId: CHAPTER.id,
      cardId: selected.cardId,
      artifactId: selected.artifactId!,
      artifactHash: '0'.repeat(64),
      artifactType: 'chapter_text',
      title: '失效A',
    });
  });
  await act(async () => runner.result.current.sendMessage());
  assert.match(runner.result.current.composerError, /修订来源已失效/);
  assert.equal(liveBundle.turns.length, 0);
  assert.equal(providerGoals.length, 0);
  assert.equal(runner.result.current.draft, '修改所选章节正文候选');
  assert.equal(runner.result.current.revisionSource?.artifactId, selected.artifactId);
});
