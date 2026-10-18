import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchConversations } from './useWorkbenchConversations';
import type { TaskConversation } from '../../../types/conversation';

const fixture = vi.hoisted(() => ({
  tasks: [
    {
      conversationId: 'a1',
      novelId: 'project-a',
      title: 'A first',
      status: 'waiting_user',
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
      archivedAt: undefined as string | undefined,
    },
    {
      conversationId: 'a2',
      novelId: 'project-a',
      title: 'A current',
      status: 'waiting_user',
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
      archivedAt: undefined as string | undefined,
    },
    {
      conversationId: 'b1',
      novelId: 'project-b',
      title: 'B first',
      status: 'waiting_user',
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
      archivedAt: undefined as string | undefined,
    },
  ],
  get: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
  setArchived: vi.fn(),
  saveSelection: vi.fn(),
}));

vi.mock('../../../services/database/novelRepository', () => ({
  novelRepository: {
    getAll: async () => [
      { id: 'project-a', title: 'A', updatedAt: '2026-09-10T00:00:00Z' },
      { id: 'project-b', title: 'B', updatedAt: '2026-09-10T00:00:00Z' },
    ],
  },
}));
vi.mock('../../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: async () => [] },
}));
vi.mock('../../../services/database/volumeRepository', () => ({
  volumeRepository: { getByNovelId: async () => [] },
}));
vi.mock('../../../services/novels/novelService', () => ({
  novelService: { updateNovel: vi.fn() },
}));
vi.mock('../../../services/conversation/taskConversationService', () => ({
  taskConversationService: { get: fixture.get, setArchived: fixture.setArchived },
}));
vi.mock('../../../services/conversation/taskConversationWindow', () => ({
  taskConversationWindow: {
    read: (...args: unknown[]) => fixture.read(...args),
    listRunningTargets: async () => [],
  },
}));
vi.mock('../../../services/conversation/taskModelSnapshot', () => ({
  captureTaskModelSnapshot: () => ({
    providerId: 'mock',
    modelId: 'Mock',
    runtimeMode: 'mock',
    options: {},
    capabilities: [],
  }),
}));
vi.mock('../../../services/startup/startupCoordinator', () => ({
  startupCoordinator: { waitForConversationRecovery: async () => undefined },
}));
vi.mock('../../../features/workbench/useWorkbenchConversationDirectory', () => ({
  useWorkbenchConversationDirectory: () => ({ refresh: fixture.refresh }),
}));
vi.mock('../../../services/conversation/workbenchSelectionStore', () => ({
  load: () => null,
  resolve: () => ({ novelId: 'project-a', conversationId: 'a1' }),
  save: fixture.saveSelection,
}));

