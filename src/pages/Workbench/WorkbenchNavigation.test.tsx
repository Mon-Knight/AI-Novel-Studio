import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchNavigation } from './WorkbenchNavigation';
import type { Novel } from '../../types/novel';
import type { TaskConversation } from '../../types/conversation';

type NavigationProps = Parameters<typeof WorkbenchNavigation>[0];

function navigationProps(initializing: boolean, searchFocusToken = 1): NavigationProps {
  return {
    directory: {
      initializing,
      items: [],
      query: '',
      archive: 'active',
      displayQuery: '',
      displayArchive: 'active',
      loading: false,
      error: '',
      hasMore: false,
      setQuery: vi.fn(),
      setArchive: vi.fn(),
      refresh: async () => [],
      loadMore: () => undefined,
    },
    novels: [],
    conversations: [],
    selectedNovelId: '',
    selectedConversationId: '',
    runningConversationIds: new Set(),
    projectsLoading: false,
    conversationsLoading: false,
    projectsError: '',
    conversationsError: '',
    creatingTask: false,
    searchFocusToken,
    onCreateTask: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectTask: vi.fn(),
    onRenameTask: async () => undefined,
    onSetTaskArchived: async () => undefined,
    onRetryProjects: vi.fn(),
    onRetryConversations: vi.fn(),
    onOpenLibrary: vi.fn(),
  };
}

function navigation(props: NavigationProps) {
  return (
    <MemoryRouter>
      <button>外部控件</button>
      <WorkbenchNavigation {...props} />
    </MemoryRouter>
  );
}

describe('workbench search focus readiness', () => {
  it('waits for initialization before consuming a search request and never steals focus again', () => {
    const view = render(navigation(navigationProps(true)));
    const input = screen.getByRole('searchbox', { name: '搜索创作任务' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(document.activeElement).not.toBe(input);
    const focus = vi.spyOn(input, 'focus');
    view.rerender(navigation(navigationProps(false)));
    expect(document.activeElement).toBe(input);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    const outside = screen.getByText('外部控件');
    outside.focus();
    focus.mockClear();
    view.rerender(navigation(navigationProps(true)));
    view.rerender(navigation(navigationProps(false)));
    expect(document.activeElement).toBe(outside);
    expect(focus).not.toHaveBeenCalled();
    view.rerender(navigation(navigationProps(false, 2)));
    expect(document.activeElement).toBe(input);
  });
});

describe('workbench tree row identity', () => {
  it('marks the selected project and task for assistive tech and preserves full long titles', () => {
    const longNovelTitle = '雾港纪事：潮汐、旧信与一场没有回声的审判';
    const longTaskTitle = '推进雾港冲突与人物动机，并保留所有已经确认的线索与伏笔 · Project Luna';
    const props = navigationProps(false, 0);
    props.novels = [
      {
        id: 'novel-a',
        title: longNovelTitle,
      },
    ] as unknown as Novel[];
    props.conversations = [
      {
        conversationId: 'task-a',
        novelId: 'novel-a',
        title: longTaskTitle,
        status: 'waiting_user',
        createdAt: '2026-10-28T08:00:00.000Z',
        updatedAt: '2026-10-28T08:10:00.000Z',
      },
    ] satisfies TaskConversation[];
    props.selectedNovelId = 'novel-a';
    props.selectedConversationId = 'task-a';

    render(navigation(props));

    const project = screen.getByTestId('workbench-project');
    const task = screen.getByTestId('workbench-task');
    expect(project.getAttribute('aria-current')).toBe('true');
    expect(project.getAttribute('aria-label')).toContain(longNovelTitle);
    expect(project.closest('.workbench-project-heading')?.className).toContain('is-current');
    expect(task.getAttribute('aria-current')).toBe('true');
    expect(task.getAttribute('aria-label')).toContain(longTaskTitle);
    expect(task.querySelector('.workbench-task-title')?.textContent).toBe(longTaskTitle);
  });

  it('shows the complete title and update detail in a focusable tooltip', () => {
    const props = navigationProps(false, 0);
    const taskTitle = '推进雾港冲突与人物动机，并保留所有已经确认的线索与伏笔';
    props.novels = [{ id: 'novel-a', title: '长篇项目标题' }] as unknown as Novel[];
    props.conversations = [
      {
        conversationId: 'task-a',
        novelId: 'novel-a',
        title: taskTitle,
        status: 'waiting_user',
        createdAt: '2026-10-28T08:00:00.000Z',
        updatedAt: '2026-10-28T08:10:00.000Z',
      },
    ] satisfies TaskConversation[];
    props.selectedNovelId = 'novel-a';
    props.selectedConversationId = 'task-a';

    vi.useFakeTimers();
    try {
      render(navigation(props));
      const task = screen.getByTestId('workbench-task');
      fireEvent.mouseEnter(task);
      act(() => vi.advanceTimersByTime(200));
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip.textContent).toContain(taskTitle);
      expect(tooltip.textContent).toContain('等待处理');
      expect(tooltip.textContent).toContain('更新于');
      expect(task.getAttribute('aria-describedby')).toBe(tooltip.id);
      fireEvent.mouseLeave(task);
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
