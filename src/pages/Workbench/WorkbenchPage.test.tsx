import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import type {
  ConversationTurn,
  TaskConversation,
  TaskConversationBundle,
} from '../../types/conversation';
import type { NovelContextCompressionCandidate } from '../../services/context/novelContextCompressionProvider';

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

const { MemoryRouter, Route, Routes } = await import('react-router-dom');

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
});

after(async () => {
  await vite.close();
});

const novelRepoModule = (await vite.ssrLoadModule(
  '/src/services/database/novelRepository.ts',
)) as typeof import('../../services/database/novelRepository');
const chapterRepoModule = (await vite.ssrLoadModule(
  '/src/services/database/chapterRepository.ts',
)) as typeof import('../../services/database/chapterRepository');
const taskServiceModule = (await vite.ssrLoadModule(
  '/src/services/conversation/taskConversationService.ts',
)) as typeof import('../../services/conversation/taskConversationService');
const taskSessionModule = (await vite.ssrLoadModule(
  '/src/services/dsh/taskSessionAdapter.ts',
)) as typeof import('../../services/dsh/taskSessionAdapter');
const chapterSummaryModule = (await vite.ssrLoadModule(
  '/src/services/context/chapterSummaryService.ts',
)) as typeof import('../../services/context/chapterSummaryService');
const startupModule = (await vite.ssrLoadModule(
  '/src/services/startup/startupCoordinator.ts',
)) as typeof import('../../services/startup/startupCoordinator');
const productionRegistryModule = (await vite.ssrLoadModule(
  '/src/services/agent-tools/productionToolRegistry.ts',
)) as typeof import('../../services/agent-tools/productionToolRegistry');
const compressionProviderModule = (await vite.ssrLoadModule(
  '/src/services/context/novelContextCompressionProvider.ts',
)) as typeof import('../../services/context/novelContextCompressionProvider');
const chapterAssetReadinessModule = (await vite.ssrLoadModule(
  '/src/services/conversation/chapterAssetReadiness.ts',
)) as typeof import('../../services/conversation/chapterAssetReadiness');
const workbenchTurnOriginModule = (await vite.ssrLoadModule(
  '/src/services/conversation/workbenchTurnOrigin.ts',
)) as typeof import('../../services/conversation/workbenchTurnOrigin');
const artifactDecisionModule = (await vite.ssrLoadModule(
  '/src/services/conversation/artifactDecisionService.ts',
)) as typeof import('../../services/conversation/artifactDecisionService');
const chapterAssetRecoveryHookModule = (await vite.ssrLoadModule(
  '/src/pages/Workbench/hooks/useWorkbenchChapterAssetRecovery.ts',
)) as typeof import('./hooks/useWorkbenchChapterAssetRecovery');
const pageModule = (await vite.ssrLoadModule(
  '/src/pages/Workbench/WorkbenchPage.tsx',
)) as typeof import('./WorkbenchPage');

const { novelRepository } = novelRepoModule;
const { chapterRepository } = chapterRepoModule;
const { taskConversationService } = taskServiceModule;
const { taskSessionAdapter } = taskSessionModule;
const { chapterSummaryService } = chapterSummaryModule;
const { startupCoordinator } = startupModule;
const { productionToolRegistry } = productionRegistryModule;
const { novelContextCompressionProvider } = compressionProviderModule;
const { buildCoreAssetGenerationGoal, chapterAssetReadinessService, chapterAssetRecoveryStore } =
  chapterAssetReadinessModule;
const { decodeWorkbenchTurnContent, encodeWorkbenchTurnContent } = workbenchTurnOriginModule;
const { artifactDecisionService } = artifactDecisionModule;
const { useWorkbenchChapterAssetRecovery } = chapterAssetRecoveryHookModule;
const WorkbenchPage = pageModule.default;

const { act, cleanup, fireEvent, render, renderHook, screen, waitFor } =
  await import('@testing-library/react');

const originalGetAll = novelRepository.getAll;
const originalUpdateNovel = novelRepository.update;
const originalGetChapters = chapterRepository.getByNovelId;
const originalListConversations = taskConversationService.list;
const originalGetConversation = taskConversationService.get;
const originalCreateConversation = taskConversationService.create;
const originalCreateInitializedConversation = taskConversationService.createInitialized;
const originalAppendConversationTurn = taskConversationService.appendTurn;
const originalRenameConversation = taskConversationService.rename;
const originalSetArchivedConversation = taskConversationService.setArchived;
const originalIsPersistentConversation = taskConversationService.isPersistent;
const originalListRunning = taskSessionAdapter.listRunningConversationIds;
const originalIsRunning = taskSessionAdapter.isRunning;
const originalIsRunningAuthoritatively = taskSessionAdapter.isRunningAuthoritatively;
const originalSubscribeRuntime = taskSessionAdapter.subscribeToRuntimeProjections;
const originalStartTurn = taskSessionAdapter.startTurn;
const originalGetChapterSummaries = chapterSummaryService.getByNovelId;
const originalGetStartupSnapshot = startupCoordinator.getSnapshot;
const originalSubscribeStartup = startupCoordinator.subscribe;
const originalWaitForContextMigration = startupCoordinator.waitForContextMigration;
const originalGetToolManifest = productionToolRegistry.getManifest;
const originalProposeContextCompression = novelContextCompressionProvider.propose;
const originalInspectChapterAssets = chapterAssetReadinessService.inspect;
const originalApplyStructuredArtifact = artifactDecisionService.applyStructured;
const originalRecordArtifactDecision = artifactDecisionService.record;
const originalEnsureChapterSummaryFollowUp = artifactDecisionService.ensureChapterSummaryFollowUp;

const mockNovel: Novel = {
  id: 'novel-001',
  title: '天命修仙录',
  genre: '玄幻修真',
  description: '一部长篇仙侠修真小说',
  outline: '总纲',
  status: 'writing',
  protagonistMode: 'single',
  protagonists: [],
  dualProtagonistRelation: {
    type: 'partner',
    description: '',
    conflict: '',
    cooperation: '',
    emotionalProgression: '',
    narrativeWeight: 'balanced',
  },
  totalWordCount: 0,
  totalWords: 0,
  targetWordCount: 500000,
  targetWords: 500000,
  currentChapterId: 'chapter-001',
  volumes: [],
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const mockChapter: Chapter = {
  id: 'chapter-001',
  novelId: 'novel-001',
  title: '第一章：初入宗门',
  chapterNumber: 1,
  orderIndex: 0,
  sortOrder: 0,
  status: 'draft_generated',
  wordCount: 3000,
  currentWords: 3000,
  targetWords: 3000,
  drafts: [],
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const mockConversation: TaskConversation = {
  conversationId: 'conv-001',
  novelId: 'novel-001',
  title: '生成第一章大纲与正文',
  status: 'idle',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const mockBundle: TaskConversationBundle = {
  conversation: mockConversation,
  turns: [
    {
      turnId: 'turn-001',
      conversationId: 'conv-001',
      sequence: 1,
      role: 'user',
      content: '请生成下一章大纲',
      createdAt: '2026-08-20T00:00:00.000Z',
    },
  ],
  runs: [
    {
      runId: 'run-001',
      conversationId: 'conv-001',
      turnId: 'turn-001',
      workerId: 'worker-ans-1',
      status: 'completed',
      modelSnapshot: {
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock',
        capabilities: ['chat'],
        options: {},
        capturedAt: '2026-08-20T00:00:00.000Z',
      },
      startedAt: '2026-08-20T00:00:00.000Z',
      finishedAt: '2026-08-20T00:00:02.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:02.000Z',
    },
  ],
  toolEvents: [
    {
      eventId: 'evt-001',
      runId: 'run-001',
      sequence: 1,
      toolName: 'novel.read_context',
      argumentsSummary: { novelId: 'novel-001' },
      status: 'succeeded',
      durationMs: 42,
      createdAt: '2026-08-20T00:00:00.000Z',
      finishedAt: '2026-08-20T00:00:01.000Z',
    },
  ],
  artifacts: [],
};

function useBrowserMockModel(): void {
  localStorage.setItem(
    'ai_novel_studio_ai_settings',
    JSON.stringify({
      runtimeMode: 'mock',
      provider: 'mock',
      baseUrl: '',
      modelName: '',
      mockMode: true,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  window.sessionStorage.clear();
  novelRepository.getAll = async () => [mockNovel];
  chapterRepository.getByNovelId = async () => [mockChapter];
  taskConversationService.list = async () => [mockConversation];
  taskConversationService.get = async () => mockBundle;
  taskConversationService.create = async (novelId, title, defaultModel) => ({
    conversationId: 'conv-002',
    novelId,
    title: title || '新的创作任务',
    status: 'idle',
    defaultModel,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  });
  taskConversationService.createInitialized = async (novelId, goal, defaultModel) => ({
    conversation: {
      conversationId: 'conv-002',
      novelId,
      title: goal.slice(0, 40),
      status: 'idle',
      defaultModel,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    turn: {
      turnId: 'turn-002',
      conversationId: 'conv-002',
      sequence: 0,
      role: 'user',
      content: goal,
      createdAt: '2026-08-20T00:00:00.000Z',
    },
  });
  taskConversationService.rename = async (conversationId, title) => ({
    ...mockConversation,
    conversationId,
    title,
    updatedAt: '2026-08-20T00:00:01.000Z',
  });
  taskConversationService.setArchived = async (conversationId, archived) => ({
    ...mockConversation,
    conversationId,
    archivedAt: archived ? '2026-08-20T00:00:02.000Z' : undefined,
    updatedAt: '2026-08-20T00:00:02.000Z',
  });
  taskSessionAdapter.listRunningConversationIds = async () => [];
  taskSessionAdapter.isRunning = () => false;
  taskSessionAdapter.isRunningAuthoritatively = async () => false;
  taskSessionAdapter.subscribeToRuntimeProjections = async () => () => undefined;
  chapterSummaryService.getByNovelId = async () => [];
  chapterAssetReadinessService.inspect = async () => ({ ready: true, missingAssets: [] });
});

afterEach(() => {
  cleanup();
  novelRepository.getAll = originalGetAll;
  novelRepository.update = originalUpdateNovel;
  chapterRepository.getByNovelId = originalGetChapters;
  taskConversationService.list = originalListConversations;
  taskConversationService.get = originalGetConversation;
  taskConversationService.create = originalCreateConversation;
  taskConversationService.createInitialized = originalCreateInitializedConversation;
  taskConversationService.appendTurn = originalAppendConversationTurn;
  taskConversationService.rename = originalRenameConversation;
  taskConversationService.setArchived = originalSetArchivedConversation;
  taskConversationService.isPersistent = originalIsPersistentConversation;
  taskSessionAdapter.listRunningConversationIds = originalListRunning;
  taskSessionAdapter.isRunning = originalIsRunning;
  taskSessionAdapter.isRunningAuthoritatively = originalIsRunningAuthoritatively;
  taskSessionAdapter.subscribeToRuntimeProjections = originalSubscribeRuntime;
  taskSessionAdapter.startTurn = originalStartTurn;
  chapterSummaryService.getByNovelId = originalGetChapterSummaries;
  startupCoordinator.getSnapshot = originalGetStartupSnapshot;
  startupCoordinator.subscribe = originalSubscribeStartup;
  startupCoordinator.waitForContextMigration = originalWaitForContextMigration;
  productionToolRegistry.getManifest = originalGetToolManifest;
  novelContextCompressionProvider.propose = originalProposeContextCompression;
  chapterAssetReadinessService.inspect = originalInspectChapterAssets;
  artifactDecisionService.applyStructured = originalApplyStructuredArtifact;
  artifactDecisionService.record = originalRecordArtifactDecision;
  artifactDecisionService.ensureChapterSummaryFollowUp = originalEnsureChapterSummaryFollowUp;
});

test('WorkbenchPage keeps the workbench frame visible while projects load', async () => {
  let resolveProjects: (value: Novel[]) => void = () => undefined;
  novelRepository.getAll = () =>
    new Promise<Novel[]>((resolve) => {
      resolveProjects = resolve;
    });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  assert.ok(screen.getByTestId('creative-workbench'));
  assert.ok(screen.getByTestId('workbench-tree-loading'));
  assert.ok(screen.getByTestId('workbench-loading'));
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  assert.equal(composer.disabled, false);
  fireEvent.change(composer, { target: { value: '先记下这个创作方向' } });
  assert.equal(composer.value, '先记下这个创作方向');
  assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, true);

  resolveProjects([mockNovel]);
  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
  });
});

test('WorkbenchPage keeps the next draft editable while the selected task is running', async () => {
  let appendCount = 0;
  taskSessionAdapter.listRunningConversationIds = async () => [mockConversation.conversationId];
  taskSessionAdapter.isRunning = (conversationId) =>
    conversationId === mockConversation.conversationId;
  taskConversationService.appendTurn = async (...args) => {
    appendCount += 1;
    return originalAppendConversationTurn(...args);
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-stop-task')));
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  assert.equal(composer.disabled, false);

  fireEvent.change(composer, { target: { value: '下一章继续追查港口时间线' } });
  assert.equal(composer.value, '下一章继续追查港口时间线');
  fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
  assert.equal(appendCount, 0);
  assert.ok(screen.getByTestId('workbench-stop-task'));
});

test('Workbench resumes bundle projection refresh for a Rust task after renderer reload', async () => {
  let resolveRuntimeIds: (ids: string[]) => void = () => undefined;
  let currentBundle = mockBundle;
  taskSessionAdapter.listRunningConversationIds = () =>
    new Promise<string[]>((resolve) => {
      resolveRuntimeIds = resolve;
    });
  taskConversationService.get = async () => currentBundle;

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByText('请生成下一章大纲')));
  currentBundle = {
    ...mockBundle,
    conversation: { ...mockBundle.conversation, status: 'running' },
    turns: [
      ...mockBundle.turns,
      {
        turnId: 'turn-runtime-projection',
        conversationId: mockConversation.conversationId,
        sequence: 2,
        role: 'assistant',
        content: '恢复后的 Runtime 投影',
        runId: 'run-runtime-projection',
        createdAt: '2026-08-29T02:00:00.000Z',
      },
    ],
    runs: [
      ...mockBundle.runs,
      {
        ...mockBundle.runs[0],
        runId: 'run-runtime-projection',
        turnId: mockBundle.turns[0].turnId,
        status: 'running',
        finishedAt: undefined,
        updatedAt: '2026-08-29T02:00:00.000Z',
      },
    ],
  };

  await act(async () => {
    resolveRuntimeIds([mockConversation.conversationId]);
    await Promise.resolve();
  });

  await waitFor(() => assert.ok(screen.getByText('恢复后的 Runtime 投影')));
  assert.ok(screen.getByTestId('workbench-stop-task'));
});

test('Workbench retries native status discovery after a transient renderer IPC failure', async () => {
  let statusReads = 0;
  taskSessionAdapter.listRunningConversationIds = async () => {
    statusReads += 1;
    if (statusReads === 1) throw new Error('temporary IPC failure');
    return [mockConversation.conversationId];
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      assert.ok(statusReads >= 2);
      assert.ok(screen.getByTestId('workbench-stop-task'));
    },
    { timeout: 3_000 },
  );
});

test('Workbench re-subscribes to native projections and refreshes a recovered run through terminal state', async () => {
  type ProjectionListener = Parameters<typeof taskSessionAdapter.subscribeToRuntimeProjections>[0];
  let projectionListener: ProjectionListener | undefined;
  let runtimeIds = [mockConversation.conversationId];
  let currentBundle: TaskConversationBundle = {
    ...mockBundle,
    conversation: { ...mockBundle.conversation, status: 'running' },
    runs: [
      {
        ...mockBundle.runs[0],
        status: 'running',
        finishedAt: undefined,
        updatedAt: '2026-08-29T02:10:00.000Z',
      },
    ],
  };
  taskSessionAdapter.listRunningConversationIds = async () => runtimeIds;
  taskSessionAdapter.subscribeToRuntimeProjections = async (listener) => {
    projectionListener = listener;
    return () => undefined;
  };
  taskConversationService.get = async () => currentBundle;

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(projectionListener);
    assert.ok(screen.getByTestId('workbench-stop-task'));
  });

  runtimeIds = [];
  currentBundle = {
    ...currentBundle,
    conversation: { ...currentBundle.conversation, status: 'completed' },
    turns: [
      ...currentBundle.turns,
      {
        turnId: 'turn-runtime-terminal',
        conversationId: mockConversation.conversationId,
        sequence: 2,
        role: 'assistant',
        content: '原生运行已经可靠恢复到终态',
        runId: currentBundle.runs[0].runId,
        createdAt: '2026-08-29T02:11:00.000Z',
      },
    ],
    runs: [
      {
        ...currentBundle.runs[0],
        status: 'completed',
        finishedAt: '2026-08-29T02:11:00.000Z',
        updatedAt: '2026-08-29T02:11:00.000Z',
      },
    ],
  };

  await act(async () => {
    projectionListener?.({
      conversationId: mockConversation.conversationId,
      runId: currentBundle.runs[0].runId,
      kind: 'terminal',
      occurredAt: '2026-08-29T02:11:00.000Z',
    });
    await Promise.resolve();
  });

  await waitFor(() => {
    assert.ok(screen.getByText('原生运行已经可靠恢复到终态'));
    assert.equal(screen.queryByTestId('workbench-stop-task'), null);
  });
});

