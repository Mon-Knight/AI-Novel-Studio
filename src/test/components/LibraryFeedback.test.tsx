import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../../pages/Home/HomePage';
import AssetsPage from '../../pages/Assets/AssetsPage';
import AiTasksPageView, { type AiTasksPageViewProps } from '../../pages/AiTasks/AiTasksPageView';
import FirstTimeGuide from '../../components/common/FirstTimeGuide';
import { CreateNovelDialog } from '../../components/novel-card/CreateNovelDialog';
import { useNovelLibrary } from '../../features/novels/useNovelLibrary';
import { useAssetStatistics } from '../../features/assets/useAssetStatistics';
import type { Novel } from '../../types/novel';

const services = vi.hoisted(() => ({
  novels: vi.fn(),
  create: vi.fn(),
  characters: vi.fn(),
  worldSettings: vi.fn(),
  ruleSystems: vi.fn(),
  protagonist: vi.fn(),
  summaries: vi.fn(),
  context: vi.fn(),
  styles: vi.fn(),
  suggestions: vi.fn(),
  imports: vi.fn(),
  factions: vi.fn(),
  locations: vi.fn(),
}));
vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getAll: services.novels, create: services.create },
}));
vi.mock('../../services/novels/novelService', () => ({
  novelService: { deleteNovelCascade: vi.fn() },
}));
vi.mock('../../services/characters/characterService', () => ({
  characterService: { getByNovelId: services.characters },
}));
vi.mock('../../services/database/settingRepository', () => ({
  settingRepository: {
    getWorldSettings: services.worldSettings,
    getRuleSystems: services.ruleSystems,
  },
}));
vi.mock('../../services/database/protagonistRepository', () => ({
  protagonistRepository: { getByNovelId: services.protagonist },
}));
vi.mock('../../services/context/chapterSummaryService', () => ({
  chapterSummaryService: { getByNovelId: services.summaries },
}));
vi.mock('../../services/context/contextRecordService', () => ({
  contextRecordService: { getByNovelId: services.context },
}));
vi.mock('../../services/styles/styleProfileService', () => ({
  styleProfileService: { getAll: services.styles },
}));
vi.mock('../../services/settingSuggestions/settingSuggestionService', () => ({
  settingSuggestionService: { getByNovelId: services.suggestions },
}));
vi.mock('../../services/styles/importedAssetService', () => ({
  importedAssetService: { getAll: services.imports },
}));
vi.mock('../../services/content-transactions/contentTransactionService', () => ({
  contentTransactionService: {
    listFactions: services.factions,
    listLocations: services.locations,
  },
}));
vi.mock('../../services/database/db', () => ({ getDbMode: () => 'browser' }));
vi.mock('../../components/import/ImportTxtDialog', () => ({ default: () => null }));
vi.mock('../../components/import/ImportJsonDialog', () => ({ default: () => null }));

