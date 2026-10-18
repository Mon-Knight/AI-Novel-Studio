import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { TaskConversationBundle } from '../../types/conversation';
import type { ChapterWorkflowHandoff } from '../../services/conversation/chapterWorkflowService';
import { useWorkbenchChapterHandoff } from './useWorkbenchChapterHandoff';

const fixture = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../services/conversation/chapterWorkflowService', () => ({
  loadChapterWorkflow: fixture.load,
}));
const chapter: Chapter = {
  id: 'chapter',
  novelId: 'novel',
  title: '旧信',
  chapterNumber: 3,
  outline: '',
  goal: '',
  orderIndex: 2,
  sortOrder: 2,
  status: 'adopted',
  adoptedDraftId: 'adopted',
  wordCount: 3400,
  currentWords: 3400,
  targetWords: 3400,
  drafts: [],
  createdAt: '',
  updatedAt: '',
};
const bundle: TaskConversationBundle = {
  conversation: {
    conversationId: 'source',
    novelId: 'novel',
    title: '本章任务',
    status: 'idle',
    createdAt: '',
    updatedAt: '',
  },
  runs: [],
  turns: [],
  toolEvents: [],
  artifacts: [],
};
const handoff: ChapterWorkflowHandoff = {
  novelId: 'novel',
  chapterId: 'chapter',
  adoptedDraftId: 'adopted',
  conversationId: 'source',
  draft: '重新总结本章',
  cardId: 'summary',
};
function props() {
  return {
    loading: false,
    selectedNovelId: 'novel',
    selectedConversationId: 'source',
    chapters: [chapter],
    bundle: bundle as TaskConversationBundle | null,
    draft: '',
    hasRevisionSource: false,
    selectProject: vi.fn(),
    selectTask: vi.fn(),
    selectChapter: vi.fn().mockResolvedValue(undefined),
    openTaskCreator: vi.fn(),
    setDraft: vi.fn(),
    setError: vi.fn(),
    locateArtifact: vi.fn(),
  };
}
function wrapper(request = handoff) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter initialEntries={[{ pathname: '/', state: { chapterWorkflow: request } }]}>
        {children}
      </MemoryRouter>
    );
  };
}
function useTarget(input: ReturnType<typeof props>) {
  useWorkbenchChapterHandoff(input);
  return { location: useLocation(), navigate: useNavigate() };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('chapter review source handoff', () => {
  beforeEach(() => {
    fixture.load.mockResolvedValue({
      chapter,
      conversationId: 'source',
      sourceConversationId: 'writer',
      cardId: 'summary',
      summary: null,
      phase: 'rejected',
      actualModel: false,
      archived: false,
    });
  });
  it('waits for project, task and bundle identity before selecting the exact chapter and prefilling once', async () => {
    const input = props();
    const initialProps: ReturnType<typeof props> = {
      ...input,
      loading: true,
      selectedNovelId: 'other',
      selectedConversationId: 'other-task',
      bundle: null,
    };
    const { result, rerender } = renderHook(useTarget, {
      initialProps,
      wrapper: wrapper(),
    });
    await waitFor(() => expect(fixture.load).toHaveBeenCalledTimes(1));
    expect(input.selectProject).not.toHaveBeenCalled();
    rerender({
      ...input,
      loading: false,
      selectedNovelId: 'other',
      selectedConversationId: 'other-task',
      bundle: null,
    });
    await waitFor(() => expect(input.selectProject).toHaveBeenCalledWith('novel'));
    expect(input.setDraft).not.toHaveBeenCalled();
    rerender({ ...input, selectedConversationId: 'other-task', bundle: null });
    await waitFor(() => expect(input.selectTask).toHaveBeenCalledWith('novel', 'source'));
    rerender({ ...input, bundle: null });
    expect(input.selectChapter).not.toHaveBeenCalled();
    rerender(input);
    await waitFor(() => expect(input.setDraft).toHaveBeenCalledExactlyOnceWith('重新总结本章'));
    expect(input.selectChapter).toHaveBeenCalledExactlyOnceWith('chapter');
    expect(input.locateArtifact).toHaveBeenCalledExactlyOnceWith('summary');
    expect(input.openTaskCreator).not.toHaveBeenCalled();
    expect(result.current.location.state).toBeNull();
  });
  it.each([{ draft: '还没发送的内容' }, { hasRevisionSource: true }])(
    'preserves unsent work before offering a summary redo: %o',
    async (overrides) => {
      const input = { ...props(), ...overrides };
      renderHook(useTarget, { initialProps: input, wrapper: wrapper() });
      await waitFor(() =>
        expect(input.setError).toHaveBeenCalledWith(expect.stringContaining('保留了未发送内容')),
      );
      expect(input.setDraft).not.toHaveBeenCalled();
      expect(input.selectChapter).toHaveBeenCalledWith('chapter');
    },
  );
  it('fails closed when the adopted draft or source conversation changed', async () => {
    fixture.load.mockResolvedValueOnce({
      chapter: { ...chapter, adoptedDraftId: 'new' },
      conversationId: 'source',
    });
    const input = props();
    renderHook(useTarget, { initialProps: input, wrapper: wrapper() });
    await waitFor(() =>
      expect(input.setError).toHaveBeenCalledWith(expect.stringContaining('采用稿已变化')),
    );
    expect(input.selectChapter).not.toHaveBeenCalled();
    expect(input.setDraft).not.toHaveBeenCalled();
  });
  it('returns to the exact writing source even if a later summary belongs to another task', async () => {
    const input = props();
    renderHook(useTarget, {
      initialProps: input,
      wrapper: wrapper({
        ...handoff,
        destination: 'source',
        conversationId: 'writer',
        draft: undefined,
        cardId: undefined,
      }),
    });
    await waitFor(() => expect(input.selectTask).toHaveBeenCalledWith('novel', 'writer'));
    expect(input.setDraft).not.toHaveBeenCalled();
  });
  it('opens an explicitly prefilled creator only when no persisted source exists', async () => {
    fixture.load.mockResolvedValueOnce({
      chapter,
      summary: null,
      phase: 'missing',
      actualModel: false,
      archived: false,
    });
    const input = props();
    renderHook(useTarget, {
      initialProps: input,
      wrapper: wrapper({ ...handoff, conversationId: undefined }),
    });
    await waitFor(() =>
      expect(input.openTaskCreator).toHaveBeenCalledExactlyOnceWith('重新总结本章', 'chapter'),
    );
    expect(input.setDraft).not.toHaveBeenCalled();
  });
  it('does not apply a late validation result after navigating away', async () => {
    const lookup = deferred<{ chapter: Chapter; conversationId: string }>();
    fixture.load.mockReturnValueOnce(lookup.promise);
    const input = props();
    const { result } = renderHook(useTarget, { initialProps: input, wrapper: wrapper() });
    act(() => result.current.navigate('/novels'));
    await act(async () => {
      lookup.resolve({ chapter, conversationId: 'source' });
      await lookup.promise;
    });
    expect(input.selectChapter).not.toHaveBeenCalled();
    expect(input.setDraft).not.toHaveBeenCalled();
  });
  it('waits for chapter selection persistence and cancels downstream work on unmount', async () => {
    const selecting = deferred<void>();
    const input = props();
    input.selectChapter.mockReturnValueOnce(selecting.promise);
    const { unmount } = renderHook(useTarget, { initialProps: input, wrapper: wrapper() });
    await waitFor(() => expect(input.selectChapter).toHaveBeenCalledTimes(1));
    expect(input.setDraft).not.toHaveBeenCalled();
    unmount();
    await act(async () => {
      selecting.resolve();
      await selecting.promise;
    });
    expect(input.setDraft).not.toHaveBeenCalled();
  });
});
