import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import type { TaskConversation, TaskConversationBundle } from '../../types/conversation';

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

const { MemoryRouter } = await import('react-router-dom');

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
const pageModule = (await vite.ssrLoadModule(
  '/src/pages/Workbench/WorkbenchPage.tsx',
)) as typeof import('./WorkbenchPage');

const { novelRepository } = novelRepoModule;
const { chapterRepository } = chapterRepoModule;
const { taskConversationService } = taskServiceModule;
const { taskSessionAdapter } = taskSessionModule;
const WorkbenchPage = pageModule.default;

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

const originalGetAll = novelRepository.getAll;
const originalGetChapters = chapterRepository.getByNovelId;
const originalListConversations = taskConversationService.list;
const originalGetConversation = taskConversationService.get;
const originalCreateConversation = taskConversationService.create;
const originalListRunning = taskSessionAdapter.listRunningConversationIds;
const originalIsRunning = taskSessionAdapter.isRunning;

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

beforeEach(() => {
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
  taskSessionAdapter.listRunningConversationIds = async () => [];
  taskSessionAdapter.isRunning = () => false;
});

afterEach(() => {
  cleanup();
  novelRepository.getAll = originalGetAll;
  chapterRepository.getByNovelId = originalGetChapters;
  taskConversationService.list = originalListConversations;
  taskConversationService.get = originalGetConversation;
  taskConversationService.create = originalCreateConversation;
  taskSessionAdapter.listRunningConversationIds = originalListRunning;
  taskSessionAdapter.isRunning = originalIsRunning;
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

  // Select the task to open conversation view
  fireEvent.click(screen.getByTestId('workbench-task'));

  await waitFor(() => {
    assert.ok(screen.getByText('生成下一章'));
    assert.ok(screen.getByText('审计章节'));
    assert.ok(screen.getByText('完善大纲'));
    assert.ok(screen.getByText('检查人物'));
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
  });
});

test('Agent Console: renders Agent status bar, dual tabs, and switches between Chat and Trace views', async () => {
  render(
    <MemoryRouter>
      <WorkbenchPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    assert.ok(screen.getAllByText('天命修仙录').length > 0);
  });
  fireEvent.click(screen.getByTestId('workbench-task'));

  // 1. 验证 Agent Console 状态栏存在
  await waitFor(() => {
    assert.ok(screen.getByTestId('agent-console-status-bar'));
    assert.ok(screen.getByTestId('workbench-tab-chat'));
    assert.ok(screen.getByTestId('workbench-tab-trace'));
  });

  // 2. 初始为 Chat 视图
  assert.ok(screen.getByTestId('workbench-message-list'));

  // 3. 点击切换到 Trace 视图
  fireEvent.click(screen.getByTestId('workbench-tab-trace'));
  await waitFor(() => {
    assert.ok(screen.getByTestId('agent-trace-canvas'));
    assert.ok(screen.getByTestId('agent-trace-run'));
  });

  // 4. 再次切回 Chat 视图
  fireEvent.click(screen.getByTestId('workbench-tab-chat'));
  await waitFor(() => {
    assert.ok(screen.getByTestId('workbench-message-list'));
  });
});