test('Workbench surfaces a rejected cancellation instead of silently ignoring it', async () => {
  taskSessionAdapter.listRunningConversationIds = async () => [mockConversation.conversationId];

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  const stop = await screen.findByTestId('workbench-stop-task');
  fireEvent.click(stop);

  await waitFor(() => {
    assert.match(
      screen.getByTestId('workbench-composer-error').textContent ?? '',
      /没有可取消的活动运行/,
    );
  });
});

test('Workbench disables retry during authoritative runtime preflight and reports a race', async () => {
  const failedBundle: TaskConversationBundle = {
    ...mockBundle,
    conversation: { ...mockBundle.conversation, status: 'failed' },
    runs: [
      {
        ...mockBundle.runs[0],
        status: 'failed',
        error: '上次运行失败',
        finishedAt: '2026-08-29T02:20:00.000Z',
        updatedAt: '2026-08-29T02:20:00.000Z',
      },
    ],
  };
  let resolveRuntimeState: (running: boolean) => void = () => undefined;
  taskConversationService.get = async () => failedBundle;
  taskSessionAdapter.isRunningAuthoritatively = () =>
    new Promise<boolean>((resolve) => {
      resolveRuntimeState = resolve;
    });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  const retry = (await screen.findByTestId('workbench-retry-turn')) as HTMLButtonElement;
  assert.equal(retry.disabled, false);
  fireEvent.click(retry);

  await waitFor(() => {
    assert.equal(retry.disabled, true);
    assert.equal(retry.title, '当前任务正在准备执行，请稍候。');
  });

  await act(async () => {
    resolveRuntimeState(true);
    await Promise.resolve();
  });
  await waitFor(() => {
    assert.match(
      screen.getByTestId('workbench-composer-error').textContent ?? '',
      /仍由 Runtime 执行/,
    );
  });
});

test('Workbench exposes apply-to-novel for a published context compression candidate', async () => {
  const compressionArtifact: TaskConversationBundle['artifacts'][number] = {
    cardId: 'card-context-compression',
    conversationId: mockConversation.conversationId,
    turnId: mockBundle.turns[0].turnId,
    runId: mockBundle.runs[0].runId,
    artifactId: 'artifact-context-compression',
    artifactType: 'generic_json',
    title: '小说上下文压缩',
    summary: '覆盖率通过',
    status: 'candidate',
    createdAt: '2026-08-28T00:00:00.000Z',
    artifactEvidence: {
      sourceNovelId: mockNovel.id,
      derivationType: 'context_compression',
      processingStatus: 'valid',
      validationIssues: [],
    },
  };
  let bundleReads = 0;
  taskConversationService.get = async () => {
    bundleReads += 1;
    return {
      ...mockBundle,
      artifacts: [compressionArtifact],
    };
  };
  let appliedArtifactId = '';
  artifactDecisionService.applyStructured = async (input) => {
    appliedArtifactId = input.artifactId;
    return {
      decision: {
        decisionId: 'decision-context-compression',
        artifactId: input.artifactId,
        artifactHash: 'hash-context-compression',
        cardId: input.cardId,
        conversationId: input.conversationId,
        decision: 'request_apply',
        idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
        actor: 'user',
        targetType: input.targetType,
        targetId: input.targetId,
        applyTransactionId: 'apply-context-compression',
        createdAt: '2026-08-28T00:00:01.000Z',
      },
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  const apply = await screen.findByTestId('workbench-artifact-apply');
  assert.equal(apply.textContent, '应用到作品');
  fireEvent.click(apply);
  await waitFor(() => {
    assert.equal(appliedArtifactId, 'artifact-context-compression');
    assert.ok(bundleReads >= 2);
    assert.equal(
      (screen.getByTestId('workbench-artifact-apply') as HTMLButtonElement).disabled,
      false,
    );
  });
});

test('WorkbenchPage keeps the draft editable and restores bundle without waiting for chapters', async () => {
  const restoredTargetChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-restored-target',
    title: '恢复目标章节',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
  };
  const restoredBundle: TaskConversationBundle = {
    ...mockBundle,
    toolEvents: [
      {
        ...mockBundle.toolEvents[0],
        argumentsSummary: { novelId: mockNovel.id, chapterId: restoredTargetChapter.id },
      },
    ],
  };
  let resolveProjects: (value: Novel[]) => void = () => undefined;
  let resolveConversations: (value: TaskConversation[]) => void = () => undefined;
  let resolveChapters: (value: Chapter[]) => void = () => undefined;
  let resolveBundle: (value: TaskConversationBundle | null) => void = () => undefined;
  let chapterRequests = 0;
  let bundleRequests = 0;

  novelRepository.getAll = () =>
    new Promise<Novel[]>((resolve) => {
      resolveProjects = resolve;
    });
  taskConversationService.list = () =>
    new Promise<TaskConversation[]>((resolve) => {
      resolveConversations = resolve;
    });
  chapterRepository.getByNovelId = () => {
    chapterRequests += 1;
    return new Promise<Chapter[]>((resolve) => {
      resolveChapters = resolve;
    });
  };
  taskConversationService.get = () => {
    bundleRequests += 1;
    return new Promise<TaskConversationBundle | null>((resolve) => {
      resolveBundle = resolve;
    });
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  const initialComposer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  fireEvent.change(initialComposer, { target: { value: '你能做什么？' } });
  assert.equal(initialComposer.disabled, false);
  assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, true);

  await act(async () => resolveProjects([mockNovel]));
  await waitFor(() => assert.ok(screen.getAllByText(mockNovel.title).length > 0));
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '你能做什么？',
  );
  assert.equal(bundleRequests, 0);

  await act(async () => resolveConversations([mockConversation]));
  await waitFor(() => {
    assert.equal(chapterRequests, 1);
    assert.equal(bundleRequests, 1);
    assert.ok(screen.getByTestId('workbench-bundle-loading'));
  });
  const restoringComposer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  assert.equal(restoringComposer.value, '你能做什么？');
  assert.equal(restoringComposer.disabled, false);
  assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, true);

  await act(async () => resolveBundle(restoredBundle));
  await waitFor(() => {
    assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, false);
  });
  assert.match(screen.getByTestId('workbench-chapter-target').textContent ?? '', /正在读取章节/);
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '你能做什么？',
  );

  await act(async () => resolveChapters([mockChapter, restoredTargetChapter]));
  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      restoredTargetChapter.id,
    );
  });
});

test('WorkbenchPage preserves an explicit project selection while startup conversations recover', async () => {
  const secondNovel: Novel = {
    ...mockNovel,
    id: 'novel-002',
    title: '雾海纪事',
    currentChapterId: 'chapter-002',
  };
  const secondChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    novelId: secondNovel.id,
    title: '雾港来信',
  };
  const latestConversation: TaskConversation = {
    ...mockConversation,
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
  const secondConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-002',
    novelId: secondNovel.id,
    title: '追查雾港来信',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
  let resolveConversations: (value: TaskConversation[]) => void = () => undefined;

  novelRepository.getAll = async () => [mockNovel, secondNovel];
  taskConversationService.list = () =>
    new Promise<TaskConversation[]>((resolve) => {
      resolveConversations = resolve;
    });
  chapterRepository.getByNovelId = async (novelId) =>
    novelId === secondNovel.id ? [secondChapter] : [mockChapter];
  taskConversationService.get = async (conversationId) => {
    const conversation =
      conversationId === secondConversation.conversationId
        ? secondConversation
        : latestConversation;
    return {
      ...mockBundle,
      conversation,
      turns: [],
      runs: [],
      toolEvents: [],
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.equal(screen.getAllByTestId('workbench-project').length, 2));
  const secondProject = screen
    .getAllByTestId('workbench-project')
    .find((item) => item.dataset.novelId === secondNovel.id);
  assert.ok(secondProject);
  fireEvent.click(secondProject);
  await waitFor(() => assert.equal(secondProject.dataset.selected, 'true'));

  await act(async () => resolveConversations([latestConversation, secondConversation]));

  await waitFor(() => {
    assert.equal(secondProject.dataset.selected, 'true');
    assert.equal(
      screen.getByTestId('workbench-task-header').dataset.conversationId,
      secondConversation.conversationId,
    );
    const selectedTask = screen
      .getAllByTestId('workbench-task')
      .find((item) => item.dataset.conversationId === secondConversation.conversationId);
    assert.equal(selectedTask?.dataset.selected, 'true');
  });
});

test('WorkbenchPage ignores late initial chapters after switching projects', async () => {
  const secondNovel: Novel = {
    ...mockNovel,
    id: 'novel-002',
    title: '雾海纪事',
    currentChapterId: 'chapter-002',
  };
  const secondChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    novelId: secondNovel.id,
    title: '雾港来信',
  };
  const latestConversation: TaskConversation = {
    ...mockConversation,
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
  const secondConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-002',
    novelId: secondNovel.id,
    title: '追查雾港来信',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
  let resolveInitialChapters: (value: Chapter[]) => void = () => undefined;
  let resolveSecondChapters: (value: Chapter[]) => void = () => undefined;
  let initialChapterRequests = 0;
  let secondChapterRequests = 0;
  let initialChapterResponseDelivered = false;

  novelRepository.getAll = async () => [mockNovel, secondNovel];
  taskConversationService.list = async () => [latestConversation, secondConversation];
  chapterRepository.getByNovelId = (novelId) => {
    if (novelId === secondNovel.id) {
      secondChapterRequests += 1;
      return new Promise<Chapter[]>((resolve) => {
        resolveSecondChapters = resolve;
      });
    }
    initialChapterRequests += 1;
    return new Promise<Chapter[]>((resolve) => {
      resolveInitialChapters = (chapters) => {
        initialChapterResponseDelivered = true;
        resolve(chapters);
      };
    });
  };
  taskConversationService.get = async (conversationId) => {
    const conversation =
      conversationId === secondConversation.conversationId
        ? secondConversation
        : latestConversation;
    return {
      ...mockBundle,
      conversation,
      turns: [],
      runs: [],
      toolEvents: [],
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.equal(initialChapterRequests, 1));
  const secondProject = screen
    .getAllByTestId('workbench-project')
    .find((item) => item.dataset.novelId === secondNovel.id);
  assert.ok(secondProject);
  fireEvent.click(secondProject);
  await waitFor(() => assert.equal(secondChapterRequests, 1));

  await act(async () => resolveSecondChapters([secondChapter]));
  await waitFor(() => {
    assert.equal(secondProject.dataset.selected, 'true');
    assert.equal(
      screen.getByTestId('workbench-task-header').dataset.conversationId,
      secondConversation.conversationId,
    );
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      secondChapter.id,
    );
  });

  await act(async () => {
    resolveInitialChapters([mockChapter]);
    await Promise.resolve();
  });
  await waitFor(() => assert.equal(initialChapterResponseDelivered, true));

  assert.equal(secondProject.dataset.selected, 'true');
  assert.equal(
    screen.getByTestId('workbench-task-header').dataset.conversationId,
    secondConversation.conversationId,
  );
  assert.equal(
    (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
    secondChapter.id,
  );
});

test('WorkbenchPage preserves a startup draft when the project has no existing tasks', async () => {
  taskConversationService.list = async () => [];

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  const startupComposer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  fireEvent.change(startupComposer, { target: { value: '先写一个六万字悬疑故事' } });

  await waitFor(() => assert.ok(screen.getByTestId('workbench-create-empty-task')));
  assert.equal(screen.queryByText('任务恢复中，草稿会保留'), null);
  assert.ok(screen.getByText('请先新建创作任务'));
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '先写一个六万字悬疑故事',
  );

  fireEvent.click(screen.getByTestId('workbench-create-empty-task'));
  const taskGoal = await screen.findByTestId('workbench-new-task-goal');
  assert.equal((taskGoal as HTMLTextAreaElement).value, '先写一个六万字悬疑故事');
  assert.equal((taskGoal as HTMLTextAreaElement).disabled, false);
  assert.equal((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled, false);
});

test('WorkbenchPage separates a project read failure from the empty-project state', async () => {
  novelRepository.getAll = async () => {
    throw new Error('项目存储暂不可用');
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('项目存储暂不可用').length > 0);
  });
  assert.equal(screen.queryByTestId('workbench-no-projects'), null);
});

test('WorkbenchPage renders novel title, task list, and templates', async () => {
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
    assert.ok(screen.getAllByText('生成第一章大纲与正文').length > 0);
  });
  assert.ok(screen.getByTestId('workbench-task').querySelector('time'));

  // Select the task to open conversation view
  fireEvent.click(screen.getByTestId('workbench-task'));

  await waitFor(() => {
    assert.ok(screen.getByText('生成下一章'));
    assert.ok(screen.getByText('章节审计'));
    assert.ok(screen.getByText('完善大纲'));
    assert.ok(screen.getByText('人物一致性审计'));
    assert.ok(screen.getByText('推演事件'));
    assert.ok(screen.getByText('整理设定'));
    assert.ok(screen.getByText('润色候选'));
  });
});

test('WorkbenchPage clicking a task template fills the input draft', async () => {
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
    assert.ok(screen.getAllByText('生成第一章大纲与正文').length > 0);
  });

  // Select the task to open conversation view
  fireEvent.click(screen.getByTestId('workbench-task'));

  await waitFor(() => {
    assert.ok(screen.getByText('生成下一章'));
  });

  const templateButton = screen.getByText('生成下一章');
  fireEvent.click(templateButton);

  await waitFor(() => {
    const textarea = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
    assert.equal(textarea.value, '生成下一章');
  });

  fireEvent.click(screen.getByText('完善大纲'));
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '完善当前章节大纲',
  );

  fireEvent.click(screen.getByText('人物一致性审计'));
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '审计本章已采用正文的人物一致性',
  );

  fireEvent.click(screen.getByText('推演事件'));
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '生成本章剧情事件候选',
  );
});

