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
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    const turn = {
      turnId: `turn-${liveBundle.turns.length + 1}`,
      conversationId,
      sequence: liveBundle.turns.length,
      role,
      content,
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
) {
  return renderHook(() => {
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
      selectedModel: MODEL,
      selectedNovelRef,
      selectChapter: async (nextChapterId) => setChapterId(nextChapterId),
      reloadChapters: reloadRenderedChapters,
      refreshBundle: async () => undefined,
      loadConversations: async () => undefined,
      refreshPlugins: async () => [
        {
          id: 'model:browser-fallback:Mock',
          name: 'Mock',
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

async function submit(runner: ReturnType<typeof renderRunner>, command: string): Promise<void> {
  await act(async () => runner.result.current.setDraft(command));
  await waitFor(() => assert.equal(runner.result.current.draft, command));
  await act(async () => runner.result.current.sendMessage());
}

beforeEach(() => {
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

test('generic retry restores a failed automatic asset turn to its pending apply state', async () => {
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
  assert.equal(liveBundle.runs.length, 2);
  assert.equal(startedInputs.length, 1);
  assert.equal(startedInputs[0]?.turnId, turnId);
  assert.equal(startedInputs[0]?.goal, goal);
  assert.deepEqual(startedInputs[0]?.modelSnapshot, MODEL);
  assert.equal(
    runner.result.current.assetRecovery?.orchestration.candidateArtifactId,
    'artifact-world-retry',
  );
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