const timestamp = '2026-09-05T00:00:00.000Z';
function novel(id: string, title = id): Novel {
  return {
    id,
    title,
    description: '',
    outline: '',
    status: 'draft',
    protagonistMode: 'single',
    protagonists: [],
    dualProtagonistRelation: {
      type: 'custom',
      description: '',
      conflict: '',
      cooperation: '',
      emotionalProgression: '',
      narrativeWeight: 'balanced',
    },
    totalWordCount: 0,
    totalWords: 0,
    targetWords: 100000,
    createdAt: timestamp,
    updatedAt: timestamp,
    volumes: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const router = { v7_startTransition: true, v7_relativeSplatPath: true };

beforeEach(() => {
  services.novels.mockResolvedValue([]);
  services.create.mockResolvedValue(novel('created-novel', '创建的隔离作品'));
  for (const service of [
    services.characters,
    services.worldSettings,
    services.ruleSystems,
    services.protagonist,
    services.summaries,
    services.context,
    services.styles,
    services.suggestions,
    services.imports,
    services.factions,
    services.locations,
  ])
    service.mockResolvedValue([]);
  services.protagonist.mockResolvedValue(null);
});

describe('novel library read state and creation', () => {
  it('shows loading, then a real read error and retry, without calling either state an empty library', async () => {
    const first = deferred<Novel[]>();
    services.novels
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([novel('recovered-library', '恢复读取的作品')]);
    render(
      <MemoryRouter future={router}>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('正在读取作品…')).toBeTruthy();
    expect(screen.queryByText('还没有作品')).toBeNull();
    await act(async () => {
      first.reject(new Error('模拟作品读取失败'));
    });
    expect(screen.getByRole('alert').textContent).toContain('作品读取失败');
    expect(screen.queryByText('还没有作品')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByText('模拟作品读取失败')).toBeNull());
    expect(within(screen.getByTestId('project-list')).getByText('恢复读取的作品')).toBeTruthy();
  });

  it('shows an actual empty library only after a successful empty response', async () => {
    const pending = deferred<Novel[]>();
    services.novels.mockReturnValueOnce(pending.promise);
    render(
      <MemoryRouter future={router}>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.queryByText('还没有作品')).toBeNull();
    await act(async () => pending.resolve([]));
    expect(screen.getByText('还没有作品')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建第一部作品' })).toBeTruthy();
  });

  it('ignores an obsolete library refresh that resolves after the current refresh', async () => {
    const oldRead = deferred<Novel[]>();
    const currentRead = deferred<Novel[]>();
    services.novels.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(currentRead.promise);
    const { result } = renderHook(useNovelLibrary);
    let reloading!: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });
    await act(async () => {
      currentRead.resolve([novel('current')]);
      await reloading;
    });
    await act(async () => {
      oldRead.resolve([novel('obsolete')]);
    });
    expect(result.current.novels.map((row) => row.id)).toEqual(['current']);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('opens new-project creation with keyboard on a real button and exposes explicit field names', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter future={router}>
        <HomePage />
      </MemoryRouter>,
    );
    const create = screen.getByRole('button', { name: '新建作品' });
    expect(create.tagName).toBe('BUTTON');
    act(() => create.focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: '新建作品' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '作品名称 *' })).toBe(document.activeElement);
    expect(screen.getByRole('textbox', { name: '题材' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '简介' })).toBeTruthy();
  });

  it('prevents duplicate create submissions while the original creation is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<Novel>();
    services.create.mockReturnValueOnce(pending.promise);
    render(
      <MemoryRouter future={router}>
        <HomePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新建作品' }));
    await user.type(screen.getByRole('textbox', { name: '作品名称 *' }), '隔离创建作品');
    fireEvent.click(screen.getByTestId('project-save'));
    fireEvent.click(screen.getByTestId('project-save'));
    expect(services.create).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('project-save') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve(novel('created-by-test', '隔离创建作品')));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('prevents composing Enter and legacy IME keyCode 229, but submits normally outside composition', () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    const props = {
      value: { title: '新作品', genre: '', description: '' },
      busy: false,
      error: '',
      onChange: vi.fn(),
      onCreate,
      onCancel,
    };
    const view = render(<CreateNovelDialog {...props} />);
    const input = screen.getByRole('textbox', { name: '作品名称 *' });
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      const composing = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...options,
      });
      fireEvent(input, composing);
      expect(composing.defaultPrevented).toBe(true);
      expect(onCreate).not.toHaveBeenCalled();
    }
    const normal = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(input, normal);
    expect(normal.defaultPrevented).toBe(false);
    fireEvent.submit(input.closest('form')!);
    expect(onCreate).toHaveBeenCalledTimes(1);
    view.rerender(<CreateNovelDialog {...props} busy />);
    fireEvent.submit(input.closest('form')!);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
});

describe('project-scoped asset counts', () => {
  it('counts existing foundation categories instead of reporting one for every novel', async () => {
    services.novels.mockResolvedValue([novel('empty-foundation')]);
    const view = render(
      <MemoryRouter future={router}>
        <AssetsPage />
      </MemoryRouter>,
    );
    const card = await screen.findByRole('button', { name: /基础设定/ });
    await waitFor(() => expect(within(card).getByText('0')).toBeTruthy());
    view.unmount();
    services.worldSettings.mockResolvedValue([{}, {}]);
    services.ruleSystems.mockResolvedValue([{}]);
    services.protagonist.mockResolvedValue({ id: 'hero' });
    const { result } = renderHook(() => useAssetStatistics('populated-foundation'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.values.foundation).toBe(3);
    expect(services.worldSettings).toHaveBeenLastCalledWith('populated-foundation');
  });

  it('hides stale counts and ignores A when its slow response arrives after B', async () => {
    const old = deferred<unknown[]>();
    services.characters.mockImplementation((id: string) =>
      id === 'A' ? old.promise : Promise.resolve([{}, {}]),
    );
    const { result, rerender } = renderHook(({ id }) => useAssetStatistics(id), {
      initialProps: { id: 'A' },
    });
    expect(result.current.status).toBe('loading');
    expect(result.current.values).toEqual({});
    rerender({ id: 'B' });
    expect(result.current.novelId).toBe('B');
    expect(result.current.values).toEqual({});
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.values.chars).toBe(2);
    await act(async () => {
      old.resolve(Array.from({ length: 9 }, () => ({})));
    });
    expect(result.current.novelId).toBe('B');
    expect(result.current.values.chars).toBe(2);
    expect(services.factions).not.toHaveBeenCalled();
    expect(services.locations).not.toHaveBeenCalled();
  });

  it('discards a previous project error without replacing the current successful counts', async () => {
    const old = deferred<unknown[]>();
    services.characters.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{}]);
    const { result, rerender } = renderHook(({ id }) => useAssetStatistics(id), {
      initialProps: { id: 'A' },
    });
    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      old.reject(new Error('A读取失败'));
    });
    expect(result.current.novelId).toBe('B');
    expect(result.current.error).toBe('');
    expect(result.current.values.chars).toBe(1);
  });

  it('shows unavailable counts as a dash instead of zero, and retries the current project', async () => {
    services.novels.mockResolvedValue([novel('asset-project', '资产测试作品')]);
    services.characters
      .mockRejectedValueOnce(new Error('模拟资产读取失败'))
      .mockResolvedValueOnce([{}, {}, {}]);
    render(
      <MemoryRouter future={router}>
        <AssetsPage />
      </MemoryRouter>,
    );
    await screen.findByText('资产统计读取失败');
    const characters = screen.getByRole('button', { name: /角色库/ });
    expect(within(characters).getByText('—')).toBeTruthy();
    expect(within(characters).queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() =>
      expect(within(screen.getByRole('button', { name: /角色库/ })).getByText('3')).toBeTruthy(),
    );
    expect(screen.queryByText('资产统计读取失败')).toBeNull();
    expect(services.characters).toHaveBeenLastCalledWith('asset-project');
  });
});