test('WorkbenchPage identifies automatic asset preparation turns without presenting them as the user', async () => {
  const automaticGoal = '生成世界设定候选。创意依据：永夜城正在失去时间。';
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [
      {
        ...mockBundle.turns[0],
        content: encodeWorkbenchTurnContent(automaticGoal, 'workbench_asset_preparation'),
      },
    ],
  });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByText('系统步骤')));
  const turn = screen.getByTestId('workbench-turn');
  assert.equal(turn.dataset.role, 'system');
  assert.equal(turn.dataset.storedRole, 'user');
  assert.equal(turn.dataset.origin, 'workbench_asset_preparation');
  assert.match(turn.textContent ?? '', /自动准备/);
  assert.equal(screen.getByTestId('workbench-system-step').textContent, '准备世界设定');
  assert.doesNotMatch(turn.textContent ?? '', new RegExp(automaticGoal));
  assert.doesNotMatch(turn.textContent ?? '', /永夜城正在失去时间/);
  assert.doesNotMatch(turn.textContent ?? '', /ANS_WORKBENCH_TURN/);
  assert.equal(turn.querySelector('.workbench-turn-meta')?.textContent?.includes('你'), false);
});

test('WorkbenchPage identifies automatic chapter summaries without presenting them as the user', async () => {
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [
      {
        ...mockBundle.turns[0],
        content: encodeWorkbenchTurnContent('总结本章', 'workbench_chapter_summary'),
      },
    ],
  });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByText('系统步骤')));
  const turn = screen.getByTestId('workbench-turn');
  assert.equal(turn.dataset.role, 'system');
  assert.equal(turn.dataset.storedRole, 'user');
  assert.equal(turn.dataset.origin, 'workbench_chapter_summary');
  assert.match(turn.textContent ?? '', /自动总结/);
  assert.match(turn.textContent ?? '', /总结本章/);
  assert.doesNotMatch(turn.textContent ?? '', /ANS_WORKBENCH_TURN/);
  assert.equal(turn.querySelector('.workbench-turn-meta')?.textContent?.includes('你'), false);
});

test('Workbench starts an automatic summary after the persisted-turn ensure lock is released', async () => {
  useBrowserMockModel();
  const fixedModel = {
    providerId: 'mock',
    modelId: 'Mock',
    runtimeMode: 'mock' as const,
    capabilities: ['chat'],
    options: {},
    capturedAt: '2026-08-29T00:00:00.000Z',
  };
  const authorizationId = 'review-summary-ensure-race';
  const summaryTurnId = `summary-generation-${authorizationId}`;
  const adoptedChapter = {
    ...mockChapter,
    status: 'adopted' as const,
    adoptedDraftId: 'draft-adopted',
  };
  let currentBundle: TaskConversationBundle = {
    conversation: { ...mockConversation, defaultModel: fixedModel },
    turns: [...mockBundle.turns],
    runs: [...mockBundle.runs],
    toolEvents: [...mockBundle.toolEvents],
    artifacts: [],
    authorizations: [
      {
        authorizationId,
        decisionId: 'decision-summary-ensure-race',
        artifactId: 'artifact-summary-ensure-race',
        novelId: mockNovel.id,
        chapterId: adoptedChapter.id,
        status: 'consumed',
        issuedAt: '2026-08-29T00:00:30.000Z',
        consumedAt: '2026-08-29T00:00:45.000Z',
        consumedByDraftId: adoptedChapter.adoptedDraftId,
      },
    ],
  };
  let releaseEnsure: () => void = () => undefined;
  let ensureStarted = false;
  const ensureGate = new Promise<void>((resolve) => {
    releaseEnsure = () => resolve();
  });
  type ProjectionListener = Parameters<typeof taskSessionAdapter.subscribeToRuntimeProjections>[0];
  let projectionListener: ProjectionListener | undefined;
  let startCount = 0;

  chapterRepository.getByNovelId = async () => [adoptedChapter];
  taskConversationService.get = async () => currentBundle;
  taskConversationService.isPersistent = () => true;
  taskSessionAdapter.subscribeToRuntimeProjections = async (listener) => {
    projectionListener = listener;
    return () => undefined;
  };
  artifactDecisionService.ensureChapterSummaryFollowUp = async () => {
    ensureStarted = true;
    currentBundle = {
      ...currentBundle,
      turns: [
        ...currentBundle.turns,
        {
          turnId: summaryTurnId,
          conversationId: mockConversation.conversationId,
          sequence: 2,
          role: 'user',
          content: encodeWorkbenchTurnContent('总结本章', 'workbench_chapter_summary'),
          createdAt: '2026-08-29T00:01:00.000Z',
        },
      ],
    };
    await ensureGate;
    return {
      status: 'pending_generation',
      nextAction: 'summarize_chapter',
      instruction: '总结本章',
      chapterId: adoptedChapter.id,
      adoptedDraftId: adoptedChapter.adoptedDraftId,
    };
  };
  taskSessionAdapter.startTurn = async (input) => {
    startCount += 1;
    const completed = {
      ...mockBundle.runs[0],
      runId: 'run-summary-ensure-race',
      turnId: input.turnId,
      chapterId: input.chapterId,
      modelSnapshot: input.modelSnapshot!,
    };
    currentBundle = { ...currentBundle, runs: [...currentBundle.runs, completed] };
    return completed;
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(ensureStarted && projectionListener));
  await act(async () => {
    projectionListener?.({
      conversationId: mockConversation.conversationId,
      runId: mockBundle.runs[0].runId,
      kind: 'terminal',
      occurredAt: '2026-08-29T00:01:10.000Z',
    });
  });
  await screen.findByText('系统步骤');
  await act(async () => releaseEnsure());
  await waitFor(() => assert.equal(startCount, 1));
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  assert.equal(startCount, 1);
});

test('Workbench rechecks a startable automatic summary after runtime occupancy clears', async () => {
  useBrowserMockModel();
  const fixedModel = {
    providerId: 'mock',
    modelId: 'Mock',
    runtimeMode: 'mock' as const,
    capabilities: ['chat'],
    options: {},
    capturedAt: '2026-08-29T00:00:00.000Z',
  };
  const authorizationId = 'review-summary-runtime-release';
  const summaryTurnId = `summary-generation-${authorizationId}`;
  const adoptedChapter = {
    ...mockChapter,
    status: 'adopted' as const,
    adoptedDraftId: 'draft-adopted',
  };
  let currentBundle: TaskConversationBundle = {
    conversation: { ...mockConversation, defaultModel: fixedModel },
    turns: [
      ...mockBundle.turns,
      {
        turnId: summaryTurnId,
        conversationId: mockConversation.conversationId,
        sequence: 2,
        role: 'user',
        content: encodeWorkbenchTurnContent('总结本章', 'workbench_chapter_summary'),
        createdAt: '2026-08-29T00:01:00.000Z',
      },
    ],
    runs: [...mockBundle.runs],
    toolEvents: [...mockBundle.toolEvents],
    artifacts: [],
    authorizations: [
      {
        authorizationId,
        decisionId: 'decision-summary-runtime-release',
        artifactId: 'artifact-summary-runtime-release',
        novelId: mockNovel.id,
        chapterId: adoptedChapter.id,
        status: 'consumed',
        issuedAt: '2026-08-29T00:00:30.000Z',
        consumedAt: '2026-08-29T00:00:45.000Z',
        consumedByDraftId: adoptedChapter.adoptedDraftId,
      },
    ],
  };
  let runtimeOccupied = true;
  let startCount = 0;

  chapterRepository.getByNovelId = async () => [adoptedChapter];
  taskConversationService.get = async () => currentBundle;
  taskConversationService.isPersistent = () => true;
  taskSessionAdapter.isRunning = () => runtimeOccupied;
  taskSessionAdapter.startTurn = async (input) => {
    startCount += 1;
    const completed = {
      ...mockBundle.runs[0],
      runId: 'run-summary-runtime-release',
      turnId: input.turnId,
      chapterId: input.chapterId,
      modelSnapshot: input.modelSnapshot!,
    };
    currentBundle = { ...currentBundle, runs: [...currentBundle.runs, completed] };
    return completed;
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await screen.findByText('系统步骤');
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
  assert.equal(startCount, 0);
  await act(async () => {
    runtimeOccupied = false;
  });
  await waitFor(() => assert.equal(startCount, 1), { timeout: 3_000 });
});

test('Workbench bounds pre-run automatic summary recovery and exposes a manual retry', async () => {
  useBrowserMockModel();
  const fixedModel = {
    providerId: 'mock',
    modelId: 'Mock',
    runtimeMode: 'mock' as const,
    capabilities: ['chat'],
    options: {},
    capturedAt: '2026-08-29T00:00:00.000Z',
  };
  const authorizationId = 'review-summary-preflight';
  const summaryTurnId = `summary-generation-${authorizationId}`;
  const adoptedChapter = {
    ...mockChapter,
    status: 'adopted' as const,
    adoptedDraftId: 'draft-adopted',
  };
  const summaryBundle: TaskConversationBundle = {
    conversation: { ...mockConversation, defaultModel: fixedModel },
    turns: [
      ...mockBundle.turns,
      {
        turnId: summaryTurnId,
        conversationId: mockConversation.conversationId,
        sequence: 2,
        role: 'user',
        content: encodeWorkbenchTurnContent('总结本章', 'workbench_chapter_summary'),
        createdAt: '2026-08-29T00:01:00.000Z',
      },
    ],
    runs: mockBundle.runs,
    toolEvents: mockBundle.toolEvents,
    artifacts: [],
    authorizations: [
      {
        authorizationId,
        decisionId: 'decision-summary-preflight',
        artifactId: 'artifact-summary-preflight',
        novelId: mockNovel.id,
        chapterId: adoptedChapter.id,
        status: 'consumed',
        issuedAt: '2026-08-29T00:00:30.000Z',
        consumedAt: '2026-08-29T00:00:45.000Z',
        consumedByDraftId: adoptedChapter.adoptedDraftId,
      },
    ],
  };
  chapterRepository.getByNovelId = async () => [adoptedChapter];
  taskConversationService.get = async () => summaryBundle;
  taskConversationService.isPersistent = () => true;
  let startCount = 0;
  taskSessionAdapter.startTurn = async () => {
    startCount += 1;
    throw new Error('MODEL_TOOL_ATTESTATION_TEMPORARY_FAILURE');
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.equal(startCount, 2));
  const retry = await screen.findByRole('button', { name: '重试章节总结' });
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  assert.equal(startCount, 2);

  fireEvent.click(retry);
  await waitFor(() => assert.ok(startCount > 2));
});

test('Workbench automatically sequences missing assets while keeping every apply decision manual', async () => {
  useBrowserMockModel();
  const sparseGoal = '写一个失忆钟表匠在永夜城追查时间失窃案的第一章正文';
  type MissingAsset = 'world_setting' | 'protagonist' | 'chapter_outline';
  let missingAssets: MissingAsset[] = ['world_setting', 'protagonist', 'chapter_outline'];
  const appendedGoals: string[] = [];
  const startedGoals: string[] = [];
  const turns: TaskConversationBundle['turns'] = [];
  const runs: TaskConversationBundle['runs'] = [];
  const artifacts: TaskConversationBundle['artifacts'] = [];
  const decisions: NonNullable<TaskConversationBundle['decisions']> = [];
  const assetContract: Record<
    MissingAsset,
    { instruction: string; artifactType: 'setting_candidates' | 'character_candidates' | 'outline' }
  > = {
    world_setting: {
      instruction: '生成世界与规则设定候选',
      artifactType: 'setting_candidates',
    },
    protagonist: {
      instruction: '生成主角候选',
      artifactType: 'character_candidates',
    },
    chapter_outline: { instruction: '生成本章大纲候选', artifactType: 'outline' },
  };
  chapterAssetReadinessService.inspect = async () => ({
    ready: missingAssets.length === 0,
    missingAssets: [...missingAssets],
  });
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    appendedGoals.push(content ?? '');
    const turn = {
      turnId: `turn-asset-${appendedGoals.length}`,
      conversationId,
      sequence: mockBundle.turns.length + appendedGoals.length,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
    turns.push(turn);
    return turn;
  };
  taskSessionAdapter.startTurn = async (input) => {
    startedGoals.push(input.goal);
    const run = {
      ...mockBundle.runs[0],
      runId: `run-asset-${startedGoals.length}`,
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
    runs.push(run);
    const asset = (Object.keys(assetContract) as MissingAsset[]).find((key) =>
      input.goal.startsWith(assetContract[key].instruction),
    );
    if (asset) {
      artifacts.push({
        cardId: `card-${asset}`,
        conversationId: input.conversationId,
        turnId: input.turnId,
        runId: run.runId,
        artifactId: `artifact-${asset}`,
        artifactType: assetContract[asset].artifactType,
        title: `${assetContract[asset].instruction}`,
        summary: '等待确认应用',
        status: 'candidate',
        createdAt: '2026-08-20T00:00:04.000Z',
        artifactEvidence: {
          sourceNovelId: mockNovel.id,
          sourceChapterId: mockChapter.id,
          processingStatus: 'valid',
          validationIssues: [],
        },
      });
    }
    return run;
  };
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [...mockBundle.turns, ...turns],
    runs: [...mockBundle.runs, ...runs],
    artifacts: [...artifacts],
    decisions: [...decisions],
  });
  artifactDecisionService.applyStructured = async (input) => {
    const artifact = artifacts.find((item) => item.artifactId === input.artifactId)!;
    const decision = {
      decisionId: `decision-${input.artifactId}`,
      artifactId: input.artifactId,
      artifactHash: `hash-${input.artifactId}`,
      cardId: input.cardId,
      conversationId: input.conversationId,
      decision: 'request_apply' as const,
      idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
      actor: 'user',
      targetType: input.targetType,
      targetId: input.targetId,
      applyTransactionId: `apply-${input.artifactId}`,
      createdAt: '2026-08-20T00:00:05.000Z',
    };
    decisions.push(decision);
    artifact.latestDecision = decision;
    missingAssets = missingAssets.slice(1);
    return { decision };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-001');
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      mockChapter.id,
    );
  });
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: sparseGoal } });
  const send = screen.getByTestId('workbench-send-task') as HTMLButtonElement;
  await waitFor(() => assert.equal(send.disabled, false));
  fireEvent.click(send);

  await waitFor(() => assert.ok(screen.getByTestId('workbench-asset-readiness')));
  await waitFor(() => assert.equal(startedGoals.length, 1));
  assert.equal(composer.value, sparseGoal);
  assert.ok(screen.getByTestId('workbench-missing-asset-world_setting'));
  assert.ok(screen.getByTestId('workbench-missing-asset-protagonist'));
  assert.ok(screen.getByTestId('workbench-missing-asset-chapter_outline'));
  assert.equal(
    screen.getByTestId('workbench-missing-asset-world_setting').dataset.assetState,
    'current',
  );
  assert.equal(
    screen.getByTestId('workbench-missing-asset-protagonist').dataset.assetState,
    'queued',
  );
  assert.equal(
    (screen.getByTestId('workbench-generate-asset-protagonist') as HTMLButtonElement).disabled,
    true,
  );
  await waitFor(() => {
    const readiness = screen.getByTestId('workbench-asset-readiness');
    assert.equal(readiness.dataset.orchestrationPhase, 'awaiting_apply', readiness.textContent);
  });
  assert.equal(
    (screen.getByTestId('workbench-generate-asset-world_setting') as HTMLButtonElement).disabled,
    true,
  );
  assert.equal(startedGoals.length, 1);
  let applyButtons = screen.getAllByTestId('workbench-artifact-apply');
  fireEvent.click(applyButtons[applyButtons.length - 1]!);

  await waitFor(() => assert.equal(startedGoals.length, 2));
  await waitFor(() => assert.ok(screen.getByTestId('workbench-missing-asset-protagonist')));
  assert.ok(screen.getByTestId('workbench-missing-asset-chapter_outline'));
  assert.equal(
    screen.getByTestId('workbench-missing-asset-protagonist').dataset.assetState,
    'current',
  );
  assert.equal(
    (screen.getByTestId('workbench-generate-asset-chapter_outline') as HTMLButtonElement).disabled,
    true,
  );

  await waitFor(() => {
    const readiness = screen.getByTestId('workbench-asset-readiness');
    assert.equal(readiness.dataset.orchestrationPhase, 'awaiting_apply', readiness.textContent);
  });
  assert.equal(startedGoals.length, 2);
  applyButtons = screen.getAllByTestId('workbench-artifact-apply');
  fireEvent.click(applyButtons[applyButtons.length - 1]!);

  await waitFor(() => assert.equal(startedGoals.length, 3));
  await waitFor(() => assert.ok(screen.getByTestId('workbench-missing-asset-chapter_outline')));
  assert.equal(appendedGoals.length, 4);
  assert.equal(appendedGoals[0], sparseGoal);
  assert.deepEqual(decodeWorkbenchTurnContent(appendedGoals[1]), {
    content: buildCoreAssetGenerationGoal('world_setting', sparseGoal),
    origin: 'workbench_asset_preparation',
  });
  assert.deepEqual(decodeWorkbenchTurnContent(appendedGoals[2]), {
    content: buildCoreAssetGenerationGoal('protagonist', sparseGoal),
    origin: 'workbench_asset_preparation',
  });
  assert.deepEqual(decodeWorkbenchTurnContent(appendedGoals[3]), {
    content: buildCoreAssetGenerationGoal('chapter_outline', sparseGoal),
    origin: 'workbench_asset_preparation',
  });
  assert.equal(composer.value, sparseGoal);

  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'awaiting_apply',
    );
  });
  assert.equal(startedGoals.length, 3);
  applyButtons = screen.getAllByTestId('workbench-artifact-apply');
  fireEvent.click(applyButtons[applyButtons.length - 1]!);

  await waitFor(() => assert.equal(startedGoals.length, 4));
  assert.equal(startedGoals[3], sparseGoal);
  assert.equal(appendedGoals.filter((goal) => goal === sparseGoal).length, 1);
  await waitFor(() => assert.equal(screen.queryByTestId('workbench-asset-readiness'), null));
  assert.equal(composer.value, '');
  assert.equal(decisions.length, 3);
});

