import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DraftHistoryPanel from '../../components/right-dock/panels/DraftHistoryPanel';
import VolumeTree from '../../components/workspace/VolumeTree';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { QualityCheckReport } from '../../types/qualityCheck';
import type { Volume } from '../../types/volume';
import * as nativeDialog from '../../utils/nativeDialog';

const services = vi.hoisted(() => ({
  drafts: [] as ChapterDraft[],
  report: null as QualityCheckReport | null,
  adoptedDraft: null as ChapterDraft | null,
  getPageByChapterIdCalls: vi.fn(),
  adoptCalls: vi.fn(),
  getAdoptedByChapterIdCalls: vi.fn(),
  deleteDraftCalls: vi.fn(),
  getLatestReportCalls: vi.fn(),
}));

vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: {
    getPageByChapterId: async (chapterId: string, page: number, pageSize: number) => {
      services.getPageByChapterIdCalls(chapterId, page, pageSize);
      const sorted = [...services.drafts].sort((left, right) => right.versionNo - left.versionNo);
      return {
        items: sorted.slice((page - 1) * pageSize, page * pageSize),
        total: sorted.length,
      };
    },
    adopt: async (draftId: string, chapterId: string) => {
      services.adoptCalls(draftId, chapterId);
      return services.adoptedDraft;
    },
    getAdoptedByChapterId: async (chapterId: string) => {
      services.getAdoptedByChapterIdCalls(chapterId);
      return services.adoptedDraft;
    },
    delete: async (draftId: string, chapterId: string) =>
      services.deleteDraftCalls(draftId, chapterId),
  },
}));

vi.mock('../../services/quality/qualityCheckService', () => ({
  qualityCheckService: {
    getLatestReport: async (chapterId: string) => {
      services.getLatestReportCalls(chapterId);
      return services.report;
    },
  },
}));

const timestamp = '2026-07-28T00:00:00.000Z';