describe('creation guide', () => {
  it('starts with three concise steps, expands the full process, and remains reopenable after dismissing', async () => {
    const user = userEvent.setup();
    render(<FirstTimeGuide />);
    const guide = screen.getByRole('complementary', { name: '创作指南' });
    expect(guide.querySelectorAll('.guide-steps > li')).toHaveLength(3);
    const details = guide.querySelector('details')!;
    expect(details.open).toBe(false);
    await user.click(within(guide).getByText('查看完整创作流程'));
    expect(details.open).toBe(true);
    expect(guide.querySelectorAll('.guide-full-steps > li')).toHaveLength(9);
    expect(within(guide).getByText(/保存草稿本身不等于采用/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭首次使用指南' }));
    expect(screen.queryByTestId('first-time-guide')).toBeNull();
    expect(localStorage.getItem('ai_novel_studio_guide_dismissed')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '查看创作指南' }));
    expect(screen.getByTestId('first-time-guide')).toBeTruthy();
  });
});

describe('AI record read and filter feedback', () => {
  function props(): AiTasksPageViewProps {
    return {
      tasks: [],
      total: 0,
      typeFilter: 'all',
      statusFilter: 'all',
      expandedId: null,
      msg: '',
      selectedIds: new Set(),
      selectMode: false,
      deleting: false,
      visibleCost: 0,
      totalPages: 1,
      visiblePage: 1,
      pagedTasks: [],
      executionStates: new Map(),
      onTypeFilterChange: vi.fn(),
      onStatusFilterChange: vi.fn(),
      onToggleSelectMode: vi.fn(),
      onToggleSelectAll: vi.fn(),
      onDeleteSelected: vi.fn(),
      onClearAll: vi.fn(),
      onDeleteFiltered: vi.fn(),
      onToggleSelect: vi.fn(),
      onToggleExpand: vi.fn(),
      onStopTask: vi.fn(),
      onDeleteOne: vi.fn(),
      onPreviousPage: vi.fn(),
      onNextPage: vi.fn(),
      onRetryLoad: vi.fn(),
    };
  }
  it('distinguishes loading, failure and empty filtered records, with an explicit clear-filter action', () => {
    const values = props();
    const wrap = (patch: Partial<AiTasksPageViewProps>) => (
      <MemoryRouter future={router}>
        <AiTasksPageView {...values} {...patch} />
      </MemoryRouter>
    );
    const view = render(wrap({ loading: true }));
    expect(screen.getByText('正在更新任务记录…')).toBeTruthy();
    expect(screen.queryByText('暂无 AI 任务记录')).toBeNull();
    view.rerender(wrap({ loadError: '记录读取失败' }));
    expect(screen.getByText('任务记录读取失败')).toBeTruthy();
    expect(screen.queryByText('暂无 AI 任务记录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(values.onRetryLoad).toHaveBeenCalledTimes(1);
    view.rerender(wrap({ typeFilter: 'chapter_generate', statusFilter: 'failed' }));
    expect(screen.getByText('当前筛选没有匹配记录')).toBeTruthy();
    expect(screen.queryByText('暂无 AI 任务记录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(values.onTypeFilterChange).toHaveBeenCalledWith('all');
    expect(values.onStatusFilterChange).toHaveBeenCalledWith('all');
  });
});