test('Workbench does not regenerate an awaiting candidate after a session remount', async () => {
  useBrowserMockModel();
  let startedRuns = 0;
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    modelSnapshot: mockBundle.runs[0].modelSnapshot,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'world_setting',
      preparationTurnId: 'turn-world-persisted',
      preparationRunId: 'run-world-persisted',
      candidateArtifactId: 'artifact-world-persisted',
      updatedAt: '2026-08-20T00:00:03.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:03.000Z',
  });
  taskConversationService.get = async () => ({
    ...mockBundle,
    runs: [
      ...mockBundle.runs,
      {
        ...mockBundle.runs[0],
        runId: 'run-world-persisted',
        turnId: 'turn-world-persisted',
      },
    ],
    artifacts: [
      {
        cardId: 'card-world-persisted',
        conversationId: mockConversation.conversationId,
        turnId: 'turn-world-persisted',
        runId: 'run-world-persisted',
        artifactId: 'artifact-world-persisted',
        artifactType: 'setting_candidates',
        title: '世界设定候选',
        summary: '等待确认应用',
        status: 'candidate',
        createdAt: '2026-08-20T00:00:02.000Z',
        artifactEvidence: {
          sourceNovelId: mockNovel.id,
          processingStatus: 'valid',
          validationIssues: [],
        },
      },
    ],
  });
  taskSessionAdapter.startTurn = async (...args) => {
    startedRuns += 1;
    return originalStartTurn(...args);
  };

  const first = render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'awaiting_apply',
    );
  });
  assert.equal(startedRuns, 0);
  first.unmount();

  const second = render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'awaiting_apply',
    );
  });
  assert.equal(startedRuns, 0);
  fireEvent.click(screen.getByTestId('workbench-dismiss-asset-readiness'));
  await waitFor(() => assert.equal(screen.queryByTestId('workbench-asset-readiness'), null));
  second.unmount();

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  await waitFor(() => assert.ok(screen.getByTestId('workbench-task-header')));
  assert.equal(screen.queryByTestId('workbench-asset-readiness'), null);
  assert.equal(startedRuns, 0);
});

test('Workbench converts an interrupted persisted generation into explicit retry', async () => {
  useBrowserMockModel();
  let startedRuns = 0;
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    modelSnapshot: mockBundle.runs[0].modelSnapshot,
    orchestration: {
      phase: 'generating',
      asset: 'world_setting',
      preparationTurnId: 'turn-world-interrupted',
      preparationRunId: 'run-world-interrupted',
      updatedAt: '2026-08-20T00:00:03.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:03.000Z',
  });
  taskConversationService.get = async () => ({
    ...mockBundle,
    runs: [
      ...mockBundle.runs,
      {
        ...mockBundle.runs[0],
        runId: 'run-world-interrupted',
        turnId: 'turn-world-interrupted',
        status: 'running',
        finishedAt: undefined,
      },
    ],
  });
  taskSessionAdapter.startTurn = async (...args) => {
    startedRuns += 1;
    return originalStartTurn(...args);
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'failed',
    );
  });
  assert.equal(startedRuns, 0);
  const retry = screen.getByTestId('workbench-generate-asset-world_setting') as HTMLButtonElement;
  assert.equal(retry.disabled, false);
  assert.match(retry.textContent ?? '', /重试/);
});

test('Workbench releases an awaiting state whose persisted candidate is missing', async () => {
  useBrowserMockModel();
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    modelSnapshot: mockBundle.runs[0].modelSnapshot,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'world_setting',
      preparationTurnId: 'turn-world-missing',
      preparationRunId: 'run-world-missing',
      candidateArtifactId: 'artifact-world-missing',
      updatedAt: '2026-08-20T00:00:03.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:03.000Z',
  });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'failed',
    );
  });
  assert.match(screen.getByTestId('workbench-asset-readiness').textContent ?? '', /无法读取/);
});

test('Workbench keeps a failed automatic preparation idle until explicit retry', async () => {
  useBrowserMockModel();
  let startedRuns = 0;
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    modelSnapshot: mockBundle.runs[0].modelSnapshot,
    orchestration: {
      phase: 'failed',
      asset: 'world_setting',
      error: 'Provider 暂时不可用',
      updatedAt: '2026-08-20T00:00:03.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:03.000Z',
  });
  taskConversationService.appendTurn = async (conversationId, role, content) => ({
    turnId: 'turn-world-retry',
    conversationId,
    sequence: 2,
    role,
    content,
    createdAt: '2026-08-20T00:00:04.000Z',
  });
  taskSessionAdapter.startTurn = async (input) => {
    startedRuns += 1;
    return {
      ...mockBundle.runs[0],
      runId: 'run-world-retry',
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  const retry = await screen.findByTestId('workbench-generate-asset-world_setting');
  assert.match(retry.textContent ?? '', /重试/);
  assert.equal(startedRuns, 0);
  fireEvent.click(retry);
  await waitFor(() => assert.equal(startedRuns, 1));
});

test('Workbench turns a rejected preparation candidate into explicit retry', async () => {
  useBrowserMockModel();
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    modelSnapshot: mockBundle.runs[0].modelSnapshot,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'world_setting',
      preparationTurnId: 'turn-world-rejected',
      preparationRunId: 'run-world-rejected',
      candidateArtifactId: 'artifact-world-rejected',
      updatedAt: '2026-08-20T00:00:03.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:03.000Z',
  });
  const artifact: TaskConversationBundle['artifacts'][number] = {
    cardId: 'card-world-rejected',
    conversationId: mockConversation.conversationId,
    turnId: 'turn-world-rejected',
    runId: 'run-world-rejected',
    artifactId: 'artifact-world-rejected',
    artifactType: 'setting_candidates',
    title: '世界设定候选',
    summary: '等待确认应用',
    status: 'candidate',
    createdAt: '2026-08-20T00:00:02.000Z',
    artifactEvidence: {
      sourceNovelId: mockNovel.id,
      processingStatus: 'valid',
      validationIssues: [],
    },
  };
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [
      ...mockBundle.turns,
      {
        turnId: 'turn-world-rejected',
        conversationId: mockConversation.conversationId,
        sequence: 2,
        role: 'user',
        content: encodeWorkbenchTurnContent(
          '生成世界与规则设定候选。创意依据：生成本章正文',
          'workbench_asset_preparation',
        ),
        createdAt: '2026-08-20T00:00:01.000Z',
      },
    ],
    runs: [
      ...mockBundle.runs,
      {
        ...mockBundle.runs[0],
        runId: 'run-world-rejected',
        turnId: 'turn-world-rejected',
      },
    ],
    artifacts: [artifact],
  });
  artifactDecisionService.record = async (input) => ({
    decision: {
      decisionId: 'decision-world-rejected',
      artifactId: input.artifactId,
      artifactHash: 'hash-world-rejected',
      cardId: input.cardId,
      conversationId: input.conversationId,
      decision: input.decision,
      idempotencyKey: `${input.cardId}:${input.decision}`,
      actor: 'user',
      targetType: input.targetType,
      targetId: input.targetId,
      createdAt: '2026-08-20T00:00:04.000Z',
    },
  });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  const reject = await screen.findByTestId('workbench-artifact-reject');
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'awaiting_apply',
    );
  });
  fireEvent.click(reject);
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'failed',
    );
  });
  assert.match(screen.getByTestId('workbench-asset-readiness').textContent ?? '', /已拒绝/);
});

test('Workbench releases an applied candidate that did not satisfy the same readiness gate', async () => {
  useBrowserMockModel();
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    modelSnapshot: mockBundle.runs[0].modelSnapshot,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'world_setting',
      preparationTurnId: 'turn-world-incomplete',
      preparationRunId: 'run-world-incomplete',
      candidateArtifactId: 'artifact-world-incomplete',
      updatedAt: '2026-08-20T00:00:03.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:03.000Z',
  });
  chapterAssetReadinessService.inspect = async () => ({
    ready: false,
    missingAssets: ['world_setting'],
  });
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [
      ...mockBundle.turns,
      {
        turnId: 'turn-world-incomplete',
        conversationId: mockConversation.conversationId,
        sequence: 2,
        role: 'user',
        content: encodeWorkbenchTurnContent(
          '生成世界与规则设定候选。创意依据：生成本章正文',
          'workbench_asset_preparation',
        ),
        createdAt: '2026-08-20T00:00:01.000Z',
      },
    ],
    runs: [
      ...mockBundle.runs,
      {
        ...mockBundle.runs[0],
        runId: 'run-world-incomplete',
        turnId: 'turn-world-incomplete',
      },
    ],
    artifacts: [
      {
        cardId: 'card-world-incomplete',
        conversationId: mockConversation.conversationId,
        turnId: 'turn-world-incomplete',
        runId: 'run-world-incomplete',
        artifactId: 'artifact-world-incomplete',
        artifactType: 'setting_candidates',
        title: '世界设定候选',
        summary: '等待确认应用',
        status: 'candidate',
        createdAt: '2026-08-20T00:00:02.000Z',
        artifactEvidence: {
          sourceNovelId: mockNovel.id,
          processingStatus: 'valid',
          validationIssues: [],
        },
      },
    ],
  });
  artifactDecisionService.applyStructured = async (input) => ({
    decision: {
      decisionId: 'decision-world-incomplete',
      artifactId: input.artifactId,
      artifactHash: 'hash-world-incomplete',
      cardId: input.cardId,
      conversationId: input.conversationId,
      decision: 'request_apply',
      idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
      actor: 'user',
      targetType: input.targetType,
      targetId: input.targetId,
      applyTransactionId: 'apply-world-incomplete',
      createdAt: '2026-08-20T00:00:04.000Z',
    },
  });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  const apply = await screen.findByTestId('workbench-artifact-apply');
  fireEvent.click(apply);
  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
      'failed',
    );
  });
  assert.match(screen.getByTestId('workbench-asset-readiness').textContent ?? '', /仍未补齐/);
});

test('Workbench rechecks a blocked goal only after a structured candidate reports atomic apply', async () => {
  useBrowserMockModel();
  let worldApplied = false;
  let applyCalls = 0;
  let startedRuns = 0;
  const persistedSourceTurns: ConversationTurn[] = [];
  chapterAssetReadinessService.inspect = async () => ({
    ready: worldApplied,
    missingAssets: worldApplied ? [] : ['world_setting'],
  });
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [...mockBundle.turns, ...persistedSourceTurns],
    artifacts: [
      {
        cardId: 'card-world-setting',
        conversationId: mockConversation.conversationId,
        runId: mockBundle.runs[0].runId,
        artifactId: 'artifact-world-setting',
        artifactType: 'setting_candidates',
        title: '世界设定候选',
        summary: '等待确认应用',
        status: 'candidate',
        createdAt: '2026-08-20T00:00:02.000Z',
        artifactEvidence: {
          sourceNovelId: mockNovel.id,
          processingStatus: 'valid',
          validationIssues: [],
        },
      },
    ],
  });
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    if (decodeWorkbenchTurnContent(content).origin === 'workbench_asset_preparation') {
      throw new Error('测试保留现有结构化候选');
    }
    const turn: ConversationTurn = {
      turnId: 'turn-blocked-source',
      conversationId,
      sequence: mockBundle.turns[0].sequence + 1 + persistedSourceTurns.length,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
    persistedSourceTurns.push(turn);
    return turn;
  };
  taskSessionAdapter.startTurn = async (...args) => {
    startedRuns += 1;
    return originalStartTurn(...args);
  };
  artifactDecisionService.applyStructured = async (input) => {
    applyCalls += 1;
    const applied = applyCalls > 1;
    worldApplied = applied;
    return {
      decision: {
        decisionId: 'decision-world-setting',
        artifactId: input.artifactId,
        artifactHash: 'hash-world-setting',
        cardId: input.cardId,
        conversationId: input.conversationId,
        decision: 'request_apply',
        idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
        actor: 'user',
        targetType: input.targetType,
        targetId: input.targetId,
        applyTransactionId: applied ? 'apply-world-setting' : undefined,
        conflictCode: applied ? undefined : 'BASE_REVISION_CONFLICT',
        createdAt: '2026-08-20T00:00:04.000Z',
      },
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-artifact-apply'));
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      mockChapter.id,
    );
  });
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: '生成本章正文' } });
  const send = screen.getByTestId('workbench-send-task') as HTMLButtonElement;
  await waitFor(() => assert.equal(send.disabled, false));
  fireEvent.click(send);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-asset-readiness').dataset.ready, 'false');
  });

  assert.equal(applyCalls, 0);
  assert.equal(startedRuns, 0);
  fireEvent.click(screen.getByTestId('workbench-artifact-apply'));

  await waitFor(() => assert.equal(applyCalls, 1));
  assert.equal(screen.getByTestId('workbench-asset-readiness').dataset.ready, 'false');
  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-artifact-apply') as HTMLButtonElement).disabled,
      false,
    );
  });
  fireEvent.click(screen.getByTestId('workbench-artifact-apply'));

  await waitFor(() => {
    assert.equal(applyCalls, 2);
    assert.equal(screen.getByTestId('workbench-asset-readiness').dataset.ready, 'true');
  });
  await waitFor(() => assert.equal(startedRuns, 1));
  assert.equal(composer.value, '');
});