describe('project navigation keeps the selected task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.tasks = fixture.tasks.map((task) => ({ ...task, archivedAt: undefined }));
    fixture.refresh.mockImplementation(async () => [...fixture.tasks]);
    const bundleFor = (id: string) => ({
      conversation: fixture.tasks.find((task) => task.conversationId === id),
      turns: [],
      runs: [],
      toolEvents: [],
      artifacts: [],
      decisions: [],
    });
    fixture.get.mockImplementation(async (id: string) => bundleFor(id));
    fixture.read.mockImplementation(async (query: { conversationId: string }) => ({
      bundle: bundleFor(query.conversationId),
      page: {
        startSequence: null,
        endSequenceExclusive: null,
        oldestUserSequence: null,
        newestUserSequence: null,
        hasOlder: false,
        hasNewer: false,
        userRoundCount: 0,
      },
    }));
    fixture.setArchived.mockImplementation(async (id: string, archived: boolean) => {
      fixture.tasks = fixture.tasks.map((task) =>
        task.conversationId === id
          ? { ...task, archivedAt: archived ? '2026-09-10T00:00:00Z' : undefined }
          : task,
      );
      return fixture.tasks.find((task) => task.conversationId === id);
    });
  });

  it('does not reload or reset a task when its selected project is clicked again', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    act(() => result.current.selectTask('project-a', 'a2'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a2'));
    fixture.get.mockClear();
    fixture.saveSelection.mockClear();
    const bundle = result.current.bundle;
    act(() => {
      result.current.selectProject('project-a');
      result.current.selectProject('project-a');
    });
    expect(result.current.selectedConversationId).toBe('a2');
    expect(result.current.bundle).toBe(bundle);
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.saveSelection).not.toHaveBeenCalled();
  });

  it('returns to the most recently selected task per project, not the first directory item', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    act(() => result.current.selectTask('project-a', 'a2'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a2'));
    act(() => result.current.selectProject('project-b'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('b1'));
    act(() => result.current.selectProject('project-a'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a2'));
  });

  it('falls back to an active task when the remembered task has been archived', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    act(() => result.current.selectTask('project-a', 'a2'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a2'));
    act(() => result.current.selectProject('project-b'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('b1'));
    await act(async () => result.current.setTaskArchived('a2', true));
    act(() => result.current.selectProject('project-a'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
  });

  it('keeps the last bundle when refreshing the same task fails, and clears a deleted task', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    fixture.read.mockRejectedValueOnce(new Error('暂时读不到'));
    await act(async () => {
      await result.current.refreshBundle('a1');
    });
    expect(result.current.bundle?.conversation.conversationId).toBe('a1');
    expect(result.current.bundleStaleError).toMatch(/暂时读不到/);
    expect(result.current.conversationsError).toBe('');
    fixture.read.mockResolvedValueOnce(null);
    await act(async () => {
      await result.current.refreshBundle('a1');
    });
    expect(result.current.bundle).toBeNull();
    expect(result.current.conversationsError).toMatch(/不存在或已移除/);
  });

  it('does not apply a late refresh failure to the task selected afterwards', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    let rejectStale: (error: Error) => void = () => undefined;
    const stalled = new Promise<never>((_resolve, reject) => {
      rejectStale = reject;
    });
    fixture.read.mockImplementationOnce(() => stalled);
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.refreshBundle('a1');
    });
    act(() => result.current.selectTask('project-a', 'a2'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a2'));
    rejectStale(new Error('旧任务刷新失败'));
    await act(async () => {
      await pending;
    });
    expect(result.current.bundle?.conversation.conversationId).toBe('a2');
    expect(result.current.bundleStaleError).toBe('');
  });

  it('keeps the persisted next-turn model when an older bundle refresh completes later', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    const staleBundle = result.current.bundle!;
    let resolveStale!: (value: unknown) => void;
    fixture.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshBundle('a1');
    });
    await waitFor(() => expect(resolveStale).toBeTypeOf('function'));
    const updated: TaskConversation = {
      ...staleBundle.conversation,
      defaultModel: {
        providerId: 'mock',
        modelId: 'B',
        runtimeMode: 'mock',
        capabilities: [],
        options: {},
        capturedAt: '2026-10-13T00:00:00Z',
      },
      updatedAt: '2026-10-13T00:00:00Z',
    };
    act(() => result.current.applyConversationUpdate(updated));
    expect(result.current.selectedModel.modelId).toBe('B');
    expect(result.current.bundle?.conversation.defaultModel?.modelId).toBe('B');
    await act(async () => {
      resolveStale({
        bundle: staleBundle,
        page: { hasNewer: false, hasOlder: false, userRoundCount: 0 },
      });
      await refresh;
    });
    expect(result.current.selectedModel.modelId).toBe('B');
    expect(result.current.bundle?.conversation.defaultModel?.modelId).toBe('B');
  });

  it('updates the original task record without changing the model of a newly selected task', async () => {
    const { result } = renderHook(useWorkbenchConversations);
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('a1'));
    const original = result.current.bundle!.conversation;
    act(() => result.current.selectTask('project-b', 'b1'));
    await waitFor(() => expect(result.current.bundle?.conversation.conversationId).toBe('b1'));
    act(() =>
      result.current.applyConversationUpdate({
        ...original,
        defaultModel: {
          providerId: 'mock',
          modelId: 'B',
          runtimeMode: 'mock',
          capabilities: [],
          options: {},
          capturedAt: '2026-10-13T00:00:00Z',
        },
      }),
    );
    expect(result.current.selectedModel.modelId).toBe('Mock');
    expect(result.current.bundle?.conversation.conversationId).toBe('b1');
    expect(
      result.current.conversations.find((item) => item.conversationId === 'a1')?.defaultModel
        ?.modelId,
    ).toBe('B');
  });
});
