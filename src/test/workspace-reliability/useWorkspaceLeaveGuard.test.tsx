import { useState } from 'react';
import {
  Link,
  RouterProvider,
  createHashRouter,
  createMemoryRouter,
} from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../deferred';

interface CloseEventLike {
  preventDefault(): void;
}

type CloseHandler = (event: CloseEventLike) => void;

const tauriHarness = vi.hoisted(() => ({
  closeHandler: null as CloseHandler | null,
  unlisten: vi.fn(),
  close: vi.fn<() => Promise<void>>(),
  onCloseRequested: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  appWindow: {
    close: tauriHarness.close,
    onCloseRequested: tauriHarness.onCloseRequested,
  },
}));

vi.mock('../../services/tauri/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/tauri/runtime')>();
  return { ...original, isTauriRuntime: () => true };
});

import { useWorkspaceLeaveGuard } from '../../hooks/useWorkspaceLeaveGuard';

interface GuardHarnessProps {
  save: () => Promise<boolean>;
  discard?: () => Promise<void>;
  shouldGuard?: boolean;
  contentAvailable?: boolean;
}

function GuardHarness({
  save,
  discard = async () => undefined,
  shouldGuard = true,
  contentAvailable = true,
}: GuardHarnessProps) {
  const [continued, setContinued] = useState<string[]>([]);
  const guard = useWorkspaceLeaveGuard({
    shouldGuard,
    contentAvailable,
    save,
    discard,
  });

  const requestChapter = (chapterId: string) => {
    void guard.requestWorkspaceLeave({
      reason: 'chapter_switch',
      targetChapterId: chapterId,
      continueAction: () => setContinued((items) => [...items, chapterId]),
    });
  };

  return (
    <div>
      <button onClick={() => requestChapter('chapter-b')}>切换 B</button>
      <button onClick={() => requestChapter('chapter-c')}>切换 C</button>
      <div data-testid="continued">{continued.join(',')}</div>
      {guard.dialog}
    </div>
  );
}