test('Workbench rechecks a queued asset before appending its automatic preparation turn', async () => {
  useBrowserMockModel();
  const goal = '写个六万字左右的悬疑故事。';
  let inspectionCount = 0;
  const appendedTurns: ConversationTurn[] = [];
  const startedInputs: Parameters<typeof taskSessionAdapter.startTurn>[0][] = [];

  chapterAssetReadinessService.inspect = async () => {
    inspectionCount += 1;
    return inspectionCount === 1
      ? { ready: false, missingAssets: ['world_setting'] }
      : { ready: true, missingAssets: [] };
  };
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    const turn: ConversationTurn = {
      turnId: `turn-preappend-recheck-${appendedTurns.length + 1}`,
      conversationId,
      sequence: mockBundle.turns.length + appendedTurns.length + 1,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
    appendedTurns.push(turn);
    return turn;
  };
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [...mockBundle.turns, ...appendedTurns],
  });
  taskSessionAdapter.startTurn = async (input) => {
    startedInputs.push(input);
    return {
      ...mockBundle.runs[0],
      runId: 'run-preappend-recheck',
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );
  const composer = await screen.findByTestId('workbench-composer-input');
  fireEvent.change(composer, { target: { value: goal } });
  const send = screen.getByTestId('workbench-send-task') as HTMLButtonElement;
  await waitFor(() => assert.equal(send.disabled, false));
  fireEvent.click(send);

  await waitFor(() => assert.equal(startedInputs.length, 1));
  assert.ok(inspectionCount >= 2);
  assert.equal(appendedTurns.length, 1);
  const decodedTurn = decodeWorkbenchTurnContent(appendedTurns[0]?.content);
  assert.equal(decodedTurn.content, goal);
  assert.equal(decodedTurn.origin, undefined);
  assert.equal(startedInputs[0]?.turnId, appendedTurns[0]?.turnId);
  assert.equal(startedInputs[0]?.goal, goal);
});

test('Workbench reloads and selects the first planned chapter after applying a sparse story plan', async () => {
  useBrowserMockModel();
  const emptyNovel: Novel = {
    ...mockNovel,
    outline: '',
    currentChapterId: undefined,
  };
  const firstPlannedChapter: Chapter = {
    ...mockChapter,
    id: 'planned-chapter-001',
    title: '第一章：失真档案',
    status: 'outline_ready',
    wordCount: 0,
    currentWords: 0,
  };
  const planArtifact: TaskConversationBundle['artifacts'][number] = {
    cardId: 'card-story-plan',
    conversationId: mockConversation.conversationId,
    runId: mockBundle.runs[0].runId,
    artifactId: 'artifact-story-plan',
    artifactType: 'outline',
    title: '全书规划候选',
    summary: '十五章全书结构',
    status: 'candidate',
    createdAt: '2026-08-20T00:00:02.000Z',
    artifactEvidence: {
      sourceNovelId: mockNovel.id,
      processingStatus: 'valid',
      validationIssues: [],
    },
  };
  let planApplied = false;
  const selectedChapterIds: string[] = [];
  let startedRuns = 0;
  const persistedSourceTurns: ConversationTurn[] = [];

  novelRepository.getAll = async () => [emptyNovel];
  chapterRepository.getByNovelId = async () => (planApplied ? [firstPlannedChapter] : []);
  novelRepository.update = async (_novelId, input) => {
    if (input.currentChapterId) selectedChapterIds.push(input.currentChapterId);
    return { ...emptyNovel, currentChapterId: input.currentChapterId };
  };
  chapterAssetReadinessService.inspect = async (input) =>
    planApplied
      ? {
          ready: false,
          missingAssets: ['world_setting', 'protagonist', 'chapter_outline'],
          chapterId: input.chapterId ?? firstPlannedChapter.id,
        }
      : { ready: false, missingAssets: ['story_plan'] };
  taskConversationService.get = async () => ({
    ...mockBundle,
    turns: [...mockBundle.turns, ...persistedSourceTurns],
    artifacts: [planArtifact],
  });
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    if (decodeWorkbenchTurnContent(content).origin === 'workbench_asset_preparation') {
      throw new Error('测试保留现有全书规划候选');
    }
    const turn: ConversationTurn = {
      turnId: 'turn-story-plan-source',
      conversationId,
      sequence: mockBundle.turns[0].sequence + 1 + persistedSourceTurns.length,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
    persistedSourceTurns.push(turn);
    return turn;
  };
  taskSessionAdapter.startTurn = async (...args) => {
    startedRuns += 1;
    return originalStartTurn(...args);
  };
  artifactDecisionService.applyStructured = async (input) => {
    planApplied = true;
    return {
      decision: {
        decisionId: 'decision-story-plan',
        artifactId: input.artifactId,
        artifactHash: 'hash-story-plan',
        cardId: input.cardId,
        conversationId: input.conversationId,
        decision: 'request_apply',
        idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
        actor: 'user',
        targetType: input.targetType,
        targetId: input.targetId,
        applyTransactionId: 'apply-story-plan',
        createdAt: '2026-08-20T00:00:04.000Z',
      },
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-create-chapter')));
  const sparseGoal = '我想写一部约6万字、15章的近未来悬疑小说：档案修复师发现城市在删除人的记忆。';
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: sparseGoal },
  });
  fireEvent.click(screen.getByTestId('workbench-send-task'));

  await waitFor(() => assert.ok(screen.getByTestId('workbench-missing-asset-story_plan')));
  assert.equal(startedRuns, 0);
  fireEvent.click(screen.getByTestId('workbench-artifact-apply'));

  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      firstPlannedChapter.id,
    );
    assert.equal(
      screen.getByTestId('workbench-asset-readiness').dataset.chapterId,
      firstPlannedChapter.id,
    );
  });
  assert.deepEqual(selectedChapterIds, [firstPlannedChapter.id]);
  assert.ok(screen.getByTestId('workbench-missing-asset-world_setting'));
  assert.ok(screen.getByTestId('workbench-missing-asset-protagonist'));
  assert.ok(screen.getByTestId('workbench-missing-asset-chapter_outline'));
});

test('Workbench resumes the original chapter goal on the first chapter created by a story plan', async () => {
  useBrowserMockModel();
  const emptyNovel: Novel = {
    ...mockNovel,
    outline: '',
    currentChapterId: undefined,
  };
  const firstPlannedChapter: Chapter = {
    ...mockChapter,
    id: 'planned-resume-chapter-001',
    title: '第一章：失真档案',
    status: 'outline_ready',
    wordCount: 0,
    currentWords: 0,
  };
  const sourceTurn: ConversationTurn = {
    turnId: 'turn-story-plan-resume-source',
    conversationId: mockConversation.conversationId,
    sequence: 0,
    role: 'user',
    content: '写个六万字左右的悬疑故事。',
    createdAt: '2026-08-20T00:00:00.000Z',
  };
  const preparationTurn: ConversationTurn = {
    turnId: 'turn-story-plan-resume-preparation',
    conversationId: mockConversation.conversationId,
    sequence: 1,
    role: 'user',
    content: encodeWorkbenchTurnContent(
      '生成全书规划候选。创意依据：写个六万字左右的悬疑故事。',
      'workbench_asset_preparation',
    ),
    createdAt: '2026-08-20T00:00:01.000Z',
  };
  const preparationRun = {
    ...mockBundle.runs[0],
    runId: 'run-story-plan-resume-preparation',
    turnId: preparationTurn.turnId,
    chapterId: undefined,
  };
  const planArtifact: TaskConversationBundle['artifacts'][number] = {
    cardId: 'card-story-plan-resume',
    conversationId: mockConversation.conversationId,
    turnId: preparationTurn.turnId,
    runId: preparationRun.runId,
    artifactId: 'artifact-story-plan-resume',
    artifactType: 'outline',
    title: '全书规划候选',
    summary: '十八章全书结构',
    status: 'candidate',
    createdAt: '2026-08-20T00:00:02.000Z',
    artifactEvidence: {
      sourceNovelId: mockNovel.id,
      processingStatus: 'valid',
      validationIssues: [],
    },
  };
  const decisions: NonNullable<TaskConversationBundle['decisions']> = [];
  const modelSnapshot = mockBundle.runs[0].modelSnapshot;
  const startedInputs: Parameters<typeof taskSessionAdapter.startTurn>[0][] = [];
  let planApplied = false;

  novelRepository.getAll = async () => [emptyNovel];
  chapterRepository.getByNovelId = async () => (planApplied ? [firstPlannedChapter] : []);
  chapterAssetReadinessService.inspect = async (input) =>
    planApplied
      ? { ready: true, missingAssets: [], chapterId: input.chapterId ?? firstPlannedChapter.id }
      : { ready: false, missingAssets: ['story_plan'] };
  taskConversationService.get = async () => ({
    ...mockBundle,
    conversation: { ...mockConversation, defaultModel: modelSnapshot },
    turns: [sourceTurn, preparationTurn],
    runs: [preparationRun],
    artifacts: [planArtifact],
    decisions,
  });
  taskSessionAdapter.startTurn = async (input) => {
    startedInputs.push(input);
    return {
      ...mockBundle.runs[0],
      runId: 'run-story-plan-resumed-chapter',
      conversationId: input.conversationId,
      turnId: input.turnId,
      chapterId: input.chapterId,
      modelSnapshot: input.modelSnapshot!,
    };
  };
  artifactDecisionService.applyStructured = async (input) => {
    planApplied = true;
    const decision: NonNullable<TaskConversationBundle['decisions']>[number] = {
      decisionId: 'decision-story-plan-resume',
      artifactId: input.artifactId,
      artifactHash: 'hash-story-plan-resume',
      cardId: input.cardId,
      conversationId: input.conversationId,
      decision: 'request_apply',
      idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
      actor: 'user',
      targetType: input.targetType,
      targetId: input.targetId,
      applyTransactionId: 'apply-story-plan-resume',
      createdAt: '2026-08-20T00:00:03.000Z',
    };
    decisions.push(decision);
    return { decision };
  };
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: undefined,
    originalGoal: '写个六万字左右的悬疑故事。',
    missingAssets: ['story_plan'],
    sourceTurnId: sourceTurn.turnId,
    modelSnapshot,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'story_plan',
      preparationTurnId: preparationTurn.turnId,
      preparationRunId: preparationRun.runId,
      candidateArtifactId: planArtifact.artifactId,
      updatedAt: '2026-08-20T00:00:02.000Z',
    },
    createdAt: sourceTurn.createdAt,
    checkedAt: '2026-08-20T00:00:02.000Z',
  });

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  const apply = await screen.findByTestId('workbench-artifact-apply');
  fireEvent.click(apply);

  await waitFor(() => assert.equal(startedInputs.length, 1));
  assert.equal(startedInputs[0]?.turnId, sourceTurn.turnId);
  assert.equal(startedInputs[0]?.chapterId, firstPlannedChapter.id);
  assert.equal(
    (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
    firstPlannedChapter.id,
  );
});

test('asset recovery ignores a slower readiness result after a newer settle', async () => {
  const modelSnapshot = mockBundle.runs[0].modelSnapshot;
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: 'chapter-before-plan',
    originalGoal: '写个六万字左右的悬疑故事。',
    missingAssets: ['protagonist'],
    sourceTurnId: 'turn-stale-settle-source',
    modelSnapshot,
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'protagonist',
      candidateArtifactId: 'artifact-protagonist',
      updatedAt: '2026-08-20T00:00:02.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:02.000Z',
  });

  let resolveSlow!: (
    value: Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>,
  ) => void;
  const slowInspection = new Promise<
    Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>
  >((resolve) => {
    resolveSlow = resolve;
  });
  let inspectionCount = 0;
  chapterAssetReadinessService.inspect = async () => {
    inspectionCount += 1;
    if (inspectionCount === 1) return slowInspection;
    return { ready: true, missingAssets: [], chapterId: 'planned-chapter-after-settle' };
  };

  const hook = renderHook(() =>
    useWorkbenchChapterAssetRecovery(mockConversation.conversationId, undefined, null),
  );
  await waitFor(() =>
    assert.equal(hook.result.current.recovery?.orchestration.phase, 'awaiting_apply'),
  );

  let slowerRefresh!: ReturnType<typeof hook.result.current.refreshRecovery>;
  act(() => {
    slowerRefresh = hook.result.current.refreshRecovery();
  });
  await waitFor(() => assert.equal(inspectionCount, 1));
  await act(async () => {
    await hook.result.current.refreshRecovery();
  });
  assert.equal(hook.result.current.recovery?.orchestration.phase, 'resuming');

  await act(async () => {
    resolveSlow({ ready: false, missingAssets: ['story_plan'] });
    await slowerRefresh;
  });

  assert.equal(hook.result.current.recovery?.orchestration.phase, 'resuming');
  assert.equal(hook.result.current.recovery?.chapterId, 'planned-chapter-after-settle');
  assert.deepEqual(hook.result.current.recovery?.missingAssets, []);
});

test('asset recovery keeps an explicit refresh current when its persisted bundle rerenders', async () => {
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: 'chapter-before-bundle-refresh',
    originalGoal: '生成本章正文',
    missingAssets: ['protagonist'],
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'protagonist',
      candidateArtifactId: 'artifact-protagonist-before-bundle-refresh',
      updatedAt: '2026-08-20T00:00:02.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:02.000Z',
  });
  let resolveInspection!: (
    value: Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>,
  ) => void;
  let inspectionCount = 0;
  chapterAssetReadinessService.inspect = async () => {
    inspectionCount += 1;
    return new Promise((resolve) => {
      resolveInspection = resolve;
    });
  };

  const hook = renderHook(
    ({ persistedBundle }: { persistedBundle: TaskConversationBundle }) =>
      useWorkbenchChapterAssetRecovery(
        mockConversation.conversationId,
        'chapter-before-bundle-refresh',
        persistedBundle,
      ),
    { initialProps: { persistedBundle: mockBundle } },
  );
  await waitFor(() => assert.equal(hook.result.current.recovery?.missingAssets[0], 'protagonist'));

  let refresh!: ReturnType<typeof hook.result.current.refreshRecovery>;
  act(() => {
    refresh = hook.result.current.refreshRecovery();
  });
  await waitFor(() => assert.equal(inspectionCount, 1));
  hook.rerender({
    persistedBundle: {
      ...mockBundle,
      conversation: { ...mockBundle.conversation, updatedAt: '2026-08-20T00:00:03.000Z' },
    },
  });

  await act(async () => {
    resolveInspection({
      ready: false,
      missingAssets: ['story_plan'],
      chapterId: 'chapter-after-bundle-refresh',
    });
    await refresh;
  });

  assert.equal(hook.result.current.recovery?.chapterId, 'chapter-after-bundle-refresh');
  assert.deepEqual(hook.result.current.recovery?.missingAssets, ['story_plan']);
  assert.equal(hook.result.current.recovery?.orchestration.phase, 'queued');
});