function draft(versionNo: number, overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    id: `draft-${versionNo}`,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    content: `正文版本 ${versionNo}`,
    source: versionNo % 2 === 0 ? 'ai_generated' : 'user_edited',
    versionNo,
    wordCount: versionNo * 100,
    isAdopted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function chapter(index: number, volumeId: string | undefined = 'volume-1'): Chapter {
  return {
    id: `chapter-${index}`,
    novelId: 'novel-1',
    volumeId,
    title: `章节 ${index}`,
    chapterNumber: index,
    orderIndex: index,
    sortOrder: index,
    status: index % 2 === 0 ? 'editing' : 'outline_ready',
    wordCount: 100,
    currentWords: 100,
    targetWords: 2_400,
    drafts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function volume(id = 'volume-1', orderIndex = 1): Volume {
  return {
    id,
    novelId: 'novel-1',
    title: `分卷 ${orderIndex}`,
    orderIndex,
    volumeNumber: orderIndex,
    sortOrder: orderIndex,
    status: 'writing',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

beforeEach(() => {
  services.drafts = [];
  services.report = null;
  services.adoptedDraft = null;
  services.getPageByChapterIdCalls.mockClear();
  services.adoptCalls.mockClear();
  services.getAdoptedByChapterIdCalls.mockClear();
  services.deleteDraftCalls.mockClear();
  services.getLatestReportCalls.mockClear();
  vi.spyOn(nativeDialog, 'confirmInfo').mockResolvedValue(true);
  vi.spyOn(nativeDialog, 'showError').mockResolvedValue();
});

describe('DraftHistoryPanel', () => {
  it('loads, paginates, restores, adopts and discards immutable draft versions', async () => {
    const drafts = Array.from({ length: 25 }, (_, index) => draft(index + 1));
    const adopted = draft(25, { isAdopted: true });
    const report: QualityCheckReport = {
      id: 'report-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      draftId: 'draft-25',
      scope: 'current_draft',
      status: 'completed',
      overallScore: 91,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    services.drafts = drafts;
    services.report = report;
    services.adoptedDraft = adopted;
    const onLoadDraft = vi.fn();
    const onDraftAdopted = vi.fn();
    const beforeChange = vi.fn(async () => true);
    const onClose = vi.fn();

    const view = render(
      <DraftHistoryPanel
        chapterId="chapter-1"
        currentDraftId="draft-25"
        onLoadDraft={onLoadDraft}
        onDraftAdopted={onDraftAdopted}
        onBeforeDocumentChange={beforeChange}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('draft-history-item')).toHaveLength(20));
    expect(screen.getByText('质检 91')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getAllByTestId('draft-history-item')).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await waitFor(() => expect(screen.getAllByTestId('draft-history-item')).toHaveLength(20));

    const first = screen.getAllByTestId('draft-history-item')[0];
    fireEvent.click(within(first).getByRole('button', { name: /恢复/ }));
    await waitFor(() =>
      expect(onLoadDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-25' })),
    );
    fireEvent.click(within(first).getByRole('button', { name: /采用/ }));
    await waitFor(() => expect(onDraftAdopted).toHaveBeenCalledWith(adopted));

    const second = screen.getAllByTestId('draft-history-item')[1];
    fireEvent.click(within(second).getByRole('button', { name: '废弃' }));
    await waitFor(() =>
      expect(services.deleteDraftCalls).toHaveBeenCalledWith('draft-24', 'chapter-1'),
    );

    fireEvent.mouseDown(view.container.querySelector('.right-panel') as HTMLElement);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(view.container.querySelector('.right-panel-overlay') as HTMLElement);
  });

  it('keeps document changes when the preflight declines and reports invalid history', async () => {
    services.drafts = [draft(1, { chapterId: 'other-chapter' })];
    const view = render(
      <DraftHistoryPanel
        chapterId="chapter-1"
        onLoadDraft={vi.fn()}
        onBeforeDocumentChange={async () => false}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('草稿历史加载失败');

    view.rerender(<DraftHistoryPanel chapterId="" onLoadDraft={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/暂无草稿/);
  });

  it('clears a pending draft-history message timer when the panel unmounts', async () => {
    services.drafts = [draft(1)];
    const view = render(
      <DraftHistoryPanel chapterId="chapter-1" onLoadDraft={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByTestId('draft-history-item');

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '废弃' }));
        for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      });

      expect(services.deleteDraftCalls).toHaveBeenCalledWith('draft-1', 'chapter-1');
      expect(screen.getByText('v1 已废弃')).not.toBeNull();
      expect(vi.getTimerCount()).toBe(1);

      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('does not schedule a message timer when draft deletion finishes after unmount', async () => {
    services.drafts = [draft(1)];
    let resolveDelete = () => undefined;
    services.deleteDraftCalls.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const view = render(
      <DraftHistoryPanel chapterId="chapter-1" onLoadDraft={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByTestId('draft-history-item');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '废弃' }));
      await act(async () => {
        for (let tick = 0; tick < 3; tick += 1) await Promise.resolve();
      });
      expect(services.deleteDraftCalls).toHaveBeenCalledWith('draft-1', 'chapter-1');

      view.unmount();
      await act(async () => {
        resolveDelete();
        for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      });

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});

describe('VolumeTree', () => {
  it('creates the first chapter and a first volume from the empty workspace', async () => {
    const createFirst = vi.fn(async () => undefined);
    const createVolume = vi.fn(async () => undefined);
    render(
      <VolumeTree
        volumes={[]}
        chapters={[]}
        activeChapterId=""
        onSelectChapter={vi.fn()}
        onCreateVolume={createVolume}
        onCreateChapter={vi.fn(async () => undefined)}
        onCreateFirstChapter={createFirst}
      />,
    );

    fireEvent.click(screen.getByTestId('chapter-create'));
    fireEvent.change(screen.getByTestId('chapter-title-input'), {
      target: { value: '  第一章  ' },
    });
    fireEvent.keyDown(screen.getByTestId('chapter-title-input'), { key: 'Enter' });
    await waitFor(() => expect(createFirst).toHaveBeenCalledWith('第一章', 4000));

    fireEvent.click(screen.getByTestId('volume-create'));
    fireEvent.change(screen.getByTestId('volume-title-input'), { target: { value: '  第一卷  ' } });
    fireEvent.click(screen.getByTestId('volume-save'));
    await waitFor(() => expect(createVolume).toHaveBeenCalledWith('第一卷'));
  });

  it('windows large chapter lists, selects chapters and creates inside a selected volume', async () => {
    const chapters = [
      ...Array.from({ length: 85 }, (_, index) => chapter(index + 1)),
      ...Array.from({ length: 82 }, (_, index) => chapter(index + 101, '')),
    ];
    const volumes = [volume('volume-2', 2), volume('volume-1', 1), volume('volume-empty', 3)];
    const onSelectChapter = vi.fn();
    const onCreateChapter = vi.fn(async () => undefined);
    render(
      <VolumeTree
        volumes={volumes}
        chapters={chapters}
        activeChapterId="chapter-1"
        onSelectChapter={onSelectChapter}
        onCreateVolume={vi.fn(async () => undefined)}
        onCreateChapter={onCreateChapter}
      />,
    );

    const firstChapterItem = screen.getAllByTestId('chapter-item')[0];
    expect(firstChapterItem.tagName).toBe('BUTTON');
    expect(firstChapterItem.getAttribute('aria-current')).toBe('page');
    fireEvent.click(firstChapterItem);
    expect(onSelectChapter).toHaveBeenCalled();
    const nextWindow = screen.getAllByRole('button', { name: '下一批' });
    fireEvent.click(nextWindow[0]);
    fireEvent.click(nextWindow[1]);

    const headers = document.querySelectorAll<HTMLElement>('.tree-volume-header');
    expect(headers[0].tagName).toBe('BUTTON');
    expect(headers[0].getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(headers[0]);
    fireEvent.click(headers[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '在本卷新建章节' })[0]);
    fireEvent.change(screen.getByTestId('chapter-volume-select'), {
      target: { value: 'volume-2' },
    });
    fireEvent.change(screen.getByTestId('chapter-title-input'), {
      target: { value: '  新章节  ' },
    });
    fireEvent.change(screen.getByTestId('chapter-target-word-count'), {
      target: { value: '4300' },
    });
    fireEvent.click(screen.getByTestId('chapter-create-submit'));
    await waitFor(() => expect(onCreateChapter).toHaveBeenCalledWith('volume-2', '新章节', 4300));
    expect(screen.getAllByText('暂无章节').length).toBeGreaterThan(0);
  });

  it('shows bounded creation failures without treating leave cancellation as an error', async () => {
    const createVolume = vi.fn(async () => {
      throw new Error('volume failure');
    });
    const createChapter = vi
      .fn<(_: string, __: string) => Promise<void>>()
      .mockRejectedValueOnce({ code: 'WORKSPACE_LEAVE_CANCELLED' })
      .mockRejectedValueOnce(new Error('chapter failure'));
    render(
      <VolumeTree
        volumes={[volume()]}
        chapters={[chapter(1)]}
        activeChapterId="chapter-1"
        onSelectChapter={vi.fn()}
        onCreateVolume={createVolume}
        onCreateChapter={createChapter}
      />,
    );
    fireEvent.click(screen.getByTestId('volume-create'));
    fireEvent.change(screen.getByTestId('volume-title-input'), { target: { value: '失败卷' } });
    fireEvent.click(screen.getByTestId('volume-save'));
    await waitFor(() => expect(nativeDialog.showError).toHaveBeenCalledTimes(1));

    for (const expectedCalls of [1, 2]) {
      fireEvent.click(screen.getByTestId('chapter-create'));
      fireEvent.change(screen.getByTestId('chapter-title-input'), { target: { value: '失败章' } });
      fireEvent.click(screen.getByTestId('chapter-create-submit'));
      await waitFor(() => expect(createChapter).toHaveBeenCalledTimes(expectedCalls));
    }
    expect(nativeDialog.showError).toHaveBeenCalledTimes(2);
  });

  it('renders the loading state and reports missing first-volume support', async () => {
    const view = render(
      <VolumeTree
        volumes={[]}
        chapters={[]}
        activeChapterId=""
        loading
        onSelectChapter={vi.fn()}
        onCreateVolume={vi.fn(async () => undefined)}
        onCreateChapter={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByText('加载中...')).not.toBeNull();
    view.rerender(
      <VolumeTree
        volumes={[]}
        chapters={[]}
        activeChapterId=""
        onSelectChapter={vi.fn()}
        onCreateVolume={vi.fn(async () => undefined)}
        onCreateChapter={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.click(screen.getByTestId('chapter-create'));
    fireEvent.change(screen.getByTestId('chapter-title-input'), { target: { value: '无卷章节' } });
    fireEvent.click(screen.getByTestId('chapter-create-submit'));
    await waitFor(() => expect(nativeDialog.showError).toHaveBeenCalled());
  });
});
