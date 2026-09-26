import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchNavigation } from './WorkbenchNavigation';

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