test('asset recovery remains busy until every concurrent readiness refresh settles', async () => {
  chapterAssetRecoveryStore.set({
    conversationId: mockConversation.conversationId,
    novelId: mockNovel.id,
    chapterId: mockChapter.id,
    originalGoal: '生成本章正文',
    missingAssets: ['world_setting'],
    orchestration: {
      phase: 'queued',
      asset: 'world_setting',
      updatedAt: '2026-08-20T00:00:02.000Z',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    checkedAt: '2026-08-20T00:00:02.000Z',
  });
  const resolvers: Array<
    (value: Awaited<ReturnType<typeof chapterAssetReadinessService.inspect>>) => void
  > = [];
  chapterAssetReadinessService.inspect = async () =>
    new Promise((resolve) => {
      resolvers.push(resolve);
    });

  const hook = renderHook(() =>
    useWorkbenchChapterAssetRecovery(mockConversation.conversationId, mockChapter.id, null),
  );
  await waitFor(() =>
    assert.equal(hook.result.current.recovery?.missingAssets[0], 'world_setting'),
  );

  let firstRefresh!: ReturnType<typeof hook.result.current.refreshRecovery>;
  let secondRefresh!: ReturnType<typeof hook.result.current.refreshRecovery>;
  act(() => {
    firstRefresh = hook.result.current.refreshRecovery();
    secondRefresh = hook.result.current.refreshRecovery();
  });
  await waitFor(() => {
    assert.equal(resolvers.length, 2);
    assert.equal(hook.result.current.checking, true);
  });

  await act(async () => {
    resolvers[0]?.({ ready: false, missingAssets: ['world_setting'], chapterId: mockChapter.id });
    await firstRefresh;
  });
  assert.equal(hook.result.current.checking, true);

  await act(async () => {
    resolvers[1]?.({ ready: false, missingAssets: ['world_setting'], chapterId: mockChapter.id });
    await secondRefresh;
  });
  assert.equal(hook.result.current.checking, false);
});

test('Workbench advances continue goals only after adoption and stops at the planned ending', async () => {
  useBrowserMockModel();
  const firstChapter: Chapter = {
    ...mockChapter,
    status: 'adopted',
    adoptedDraftId: 'draft-adopted-001',
  };
  const secondChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    title: '第二章：记忆空洞',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
    status: 'outline_ready',
    adoptedDraftId: undefined,
  };
  let repositoryChapters = [firstChapter, secondChapter];
  const selectedChapterIds: string[] = [];
  const startedChapterIds: Array<string | undefined> = [];
  let appendedTurns = 0;

  chapterRepository.getByNovelId = async () => repositoryChapters;
  novelRepository.update = async (_novelId, input) => {
    if (input.currentChapterId) selectedChapterIds.push(input.currentChapterId);
    return { ...mockNovel, currentChapterId: input.currentChapterId };
  };
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    appendedTurns += 1;
    return {
      turnId: `turn-continue-${appendedTurns}`,
      conversationId,
      sequence: mockBundle.turns.length + appendedTurns,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
  };
  taskSessionAdapter.startTurn = async (input) => {
    startedChapterIds.push(input.chapterId);
    return {
      ...mockBundle.runs[0],
      runId: `run-continue-${startedChapterIds.length}`,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      firstChapter.id,
    );
  });
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: '继续写' },
  });
  fireEvent.click(screen.getByTestId('workbench-send-task'));

  await waitFor(() => assert.deepEqual(startedChapterIds, [secondChapter.id]));
  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      secondChapter.id,
    );
  });
  assert.equal(appendedTurns, 1);
  assert.ok(selectedChapterIds.includes(secondChapter.id));

  repositoryChapters = [
    firstChapter,
    { ...secondChapter, status: 'adopted', adoptedDraftId: 'draft-adopted-002' },
  ];
  await waitFor(() => {
    assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, true);
  });
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: '继续写' },
  });
  await waitFor(() => {
    assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, false);
  });
  fireEvent.click(screen.getByTestId('workbench-send-task'));

  await waitFor(() => {
    assert.match(screen.getByTestId('workbench-composer-error').textContent ?? '', /规划终点/);
  });
  assert.equal(appendedTurns, 1);
  assert.deepEqual(startedChapterIds, [secondChapter.id]);
  assert.equal(
    (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
    secondChapter.id,
  );
});

test('WorkbenchPage handles empty novels state gracefully', async () => {
  novelRepository.getAll = async () => [];
  taskConversationService.list = async () => [];

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-no-projects'));
    assert.ok(screen.getByText('还没有小说项目'));
  });
});

test('WorkbenchPage shows a chapter selector for the current novel', async () => {
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
  });
  fireEvent.click(screen.getByTestId('workbench-task'));
  await waitFor(() => {
    const select = screen.getByTestId('workbench-chapter-select') as HTMLSelectElement;
    assert.equal(select.value, 'chapter-001');
    assert.ok(screen.getByRole('option', { name: '第一章：初入宗门' }));
  });
});

test('WorkbenchPage disables generate templates when the novel has no chapters', async () => {
  chapterRepository.getByNovelId = async () => [];
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
  });
  fireEvent.click(screen.getByTestId('workbench-task'));
  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-create-chapter'));
    assert.equal(
      (screen.getByTestId('workbench-template-generate-chapter') as HTMLButtonElement).disabled,
      true,
    );
    assert.equal(
      (screen.getByTestId('workbench-template-story-plan') as HTMLButtonElement).disabled,
      false,
    );
    assert.equal(
      (screen.getByTestId('workbench-template-protagonist') as HTMLButtonElement).disabled,
      false,
    );
    assert.equal(
      (screen.getByTestId('workbench-template-world-setting') as HTMLButtonElement).disabled,
      false,
    );
    assert.equal(
      (screen.getByTestId('workbench-template-audit-chapter') as HTMLButtonElement).disabled,
      true,
    );
  });
});

test('Workbench task creator gates chapter templates when project scope is selected', async () => {
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-create-task')));
  fireEvent.click(screen.getByTestId('workbench-create-task'));
  await waitFor(() => assert.ok(screen.getByTestId('workbench-task-creator')));

  const chapterSelect = screen.getByTestId('workbench-new-task-chapter') as HTMLSelectElement;
  fireEvent.change(chapterSelect, { target: { value: '' } });
  const taskGoal = screen.getByTestId('workbench-new-task-goal') as HTMLTextAreaElement;
  assert.equal(taskGoal.placeholder, '例如：写个六万字左右的悬疑故事');

  const creator = screen.getByTestId('workbench-task-creator');
  const creatorTemplate = (id: string) =>
    creator.querySelector(`[data-testid="workbench-template-${id}"]`) as HTMLButtonElement;

  await waitFor(() => {
    assert.equal(creatorTemplate('story-plan').disabled, false);
    assert.equal(creatorTemplate('protagonist').disabled, false);
    assert.equal(creatorTemplate('world-setting').disabled, false);
    assert.equal(creatorTemplate('generate-chapter').disabled, true);
    assert.equal(creatorTemplate('audit-chapter').disabled, true);
    assert.equal(creatorTemplate('outline').disabled, true);
  });

  fireEvent.change(chapterSelect, { target: { value: mockChapter.id } });
  await waitFor(() => {
    assert.equal(taskGoal.placeholder, '例如：写出本章冲突升级后的转折');
    assert.equal(creatorTemplate('story-plan').disabled, true);
    assert.equal(creatorTemplate('protagonist').disabled, true);
    assert.equal(creatorTemplate('world-setting').disabled, true);
    assert.equal(creatorTemplate('generate-chapter').disabled, false);
    assert.equal(creatorTemplate('audit-chapter').disabled, false);
    assert.equal(creatorTemplate('outline').disabled, false);
  });
});

test('Workbench keeps tool execution details inline in the conversation', async () => {
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
  });
  fireEvent.click(screen.getByTestId('workbench-task'));

  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-message-list'));
    assert.ok(screen.getByTestId('workbench-tool-event'));
    assert.ok(screen.getByText('mock · Mock'));
  });
  const toolEvent = screen.getByTestId('workbench-tool-event') as HTMLDetailsElement;
  toolEvent.open = true;
  fireEvent(toolEvent, new window.Event('toggle'));
  assert.ok(screen.getByText('输入摘要'));
  assert.equal(screen.queryByTestId('agent-console-status-bar'), null);
  assert.equal(screen.queryByTestId('workbench-tab-trace'), null);
  assert.equal(screen.queryByTestId('agent-trace-canvas'), null);
});

test('retrying an older failed run creates a new run on the original user turn', async () => {
  const firstGoal = '先审计第一章人物线';
  const latestGoal = '再检查第二章伏笔';
  const secondChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    title: '第二章：暗流初现',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
  };
  chapterRepository.getByNovelId = async () => [mockChapter, secondChapter];
  const failedBundle: TaskConversationBundle = {
    ...mockBundle,
    turns: [
      { ...mockBundle.turns[0], turnId: 'turn-old', content: firstGoal },
      { ...mockBundle.turns[0], turnId: 'turn-latest', sequence: 2, content: latestGoal },
    ],
    runs: [
      {
        ...mockBundle.runs[0],
        runId: 'run-old',
        turnId: 'turn-old',
        chapterId: mockChapter.id,
        status: 'failed',
        error: '旧回合失败',
        modelSnapshot: mockBundle.runs[0].modelSnapshot,
      },
      {
        ...mockBundle.runs[0],
        runId: 'run-latest',
        turnId: 'turn-latest',
        chapterId: secondChapter.id,
        status: 'failed',
        error: '新回合失败',
      },
    ],
    toolEvents: [
      {
        ...mockBundle.toolEvents[0],
        eventId: 'evt-old',
        runId: 'run-old',
        status: 'failed',
        error: '旧工具失败',
      },
      {
        ...mockBundle.toolEvents[0],
        eventId: 'evt-latest',
        runId: 'run-latest',
      },
    ],
    artifacts: [
      {
        cardId: 'card-old',
        conversationId: mockBundle.conversation.conversationId,
        turnId: 'turn-old',
        runId: 'run-old',
        artifactId: 'artifact-old',
        artifactType: 'quality_report',
        title: '旧运行报告',
        summary: '旧运行产物',
        content: '旧运行证据',
        status: 'candidate',
        createdAt: '2026-08-20T00:00:01.000Z',
      },
    ],
  };
  let currentBundle = failedBundle;
  let appendedTurnCount = 0;
  let startedTurnCount = 0;
  let startedTurn:
    | {
        conversationId: string;
        turnId: string;
        chapterId?: string;
        goal: string;
        modelId?: string;
      }
    | undefined;
  taskConversationService.get = async () => currentBundle;
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    appendedTurnCount += 1;
    return {
      turnId: 'turn-retry',
      conversationId,
      sequence: 3,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
  };
  taskSessionAdapter.startTurn = async (input) => {
    startedTurnCount += 1;
    startedTurn = {
      conversationId: input.conversationId,
      turnId: input.turnId,
      chapterId: input.chapterId,
      goal: input.goal,
      modelId: input.modelSnapshot?.modelId,
    };
    const retryRun = {
      ...mockBundle.runs[0],
      runId: 'run-retry',
      turnId: input.turnId,
      conversationId: input.conversationId,
      status: 'completed' as const,
      modelSnapshot: input.modelSnapshot!,
      createdAt: '2026-08-20T00:00:04.000Z',
      updatedAt: '2026-08-20T00:00:05.000Z',
    };
    currentBundle = {
      ...currentBundle,
      runs: [...currentBundle.runs, retryRun],
      toolEvents: [
        ...currentBundle.toolEvents,
        {
          ...mockBundle.toolEvents[0],
          eventId: 'evt-retry',
          runId: retryRun.runId,
        },
      ],
      artifacts: [
        ...currentBundle.artifacts,
        {
          cardId: 'card-retry',
          conversationId: input.conversationId,
          turnId: input.turnId,
          runId: retryRun.runId,
          artifactId: 'artifact-retry',
          artifactType: 'quality_report',
          title: '重试运行报告',
          summary: '重试运行产物',
          content: '重试运行证据',
          status: 'candidate',
          createdAt: '2026-08-20T00:00:05.000Z',
        },
      ],
    };
    return retryRun;
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.equal(screen.getAllByTestId('workbench-retry-turn').length, 2));
  const chapterSelect = screen.getByTestId('workbench-chapter-select') as HTMLSelectElement;
  fireEvent.change(chapterSelect, { target: { value: secondChapter.id } });
  await waitFor(() => assert.equal(chapterSelect.value, secondChapter.id));
  const retryButton = screen.getAllByTestId('workbench-retry-turn')[0];
  fireEvent.click(retryButton);
  fireEvent.click(retryButton);
  await waitFor(() => assert.equal(startedTurn?.turnId, 'turn-old'));
  assert.equal(startedTurnCount, 1);
  assert.equal(startedTurn?.conversationId, failedBundle.conversation.conversationId);
  assert.equal(startedTurn?.chapterId, mockChapter.id);
  assert.equal(startedTurn?.goal, firstGoal);
  assert.equal(startedTurn?.modelId, mockBundle.runs[0].modelSnapshot.modelId);
  assert.equal(appendedTurnCount, 0);
  assert.equal(currentBundle.turns.length, 2);
  assert.equal(currentBundle.runs.filter((run) => run.turnId === 'turn-old').length, 2);
  await waitFor(() => assert.equal(chapterSelect.value, mockChapter.id));

  await waitFor(() => {
    const oldTurn = document.querySelector('[data-turn-id="turn-old"]');
    assert.ok(oldTurn);
    assert.equal(oldTurn.querySelectorAll('[data-testid="workbench-run"]').length, 2);
    assert.match(oldTurn.textContent ?? '', /第 1 次运行/);
    assert.match(oldTurn.textContent ?? '', /第 2 次运行/);
    assert.match(oldTurn.textContent ?? '', /Mock/);
    assert.match(oldTurn.textContent ?? '', /旧回合失败/);
    const oldRun = oldTurn.querySelector('[data-testid="workbench-run"][data-run-id="run-old"]');
    const retryRun = oldTurn.querySelector(
      '[data-testid="workbench-run"][data-run-id="run-retry"]',
    );
    assert.ok(oldRun);
    assert.ok(retryRun);
    assert.ok(oldRun.querySelector('[data-event-id="evt-old"]'));
    assert.ok(oldRun.querySelector('[data-card-id="card-old"]'));
    assert.equal(oldRun.querySelector('[data-event-id="evt-retry"]'), null);
    assert.equal(oldRun.querySelector('[data-card-id="card-retry"]'), null);
    assert.ok(retryRun.querySelector('[data-event-id="evt-retry"]'));
    assert.ok(retryRun.querySelector('[data-card-id="card-retry"]'));
    assert.equal(retryRun.querySelector('[data-event-id="evt-old"]'), null);
    assert.equal(retryRun.querySelector('[data-card-id="card-old"]'), null);
  });
});

test('WorkbenchPage switches projects and task bundles as one selection', async () => {
  const secondNovel: Novel = {
    ...mockNovel,
    id: 'novel-002',
    title: '雾海纪事',
    currentChapterId: 'chapter-002',
  };
  const secondChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    novelId: 'novel-002',
    title: '第二卷：雾港',
  };
  const secondConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-002',
    novelId: 'novel-002',
    title: '推进雾港冲突',
  };
  let firstNovelChapterReads = 0;
  novelRepository.getAll = async () => [mockNovel, secondNovel];
  chapterRepository.getByNovelId = async (novelId) => {
    if (novelId === mockNovel.id) {
      firstNovelChapterReads += 1;
      return [mockChapter];
    }
    return [secondChapter];
  };
  taskConversationService.list = async () => [mockConversation, secondConversation];
  taskConversationService.get = async (conversationId) =>
    conversationId === secondConversation.conversationId
      ? {
          ...mockBundle,
          conversation: secondConversation,
          turns: [],
          runs: [],
          toolEvents: [],
        }
      : mockBundle;

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-001');
  });
  const secondProject = screen
    .getAllByTestId('workbench-project')
    .find((item) => item.dataset.novelId === secondNovel.id);
  assert.ok(secondProject);
  fireEvent.click(secondProject);

  await waitFor(() => {
    const header = screen.getByTestId('workbench-task-header');
    assert.equal(header.dataset.conversationId, 'conv-002');
    assert.match(header.textContent ?? '', /推进雾港冲突/);
  });
  assert.equal(firstNovelChapterReads, 1);
});

test('WorkbenchPage does not inherit another task model when a legacy task has no default', async () => {
  const firstModel = {
    ...mockBundle.runs[0].modelSnapshot,
    providerId: 'mock',
    modelId: 'Task A Model',
    runtimeMode: 'mock' as const,
  };
  const firstConversation: TaskConversation = {
    ...mockConversation,
    defaultModel: firstModel,
  };
  const legacyConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-legacy-model',
    title: '旧任务没有默认模型',
    defaultModel: undefined,
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  localStorage.setItem(
    'ai_novel_studio_ai_settings',
    JSON.stringify({
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      modelName: 'deepseek-chat',
      mockMode: false,
    }),
  );
  taskConversationService.list = async () => [firstConversation, legacyConversation];
  taskConversationService.get = async (conversationId) =>
    conversationId === legacyConversation.conversationId
      ? {
          ...mockBundle,
          conversation: legacyConversation,
          turns: [],
          runs: [],
          toolEvents: [],
        }
      : {
          ...mockBundle,
          conversation: firstConversation,
        };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-model-select') as HTMLSelectElement).value,
      'mock:Task A Model',
    );
  });
  const legacyTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === legacyConversation.conversationId);
  assert.ok(legacyTask);
  fireEvent.click(legacyTask);

  await waitFor(() => {
    assert.equal(
      screen.getByTestId('workbench-task-header').dataset.conversationId,
      'conv-legacy-model',
    );
    assert.equal(
      (screen.getByTestId('workbench-model-select') as HTMLSelectElement).value,
      'deepseek-official:deepseek-chat',
    );
  });
});