function renderWithMemoryRouter(element: React.ReactNode) {
  const router = createMemoryRouter([
    { path: '/', element },
  ], { initialEntries: ['/'] });
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('workspace leave guard', () => {
  beforeEach(() => {
    tauriHarness.closeHandler = null;
    tauriHarness.unlisten.mockReset();
    tauriHarness.close.mockReset().mockResolvedValue(undefined);
    tauriHarness.onCloseRequested.mockReset().mockImplementation(async (handler: CloseHandler) => {
      tauriHarness.closeHandler = handler;
      return tauriHarness.unlisten;
    });
  });

  it('T02 waits for a successful save before switching chapters', async () => {
    const saveRequest = deferred<boolean>();
    const save = vi.fn(() => saveRequest.promise);
    const user = userEvent.setup();
    renderWithMemoryRouter(<GuardHarness save={save} />);

    await user.click(screen.getByRole('button', { name: '切换 B' }));
    await user.click(screen.getByRole('button', { name: '保存并继续' }));
    expect(screen.getByTestId('continued').textContent).toBe('');
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => saveRequest.resolve(true));
    await waitFor(() => expect(screen.getByTestId('continued').textContent).toBe('chapter-b'));
  });

  it('T03 retains the active chapter and decision dialog when saving fails', async () => {
    const save = vi.fn(async () => false);
    const user = userEvent.setup();
    renderWithMemoryRouter(<GuardHarness save={save} />);

    await user.click(screen.getByRole('button', { name: '切换 B' }));
    await user.click(screen.getByRole('button', { name: '保存并继续' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('continued').textContent).toBe('');
    expect(screen.getByTestId('workspace-leave-dialog')).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('T04 blocks a real data Hash Router transition when the user cancels', async () => {
    // Node's undici Request rejects jsdom's AbortSignal even though both obey
    // the web contract. React Router only needs these request identity fields
    // for this loader-free navigation, so keep the test focused on hash
    // transition blocking instead of coupling it to two DOM implementations.
    class RouterTestRequest {
      readonly url: string;
      readonly method: string;
      readonly signal: AbortSignal | null;
      readonly headers: Headers;

      constructor(input: string | URL | { url: string }, init: RequestInit = {}) {
        this.url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
        this.method = init.method ?? 'GET';
        this.signal = init.signal ?? null;
        this.headers = new Headers(init.headers);
      }
    }
    vi.stubGlobal('Request', RouterTestRequest);
    window.location.hash = '#/';
    const save = vi.fn(async () => true);

    function RouteGuard() {
      const guard = useWorkspaceLeaveGuard({
        shouldGuard: true,
        contentAvailable: true,
        save,
        discard: async () => undefined,
      });
      return <><Link to="/other">离开工作区</Link>{guard.dialog}</>;
    }

    const router = createHashRouter([
      { path: '/', element: <RouteGuard /> },
      { path: '/other', element: <div>其他页面</div> },
    ], { window });
    const user = userEvent.setup();
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('link', { name: '离开工作区' }));
    expect(await screen.findByTestId('workspace-leave-dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByText('其他页面')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    router.dispose();
  });

  it('T05 prevents native close when the user cancels', async () => {
    const user = userEvent.setup();
    renderWithMemoryRouter(<GuardHarness save={async () => true} />);
    await waitFor(() => expect(tauriHarness.closeHandler).not.toBeNull());
    const event = { preventDefault: vi.fn() };

    act(() => tauriHarness.closeHandler?.(event));
    expect(await screen.findByTestId('workspace-leave-dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(tauriHarness.close).not.toHaveBeenCalled();
  });

  it('T06 saves once and bypasses exactly one recursive close event', async () => {
    const save = vi.fn(async () => true);
    const recursivePrevent = vi.fn();
    tauriHarness.close.mockImplementation(async () => {
      tauriHarness.closeHandler?.({ preventDefault: recursivePrevent });
    });
    const user = userEvent.setup();
    renderWithMemoryRouter(<GuardHarness save={save} />);
    await waitFor(() => expect(tauriHarness.closeHandler).not.toBeNull());

    act(() => tauriHarness.closeHandler?.({ preventDefault: vi.fn() }));
    await user.click(await screen.findByRole('button', { name: '保存并继续' }));

    await waitFor(() => expect(tauriHarness.close).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(recursivePrevent).not.toHaveBeenCalled();
  });

  it('T07 ignores a second native close while the first save is pending', async () => {
    const saveRequest = deferred<boolean>();
    const save = vi.fn(() => saveRequest.promise);
    const user = userEvent.setup();
    renderWithMemoryRouter(<GuardHarness save={save} />);
    await waitFor(() => expect(tauriHarness.closeHandler).not.toBeNull());

    act(() => tauriHarness.closeHandler?.({ preventDefault: vi.fn() }));
    await user.click(await screen.findByRole('button', { name: '保存并继续' }));
    const secondEvent = { preventDefault: vi.fn() };
    act(() => tauriHarness.closeHandler?.(secondEvent));

    expect(screen.getAllByTestId('workspace-leave-dialog')).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    await act(async () => saveRequest.resolve(true));
    await waitFor(() => expect(tauriHarness.close).toHaveBeenCalledTimes(1));
  });

  it('T12 allows only one decision across chapter and close requests', async () => {
    const discard = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderWithMemoryRouter(<GuardHarness save={async () => true} discard={discard} />);
    await waitFor(() => expect(tauriHarness.closeHandler).not.toBeNull());

    await user.click(screen.getByRole('button', { name: '切换 B' }));
    await user.click(screen.getByRole('button', { name: '切换 C' }));
    act(() => tauriHarness.closeHandler?.({ preventDefault: vi.fn() }));

    expect(screen.getAllByTestId('workspace-leave-dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '放弃修改并继续' }));

    await waitFor(() => expect(screen.getByTestId('continued').textContent).toBe('chapter-b'));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(tauriHarness.close).not.toHaveBeenCalled();
  });

  it('guards an unavailable document without deleting recovery or offering save', async () => {
    const save = vi.fn(async () => true);
    const discard = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderWithMemoryRouter(
      <GuardHarness save={save} discard={discard} contentAvailable={false} />,
    );

    await user.click(screen.getByRole('button', { name: '切换 B' }));
    expect(await screen.findByText('正文暂时无法完整读取')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存并继续' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '继续离开' }));

    await waitFor(() => expect(screen.getByTestId('continued').textContent).toBe('chapter-b'));
    expect(save).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });
});
