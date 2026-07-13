import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: {
    getAll: mocks.getAll,
    create: vi.fn(),
  },
}));
vi.mock('../../services/novels/novelService', () => ({
  novelService: { deleteNovelCascade: vi.fn() },
}));
vi.mock('../../components/common/FirstTimeGuide', () => ({ default: () => null }));
vi.mock('../../components/novel-card/NovelCard', () => ({
  default: ({ novel }: { novel: { title: string } }) => <div data-testid="novel-card">{novel.title}</div>,
}));
vi.mock('../../components/import/ImportTxtDialog', () => ({ default: () => null }));
vi.mock('../../components/import/ImportJsonDialog', () => ({ default: () => null }));

import HomePage from '../../pages/Home/HomePage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

describe('home cold-start hydration', () => {
  beforeEach(() => {
    mocks.getAll.mockReset();
  });

  it('shows an honest loading state instead of a false empty library, then renders persisted novels', async () => {
    const pending = deferred<unknown[]>();
    mocks.getAll.mockReturnValue(pending.promise);
    renderPage();

    expect(screen.getByRole('status').textContent).toContain('正在读取本地作品');
    expect(screen.queryByText('还没有作品，点击上方「新建作品」开始')).toBeNull();
    expect(screen.getByText('新建作品')).toBeTruthy();

    pending.resolve([{ id: 'novel-1', title: '持久化作品' }]);

    expect(await screen.findByText('持久化作品')).toBeTruthy();
    expect(screen.getByText('共 1 部')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a retryable error instead of pretending a failed query is an empty library', async () => {
    mocks.getAll.mockRejectedValueOnce(new Error('database busy'));
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('作品列表加载失败');
    expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy();
    expect(screen.queryByText('还没有作品，点击上方「新建作品」开始')).toBeNull();
    await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(1));
  });
});