test('WorkbenchPage keeps drafts and late composer errors scoped to their task', async () => {
  const secondConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-002',
    title: '检查人物线',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  taskConversationService.list = async () => [mockConversation, secondConversation];
  taskConversationService.get = async (conversationId) =>
    conversationId === secondConversation.conversationId
      ? {
          ...mockBundle,
          conversation: secondConversation,
          turns: [],
          runs: [],
          toolEvents: [],
        }
      : mockBundle;

  let markAppendStarted: () => void = () => undefined;
  const appendStarted = new Promise<void>((resolve) => {
    markAppendStarted = resolve;
  });
  let rejectAppend: (error: Error) => void = () => undefined;
  taskConversationService.appendTurn = () => {
    markAppendStarted();
    return new Promise<ConversationTurn>((_resolve, reject) => {
      rejectAppend = reject;
    });
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-001');
  });
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: '推进第一章冲突' } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('workbench-send-task'));
    await appendStarted;
  });

  const secondTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === secondConversation.conversationId);
  assert.ok(secondTask);
  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  assert.equal((screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value, '');
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: '核对第二任务人物动机' },
  });

  await act(async () => {
    rejectAppend(new Error('第一任务发送迟到失败'));
  });
  const firstTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === mockConversation.conversationId);
  assert.ok(firstTask);
  fireEvent.click(firstTask);
  await waitFor(() => {
    assert.match(
      screen.getByTestId('workbench-composer-error').textContent ?? '',
      /第一任务发送迟到失败/,
    );
  });
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '推进第一章冲突',
  );

  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  assert.equal(screen.queryByTestId('workbench-composer-error'), null);
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '核对第二任务人物动机',
  );
});

test('WorkbenchPage clears only the submitted task draft after a late successful append', async () => {
  const secondConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-002',
    title: '检查伏笔线',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  taskConversationService.list = async () => [mockConversation, secondConversation];
  taskConversationService.get = async (conversationId) =>
    conversationId === secondConversation.conversationId
      ? {
          ...mockBundle,
          conversation: secondConversation,
          turns: [],
          runs: [],
          toolEvents: [],
        }
      : mockBundle;

  let markAppendStarted: () => void = () => undefined;
  const appendStarted = new Promise<void>((resolve) => {
    markAppendStarted = resolve;
  });
  let resolveAppend: (turn: ConversationTurn) => void = () => undefined;
  taskConversationService.appendTurn = () => {
    markAppendStarted();
    return new Promise<ConversationTurn>((resolve) => {
      resolveAppend = resolve;
    });
  };
  let markRunFinished: () => void = () => undefined;
  const runFinished = new Promise<void>((resolve) => {
    markRunFinished = resolve;
  });
  taskSessionAdapter.startTurn = async (input) => {
    markRunFinished();
    return {
      ...mockBundle.runs[0],
      runId: 'run-late-success',
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-001');
  });
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: '提交第一任务草稿' },
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('workbench-send-task'));
    await appendStarted;
  });

  const secondTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === secondConversation.conversationId);
  const firstTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === mockConversation.conversationId);
  assert.ok(secondTask);
  assert.ok(firstTask);
  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: '保留第二任务草稿' },
  });

  await act(async () => {
    resolveAppend({
      turnId: 'turn-late-success',
      conversationId: mockConversation.conversationId,
      sequence: 2,
      role: 'user',
      content: '提交第一任务草稿',
      createdAt: '2026-08-20T00:00:03.000Z',
    });
    await runFinished;
  });
  await waitFor(() => assert.notEqual(firstTask.dataset.status, 'running'));

  fireEvent.click(firstTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-001');
  });
  assert.equal((screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value, '');

  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '保留第二任务草稿',
  );
});

test('WorkbenchPage isolates compression candidate, busy state, and late failure by task', async () => {
  const secondConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-002',
    title: '整理世界设定',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  taskConversationService.list = async () => [mockConversation, secondConversation];
  taskConversationService.get = async (conversationId) =>
    conversationId === secondConversation.conversationId
      ? {
          ...mockBundle,
          conversation: secondConversation,
          turns: [],
          runs: [],
          toolEvents: [],
        }
      : mockBundle;

  const candidate: NovelContextCompressionCandidate = {
    providerId: 'ans.novel-context.extractive-v1',
    version: '1.1.0',
    config: { tokenBudget: 4000 },
    novelId: mockNovel.id,
    sourceRevision: 'rev-task-one',
    compressedText: '第一任务的压缩候选',
    coverage: {
      characters: { required: ['主角'], present: [], missing: ['主角'] },
      plot: { required: [], present: [], missing: [] },
      foreshadow: { required: [], present: [], missing: [] },
      timeline: { required: [], present: [], missing: [] },
      world: { required: [], present: [], missing: [] },
      rules: { required: [], present: [], missing: [] },
      outlines: { required: [], present: [], missing: [] },
      style: { required: [], present: [], missing: [] },
      output: { required: [], present: [], missing: [] },
      tokens: { budget: 4000, used: 12, withinBudget: true },
    },
    valid: false,
  };
  let proposalCount = 0;
  let rejectSecondProposal: (error: Error) => void = () => undefined;
  novelContextCompressionProvider.propose = async () => {
    proposalCount += 1;
    if (proposalCount === 1) return candidate;
    return new Promise<NovelContextCompressionCandidate>((_resolve, reject) => {
      rejectSecondProposal = reject;
    });
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-001');
  });
  fireEvent.click(screen.getByTestId('workbench-compress-context'));
  await waitFor(() => assert.ok(screen.getByTestId('workbench-compression-card')));

  const secondTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === secondConversation.conversationId);
  const firstTask = screen
    .getAllByTestId('workbench-task')
    .find((item) => item.dataset.conversationId === mockConversation.conversationId);
  assert.ok(secondTask);
  assert.ok(firstTask);
  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  assert.equal(screen.queryByTestId('workbench-compression-card'), null);
  assert.equal(
    (screen.getByTestId('workbench-compress-context') as HTMLButtonElement).disabled,
    false,
  );

  fireEvent.click(firstTask);
  await waitFor(() => assert.ok(screen.getByTestId('workbench-compression-card')));
  fireEvent.click(screen.getByTestId('workbench-compress-context'));
  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-compress-context') as HTMLButtonElement).disabled,
      true,
    );
  });

  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  assert.equal(screen.queryByTestId('workbench-compression-card'), null);
  assert.equal(
    (screen.getByTestId('workbench-compress-context') as HTMLButtonElement).disabled,
    false,
  );

  await act(async () => {
    rejectSecondProposal(new Error('第一任务压缩迟到失败'));
  });
  fireEvent.click(firstTask);
  await waitFor(() => {
    assert.match(
      screen.getByTestId('workbench-composer-error').textContent ?? '',
      /第一任务压缩迟到失败/,
    );
  });
  assert.ok(screen.getByTestId('workbench-compression-card'));
  assert.equal(
    (screen.getByTestId('workbench-compress-context') as HTMLButtonElement).disabled,
    false,
  );

  fireEvent.click(secondTask);
  await waitFor(() => {
    assert.equal(screen.getByTestId('workbench-task-header').dataset.conversationId, 'conv-002');
  });
  assert.equal(screen.queryByTestId('workbench-composer-error'), null);
  assert.equal(screen.queryByTestId('workbench-compression-card'), null);
});

test('WorkbenchPage restores the last valid task instead of the first project', async () => {
  const recentNovel: Novel = {
    ...mockNovel,
    id: 'novel-recent',
    title: '最近创作的小说',
    currentChapterId: 'chapter-recent',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
  const recentChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-recent',
    novelId: recentNovel.id,
    title: '最近章节',
  };
  const recentConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-recent',
    novelId: recentNovel.id,
    title: '继续最近的伏笔任务',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
  localStorage.setItem(
    'ai_novel_studio_workbench_selection',
    JSON.stringify({
      version: 1,
      novelId: recentNovel.id,
      conversationId: recentConversation.conversationId,
    }),
  );
  novelRepository.getAll = async () => [mockNovel, recentNovel];
  taskConversationService.list = async () => [mockConversation, recentConversation];
  chapterRepository.getByNovelId = async (novelId) =>
    novelId === recentNovel.id ? [recentChapter] : [mockChapter];
  taskConversationService.get = async (conversationId) =>
    conversationId === recentConversation.conversationId
      ? {
          ...mockBundle,
          conversation: recentConversation,
          turns: [],
          runs: [],
          toolEvents: [],
        }
      : mockBundle;

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    const header = screen.getByTestId('workbench-task-header');
    assert.equal(header.dataset.conversationId, recentConversation.conversationId);
    assert.match(header.textContent ?? '', /继续最近的伏笔任务/);
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      recentChapter.id,
    );
  });
});

test('Workbench task tree searches archived tasks and restores them from the row menu', async () => {
  const archivedConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-archived',
    title: '已归档的人物审计',
    archivedAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
  let restoredId = '';
  taskConversationService.list = async () => [archivedConversation, mockConversation];
  taskConversationService.setArchived = async (conversationId, archived) => {
    restoredId = archived ? '' : conversationId;
    return {
      ...archivedConversation,
      archivedAt: archived ? archivedConversation.archivedAt : undefined,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getAllByText('生成第一章大纲与正文').length > 0));
  fireEvent.click(screen.getByRole('button', { name: '归档' }));
  await waitFor(() => assert.ok(screen.getByText('已归档的人物审计')));

  fireEvent.change(screen.getByRole('searchbox', { name: '搜索创作任务' }), {
    target: { value: '人物' },
  });
  assert.ok(screen.getByText('已归档的人物审计'));
  const menuTrigger = screen.getByRole('button', { name: '已归档的人物审计的更多操作' });
  fireEvent.click(menuTrigger);
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(screen.queryByRole('menuitem', { name: '恢复任务' }), null);
  fireEvent.click(menuTrigger);
  fireEvent.click(screen.getByRole('menuitem', { name: '恢复任务' }));

  await waitFor(() => assert.equal(restoredId, archivedConversation.conversationId));
});

test('Workbench creates the task atomically and advances its initialized next-chapter goal', async () => {
  const adoptedFirstChapter: Chapter = {
    ...mockChapter,
    status: 'adopted',
    adoptedDraftId: 'draft-adopted-001',
  };
  const nextChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    title: '第二章：暗潮初现',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
    status: 'outline_ready',
    adoptedDraftId: undefined,
  };
  chapterRepository.getByNovelId = async () => [adoptedFirstChapter, nextChapter];
  novelRepository.update = async (_novelId, input) => ({
    ...mockNovel,
    currentChapterId: input.currentChapterId,
  });
  let initializedGoal = '';
  let appendedTurns = 0;
  let startedInput: Parameters<typeof taskSessionAdapter.startTurn>[0] | undefined;
  const initializedConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-created',
    title: '生成下一章',
  };
  taskConversationService.createInitialized = async (novelId, goal, defaultModel) => {
    initializedGoal = goal;
    return {
      conversation: { ...initializedConversation, novelId, defaultModel },
      turn: {
        turnId: 'turn-created',
        conversationId: initializedConversation.conversationId,
        sequence: 0,
        role: 'user',
        content: goal,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    };
  };
  taskConversationService.appendTurn = async (...args) => {
    appendedTurns += 1;
    return originalAppendConversationTurn(...args);
  };
  taskConversationService.get = async (conversationId) =>
    conversationId === initializedConversation.conversationId
      ? {
          conversation: initializedConversation,
          turns: [
            {
              turnId: 'turn-created',
              conversationId,
              sequence: 0,
              role: 'user',
              content: initializedGoal,
              createdAt: '2026-08-20T00:00:00.000Z',
            },
          ],
          runs: [],
          toolEvents: [],
          artifacts: [],
        }
      : mockBundle;
  taskSessionAdapter.startTurn = async (input, onEvent) => {
    startedInput = input;
    const run = {
      runId: 'run-created',
      conversationId: input.conversationId,
      turnId: input.turnId,
      workerId: 'worker-created',
      status: 'completed' as const,
      modelSnapshot: input.modelSnapshot!,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:01.000Z',
    };
    onEvent?.({ run });
    return run;
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-create-task'));
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      mockChapter.id,
    );
  });
  fireEvent.click(screen.getByTestId('workbench-create-task'));
  const creator = await screen.findByTestId('workbench-task-creator');
  const goalInput = screen.getByRole('textbox', { name: '创作目标' });
  fireEvent.change(goalInput, { target: { value: '生成下一章' } });
  fireEvent.click(screen.getByTestId('workbench-create-and-start'));

  await waitFor(() => assert.equal(startedInput?.conversationId, 'conv-created'));
  assert.equal(creator.isConnected, false);
  assert.equal(initializedGoal, '生成下一章');
  assert.equal(startedInput?.turnId, 'turn-created');
  assert.equal(startedInput?.chapterId, nextChapter.id);
  assert.equal(appendedTurns, 0);
});

