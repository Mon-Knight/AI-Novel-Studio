import { StrictMode, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useWorkbenchIntent } from '../../pages/Workbench/hooks/useWorkbenchIntent';

type Intent = 'search' | 'new-task';

function Harness({
  onSearch,
  onCreate,
}: {
  onSearch: (key: string) => void;
  onCreate: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [created, setCreated] = useState(0);
  const [searches, setSearches] = useState(0);
  const { searchFocusToken } = useWorkbenchIntent(
    () => {
      onCreate();
      setCreated((current) => current + 1);
    },
    () => {
      onSearch(location.key);
      setSearches((current) => current + 1);
    },
  );
  return (
    <>
      <output data-testid="search-token">{searchFocusToken}</output>
      <output data-testid="search-count">{searches}</output>
      <output data-testid="create-count">{created}</output>
      <output data-testid="intent-state">{location.state ? 'pending' : 'cleared'}</output>
      <button onClick={() => navigate('/', { state: { workbenchIntent: 'search' } })}>
        search
      </button>
      <button onClick={() => navigate('/', { state: { workbenchIntent: 'new-task' } })}>
        create
      </button>
    </>
  );
}

function renderIntent(intent: Intent) {
  const onSearch = vi.fn();
  const onCreate = vi.fn();
  render(
    <StrictMode>
      <MemoryRouter
        initialEntries={[
          { pathname: '/', key: 'initial-intent', state: { workbenchIntent: intent } },
        ]}
      >
        <Harness onSearch={onSearch} onCreate={onCreate} />
      </MemoryRouter>
    </StrictMode>,
  );
  return { onSearch, onCreate };
}

describe('one-shot workbench navigation intent', () => {
  it('waits for the requested project and its chapters instead of opening on the previous project', async () => {
    const opened = vi.fn();
    function ScopedHarness() {
      const [novelId, setNovelId] = useState('previous-novel');
      const [loading, setLoading] = useState(true);
      useWorkbenchIntent(() => opened(novelId), undefined, {
        selectedNovelId: novelId,
        novelIds: ['previous-novel', 'requested-novel'],
        loading,
        selectProject: (id) => {
          setNovelId(id);
          setLoading(true);
        },
      });
      return (
        <>
          <output data-testid="selected-project">{novelId}</output>
          <button onClick={() => setLoading(false)}>finish loading</button>
        </>
      );
    }
    render(
      <StrictMode>
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/',
              state: {
                workbenchIntent: 'new-task',
                workbenchNovelId: 'requested-novel',
              },
            },
          ]}
        >
          <ScopedHarness />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(opened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'finish loading' }));
    await waitFor(() =>
      expect(screen.getByTestId('selected-project').textContent).toBe('requested-novel'),
    );
    expect(opened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'finish loading' }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(opened).toHaveBeenCalledWith('requested-novel');
  });

  it('does not create on a different project when the requested project no longer exists', async () => {
    const opened = vi.fn();
    function MissingProjectHarness() {
      const location = useLocation();
      useWorkbenchIntent(opened, undefined, {
        selectedNovelId: 'previous-novel',
        novelIds: ['previous-novel'],
        loading: false,
        selectProject: vi.fn(),
      });
      return <output data-testid="missing-route">{location.pathname}</output>;
    }
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/',
            state: {
              workbenchIntent: 'new-task',
              workbenchNovelId: 'missing-novel',
            },
          },
        ]}
      >
        <MissingProjectHarness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('missing-route').textContent).toBe('/novels/missing-novel'),
    );
    expect(opened).not.toHaveBeenCalled();
  });

  it('consumes search once while callback/state updates precede the Router transition, then accepts a new history entry', async () => {
    const { onSearch, onCreate } = renderIntent('search');
    await waitFor(() => expect(screen.getByTestId('intent-state').textContent).toBe('cleared'));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('initial-intent');
    expect(screen.getByTestId('search-token').textContent).toBe('1');
    expect(screen.getByTestId('search-count').textContent).toBe('1');
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    await waitFor(() => expect(screen.getByTestId('search-token').textContent).toBe('2'));
    await waitFor(() => expect(screen.getByTestId('intent-state').textContent).toBe('cleared'));
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch.mock.calls[1][0]).not.toBe('initial-intent');
    expect(screen.getByTestId('search-count').textContent).toBe('2');
  });

  it('creates a task once despite StrictMode and an unstable callback, without suppressing the next request', async () => {
    const { onSearch, onCreate } = renderIntent('new-task');
    await waitFor(() => expect(screen.getByTestId('intent-state').textContent).toBe('cleared'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('create-count').textContent).toBe('1');
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByTestId('search-token').textContent).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(screen.getByTestId('create-count').textContent).toBe('2'));
    await waitFor(() => expect(screen.getByTestId('intent-state').textContent).toBe('cleared'));
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onSearch).not.toHaveBeenCalled();
  });
});