test('Workbench resumes an asset-blocked new task on its atomic first turn without duplicating it', async () => {
  useBrowserMockModel();
  let assetsReady = false;
  let appendedTurns = 0;
  const startedInputs: Parameters<typeof taskSessionAdapter.startTurn>[0][] = [];
  let preparationTurn: ConversationTurn | undefined;
  let preparationRun: TaskConversationBundle['runs'][number] | undefined;
  let preparationArtifact: TaskConversationBundle['artifacts'][number] | undefined;
  let initializedCreated = false;
  const initializedConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-created-blocked',
    title: '生成本章正文',
  };
  chapterAssetReadinessService.inspect = async () =>
    assetsReady
      ? { ready: true, missingAssets: [] }
      : { ready: false, missingAssets: ['world_setting'] };
  taskConversationService.list = async () =>
    initializedCreated ? [mockConversation, initializedConversation] : [mockConversation];
  taskConversationService.createInitialized = async (novelId, goal, defaultModel) => {
    initializedCreated = true;
    return {
      conversation: { ...initializedConversation, novelId, defaultModel },
      turn: {
        turnId: 'turn-created-blocked',
        conversationId: initializedConversation.conversationId,
        sequence: 0,
        role: 'user',
        content: goal,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    };
  };
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    appendedTurns += 1;
    preparationTurn = {
      turnId: 'turn-created-world-preparation',
      conversationId,
      sequence: 1,
      role,
      content,
      createdAt: '2026-08-20T00:00:01.000Z',
    };
    return preparationTurn;
  };
  taskConversationService.get = async (conversationId) =>
    conversationId === initializedConversation.conversationId
      ? {
          conversation: initializedConversation,
          turns: [
            {
              turnId: 'turn-created-blocked',
              conversationId,
              sequence: 0,
              role: 'user',
              content: '生成本章正文',
              createdAt: '2026-08-20T00:00:00.000Z',
            },
            ...(preparationTurn ? [preparationTurn] : []),
          ],
          runs: preparationRun ? [preparationRun] : [],
          toolEvents: [],
          artifacts: preparationArtifact ? [preparationArtifact] : [],
        }
      : mockBundle;
  taskSessionAdapter.startTurn = async (input) => {
    startedInputs.push(input);
    const run = {
      ...mockBundle.runs[0],
      runId: `run-created-blocked-${startedInputs.length}`,
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
    if (input.goal.startsWith('生成世界与规则设定候选')) {
      preparationRun = run;
      preparationArtifact = {
        cardId: 'card-created-world',
        conversationId: input.conversationId,
        turnId: input.turnId,
        runId: run.runId,
        artifactId: 'artifact-created-world',
        artifactType: 'setting_candidates',
        title: '世界设定候选',
        summary: '等待确认应用',
        status: 'candidate',
        createdAt: '2026-08-20T00:00:02.000Z',
        artifactEvidence: {
          sourceNovelId: mockNovel.id,
          processingStatus: 'valid',
          validationIssues: [],
        },
      };
    }
    return run;
  };
  artifactDecisionService.applyStructured = async (input) => {
    assetsReady = true;
    return {
      decision: {
        decisionId: 'decision-created-world',
        artifactId: input.artifactId,
        artifactHash: 'hash-created-world',
        cardId: input.cardId,
        conversationId: input.conversationId,
        decision: 'request_apply',
        idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
        actor: 'user',
        targetType: input.targetType,
        targetId: input.targetId,
        applyTransactionId: 'apply-created-world',
        createdAt: '2026-08-20T00:00:03.000Z',
      },
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-create-task'));
    assert.equal(
      (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
      mockChapter.id,
    );
  });
  fireEvent.click(screen.getByTestId('workbench-create-task'));
  fireEvent.change(await screen.findByTestId('workbench-new-task-goal'), {
    target: { value: '生成本章正文' },
  });
  const createAndStart = screen.getByTestId('workbench-create-and-start') as HTMLButtonElement;
  await waitFor(() => assert.equal(createAndStart.disabled, false));
  fireEvent.click(createAndStart);

  await waitFor(() => assert.ok(screen.getByTestId('workbench-asset-readiness')));
  await waitFor(() => assert.equal(startedInputs.length, 1));
  assert.ok(startedInputs[0]?.goal.startsWith('生成世界与规则设定候选'));
  assert.equal(appendedTurns, 1);
  assert.equal(
    screen.getByTestId('workbench-asset-readiness').dataset.orchestrationPhase,
    'awaiting_apply',
  );
  fireEvent.click(screen.getByTestId('workbench-artifact-apply'));

  await waitFor(() => assert.equal(startedInputs.length, 2));
  const resumedInput = startedInputs[1];
  assert.equal(resumedInput?.turnId, 'turn-created-blocked');
  assert.equal(resumedInput?.conversationId, initializedConversation.conversationId);
  assert.equal(resumedInput?.goal, '生成本章正文');
  assert.equal(appendedTurns, 1);
});

test('Workbench task creator starts a local conversational goal without a Runtime model', async () => {
  localStorage.setItem(
    'ai_novel_studio_ai_settings',
    JSON.stringify({
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
    }),
  );
  let initializedGoal = '';
  let startedGoal = '';
  const createdConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-local-created',
    title: '本地能力问答',
  };
  novelRepository.update = async () => mockNovel;
  taskConversationService.createInitialized = async (novelId, goal, defaultModel) => {
    initializedGoal = goal;
    return {
      conversation: { ...createdConversation, novelId, defaultModel },
      turn: {
        turnId: 'turn-local-created',
        conversationId: createdConversation.conversationId,
        sequence: 0,
        role: 'user',
        content: goal,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    };
  };
  taskConversationService.get = async (conversationId) =>
    conversationId === createdConversation.conversationId
      ? {
          conversation: createdConversation,
          turns: [],
          runs: [],
          toolEvents: [],
          artifacts: [],
        }
      : mockBundle;
  taskSessionAdapter.startTurn = async (input) => {
    startedGoal = input.goal;
    return {
      ...mockBundle.runs[0],
      runId: 'run-local-created',
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-create-task')));
  fireEvent.click(screen.getByTestId('workbench-create-task'));
  const goal = await screen.findByTestId('workbench-new-task-goal');
  fireEvent.change(goal, { target: { value: '你能做什么？' } });

  const submit = screen.getByTestId('workbench-create-and-start') as HTMLButtonElement;
  assert.equal(submit.disabled, false);
  assert.match(screen.getByTestId('workbench-new-task-model-status').textContent ?? '', /仍可创建/);
  fireEvent.keyDown(goal, { key: 'Enter', ctrlKey: true });

  await waitFor(() => assert.equal(startedGoal, '你能做什么？'));
  assert.equal(initializedGoal, '你能做什么？');
});

test('Workbench task creator awaits a valid chapter selection before creating and starting', async () => {
  const secondChapter: Chapter = {
    ...mockChapter,
    id: 'chapter-002',
    title: '第二章：暗潮初现',
    chapterNumber: 2,
    orderIndex: 1,
    sortOrder: 1,
  };
  chapterRepository.getByNovelId = async () => [mockChapter, secondChapter];
  let resolveChapterSelection: (novel: Novel | null) => void = () => undefined;
  let selectedChapterInput = '';
  novelRepository.update = async (_id, input) => {
    selectedChapterInput = input.currentChapterId ?? '';
    return new Promise<Novel | null>((resolve) => {
      resolveChapterSelection = resolve;
    });
  };
  const sequence: string[] = [];
  let startedInput: Parameters<typeof taskSessionAdapter.startTurn>[0] | undefined;
  const createdConversation: TaskConversation = {
    ...mockConversation,
    conversationId: 'conv-chapter-created',
    title: '推进第二章',
  };
  taskConversationService.createInitialized = async (novelId, goal, defaultModel) => {
    sequence.push('create');
    return {
      conversation: { ...createdConversation, novelId, defaultModel },
      turn: {
        turnId: 'turn-chapter-created',
        conversationId: createdConversation.conversationId,
        sequence: 0,
        role: 'user',
        content: goal,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    };
  };
  taskConversationService.get = async (conversationId) =>
    conversationId === createdConversation.conversationId
      ? {
          conversation: createdConversation,
          turns: [],
          runs: [],
          toolEvents: [],
          artifacts: [],
        }
      : mockBundle;
  taskSessionAdapter.startTurn = async (input) => {
    sequence.push('start');
    startedInput = input;
    return {
      ...mockBundle.runs[0],
      runId: 'run-chapter-created',
      conversationId: input.conversationId,
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-create-task')));
  fireEvent.click(screen.getByTestId('workbench-create-task'));
  fireEvent.change(await screen.findByTestId('workbench-new-task-goal'), {
    target: { value: '生成第二章正文' },
  });
  fireEvent.change(screen.getByTestId('workbench-new-task-chapter'), {
    target: { value: secondChapter.id },
  });
  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-create-and-start') as HTMLButtonElement).disabled,
      false,
    );
  });
  fireEvent.click(screen.getByTestId('workbench-create-and-start'));

  await waitFor(() => assert.equal(selectedChapterInput, secondChapter.id));
  assert.deepEqual(sequence, []);
  resolveChapterSelection({ ...mockNovel, currentChapterId: secondChapter.id });

  await waitFor(() => assert.equal(startedInput?.chapterId, secondChapter.id));
  assert.deepEqual(sequence, ['create', 'start']);
  assert.equal(
    (screen.getByTestId('workbench-chapter-select') as HTMLSelectElement).value,
    secondChapter.id,
  );
});

test('Workbench task creator rejects a chapter outside the selected novel', async () => {
  const foreignChapter: Chapter = {
    ...mockChapter,
    id: 'foreign-chapter',
    novelId: 'novel-foreign',
    title: '其他小说章节',
  };
  chapterRepository.getByNovelId = async () => [mockChapter, foreignChapter];
  let chapterUpdates = 0;
  let createdTasks = 0;
  let startedTasks = 0;
  novelRepository.update = async () => {
    chapterUpdates += 1;
    return mockNovel;
  };
  taskConversationService.createInitialized = async (...args) => {
    createdTasks += 1;
    return originalCreateInitializedConversation(...args);
  };
  taskSessionAdapter.startTurn = async (...args) => {
    startedTasks += 1;
    return originalStartTurn(...args);
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-create-task')));
  fireEvent.click(screen.getByTestId('workbench-create-task'));
  fireEvent.change(await screen.findByTestId('workbench-new-task-goal'), {
    target: { value: '生成这一章正文' },
  });
  fireEvent.change(screen.getByTestId('workbench-new-task-chapter'), {
    target: { value: foreignChapter.id },
  });
  fireEvent.click(screen.getByTestId('workbench-create-and-start'));

  await waitFor(() => assert.ok(screen.getByText('所选章节不属于当前小说项目，请重新选择。')));
  assert.equal(chapterUpdates, 0);
  assert.equal(createdTasks, 0);
  assert.equal(startedTasks, 0);
});

test('WorkbenchPage keeps editing responsive while legacy context is still settling', async () => {
  const pendingSnapshot = {
    conversationRecovery: { status: 'succeeded' as const, result: { recoveredRuns: 0 } },
    contextMigration: { status: 'running' as const },
    generationRecovery: { status: 'running' as const },
  };
  startupCoordinator.getSnapshot = () => pendingSnapshot;
  startupCoordinator.subscribe = () => () => undefined;
  startupCoordinator.waitForContextMigration = () => new Promise<void>(() => undefined);

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-context-pending'));
  });
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  const send = screen.getByTestId('workbench-send-task') as HTMLButtonElement;
  assert.equal(composer.disabled, false);

  fireEvent.change(composer, { target: { value: '继续生成本章正文' } });
  assert.equal(send.disabled, true);

  fireEvent.change(composer, { target: { value: '你能做什么？' } });
  assert.equal(send.disabled, false);

  fireEvent.click(screen.getByTestId('workbench-create-task'));
  const creator = await screen.findByTestId('workbench-task-creator');
  const goal = screen.getByRole('textbox', { name: '创作目标' }) as HTMLTextAreaElement;
  assert.equal(goal.disabled, false);
  assert.ok(screen.getByTestId('workbench-new-task-context-pending'));
  fireEvent.change(goal, { target: { value: '生成下一章' } });
  assert.equal(
    (screen.getByTestId('workbench-create-and-start') as HTMLButtonElement).disabled,
    true,
  );

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => assert.equal(creator.isConnected, false));
});

test('WorkbenchPage fails closed for creative tasks when legacy context migration failed', async () => {
  const failedSnapshot = {
    conversationRecovery: { status: 'succeeded', result: { recoveredRuns: 0 } },
    contextMigration: { status: 'failed', error: 'context migration failed' },
    generationRecovery: { status: 'succeeded', result: { recoveredJobs: 0, recoveredAt: '' } },
  } as const;
  startupCoordinator.getSnapshot = () => failedSnapshot;
  startupCoordinator.subscribe = () => () => undefined;
  startupCoordinator.waitForContextMigration = async () => undefined;

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-context-warning')));
  const composer = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  const send = screen.getByTestId('workbench-send-task') as HTMLButtonElement;

  fireEvent.change(composer, { target: { value: '继续生成本章正文' } });
  assert.equal(send.disabled, true);

  fireEvent.change(composer, { target: { value: '你能做什么？' } });
  assert.equal(send.disabled, false);

  fireEvent.click(screen.getByTestId('workbench-create-task'));
  const goal = await screen.findByTestId('workbench-new-task-goal');
  fireEvent.change(goal, { target: { value: '生成下一章' } });
  assert.equal(
    (screen.getByTestId('workbench-create-and-start') as HTMLButtonElement).disabled,
    true,
  );
});

test('WorkbenchPage revalidates the model directory before persisting a turn', async () => {
  let appendedTurns = 0;
  let startedTurns = 0;
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    appendedTurns += 1;
    return {
      turnId: 'turn-should-not-persist',
      conversationId,
      sequence: 2,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
  };
  taskSessionAdapter.startTurn = async (input) => {
    startedTurns += 1;
    return {
      ...mockBundle.runs[0],
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-task')));
  fireEvent.click(screen.getByTestId('workbench-task'));
  await waitFor(() => {
    assert.equal(
      (screen.getByTestId('workbench-model-select') as HTMLSelectElement).value,
      'mock:Mock',
    );
    assert.equal(
      (screen.getByTestId('workbench-model-select') as HTMLSelectElement).disabled,
      true,
    );
    assert.equal(
      screen.getByTestId('workbench-model-select').getAttribute('data-model-locked'),
      'true',
    );
  });

  const draft = '保留这段尚未发送的创作目标';
  const textarea = screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: draft } });
  await waitFor(() => {
    assert.equal((screen.getByTestId('workbench-send-task') as HTMLButtonElement).disabled, false);
  });

  localStorage.setItem(
    'ai_novel_studio_ai_settings',
    JSON.stringify({
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
    }),
  );
  fireEvent.click(screen.getByTestId('workbench-send-task'));

  await waitFor(() => {
    assert.match(
      screen.getByTestId('workbench-composer-error').textContent ?? '',
      /Runtime 模型目录/,
    );
  });
  assert.equal(textarea.value, draft);
  assert.equal(appendedTurns, 0);
  assert.equal(startedTurns, 0);
});

test('WorkbenchPage exposes model recovery without discarding the unsent goal', async () => {
  localStorage.setItem(
    'ai_novel_studio_ai_settings',
    JSON.stringify({
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
    }),
  );
  let directoryReads = 0;
  productionToolRegistry.getManifest = async () => {
    directoryReads += 1;
    return originalGetToolManifest.call(productionToolRegistry);
  };

  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<WorkbenchPage />} />
        <Route path="/settings" element={<div data-testid="model-settings-destination" />} />
      </Routes>
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-task')));
  fireEvent.click(screen.getByTestId('workbench-task'));
  const textarea = await screen.findByTestId('workbench-composer-input');
  fireEvent.change(textarea, { target: { value: '保留这段尚未发送的创作目标' } });

  const recovery = await screen.findByTestId('workbench-model-directory-status');
  assert.equal(recovery.getAttribute('role'), 'alert');
  assert.ok(screen.getByRole('button', { name: '重试模型目录' }));
  assert.ok(screen.getByRole('button', { name: '模型设置' }));

  const readsBeforeRetry = directoryReads;
  fireEvent.click(screen.getByRole('button', { name: '重试模型目录' }));
  await waitFor(() => assert.ok(directoryReads > readsBeforeRetry));
  assert.equal(
    (screen.getByTestId('workbench-composer-input') as HTMLTextAreaElement).value,
    '保留这段尚未发送的创作目标',
  );

  fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
  await waitFor(() => assert.ok(screen.getByTestId('model-settings-destination')));
});

test('WorkbenchPage keeps local conversational replies available when the model directory is unavailable', async () => {
  localStorage.setItem(
    'ai_novel_studio_ai_settings',
    JSON.stringify({
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-chat',
    }),
  );
  let appendedGoal = '';
  let startedGoal = '';
  taskConversationService.appendTurn = async (conversationId, role, content) => {
    appendedGoal = content;
    return {
      turnId: 'turn-local-reply',
      conversationId,
      sequence: 2,
      role,
      content,
      createdAt: '2026-08-20T00:00:03.000Z',
    };
  };
  taskSessionAdapter.startTurn = async (input) => {
    startedGoal = input.goal;
    return {
      ...mockBundle.runs[0],
      runId: 'run-local-reply',
      turnId: input.turnId,
      modelSnapshot: input.modelSnapshot!,
    };
  };

  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => assert.ok(screen.getByTestId('workbench-task')));
  fireEvent.click(screen.getByTestId('workbench-task'));
  const recovery = await screen.findByTestId('workbench-model-directory-status');
  assert.match(recovery.textContent ?? '', /本地能力问答仍可发送/);
  fireEvent.change(screen.getByTestId('workbench-composer-input'), {
    target: { value: '你能做什么？' },
  });

  const sendButton = screen.getByTestId('workbench-send-task') as HTMLButtonElement;
  assert.equal(sendButton.disabled, false);
  fireEvent.keyDown(screen.getByTestId('workbench-composer-input'), {
    key: 'Enter',
    ctrlKey: true,
  });

  await waitFor(() => assert.equal(startedGoal, '你能做什么？'));
  assert.equal(appendedGoal, '你能做什么？');
});
