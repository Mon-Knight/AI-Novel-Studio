import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import OutlineManager from './OutlineManager';
import type {
  OutlineGenerationEvidence,
  OutlineGenerationOptions,
} from '../../types/outlineGeneration';

const state = vi.hoisted(() => ({
  volumes: [] as Volume[],
  chapters: [] as Chapter[],
  updateVolume: vi.fn(),
  updateChapter: vi.fn(),
  desktop: false,
  novelGenerate: vi.fn(),
  volumeGenerate: vi.fn(),
  chapterGenerate: vi.fn(),
  nativeApply: vi.fn(),
}));

vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: {
    getByNovelId: async () => [...state.volumes],
    update: async (id: string, input: Partial<Volume>) => {
      state.updateVolume(id, input);
      state.volumes = state.volumes.map((volume) =>
        volume.id === id ? { ...volume, ...input } : volume,
      );
    },
    remove: vi.fn(),
  },
}));

vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: {
    getByNovelId: async () => [...state.chapters],
    update: async (id: string, input: Partial<Chapter>) => {
      state.updateChapter(id, input);
      state.chapters = state.chapters.map((chapter) =>
        chapter.id === id ? { ...chapter, ...input } : chapter,
      );
    },
    saveDetails: async (baseline: Chapter, input: Partial<Chapter>) => {
      state.updateChapter(baseline.id, input);
      state.chapters = state.chapters.map((chapter) =>
        chapter.id === baseline.id ? { ...chapter, ...input } : chapter,
      );
    },
    remove: vi.fn(),
  },
}));

vi.mock('../../services/chapters/chapterCreationService', () => ({
  createVolumeForNovel: vi.fn(),
  createFirstVolumeAndChapter: vi.fn(),
  createChapterInVolume: vi.fn(),
}));

vi.mock('../../services/ai/outlineGenerateService', () => ({
  outlineGenerateService: {
    generateNovelOutline: state.novelGenerate,
    generateVolumeOutline: state.volumeGenerate,
    generateChapterOutlines: state.chapterGenerate,
  },
}));

vi.mock('../../services/outlines/outlineService', () => ({
  masterOutlineService: {
    getVersions: async () => [],
    save: vi.fn(),
    setActive: vi.fn(),
  },
}));

vi.mock('../../services/database/db', async (original) => ({
  ...(await original<typeof import('../../services/database/db')>()),
  isTauri: () => state.desktop,
}));
vi.mock('../../services/outlines/outlineCandidateApplicationService', () => ({
  applyNativeOutlineCandidate: state.nativeApply,
  outlineSourceFromSnapshot: () => null,
}));
vi.mock('../../lib/runWithLoading', () => ({
  runWithLoading: async (
    _options: unknown,
    execute: (context: {
      signal: AbortSignal;
      setStage: () => void;
      operationId: string;
    }) => Promise<void>,
  ) =>
    execute({
      signal: new AbortController().signal,
      setStage: vi.fn(),
      operationId: 'isolated-manager-ui',
    }),
  cancelLoadingOperation: vi.fn(),
}));

const timestamp = '2026-08-28T00:00:00.000Z';

function volume(): Volume {
  return {
    id: 'volume-1',
    novelId: 'novel-1',
    title: '正文',
    orderIndex: 1,
    volumeNumber: 1,
    sortOrder: 1,
    status: 'writing',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function chapter(): Chapter {
  return {
    id: 'chapter-1',
    novelId: 'novel-1',
    volumeId: 'volume-1',
    title: '第 1 章',
    chapterNumber: 1,
    orderIndex: 1,
    sortOrder: 1,
    status: 'outline_ready',
    outline: '已写入的章纲',
    wordCount: 0,
    currentWords: 0,
    targetWordCount: 4100,
    targetWords: 4100,
    drafts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.desktop = false;
  state.volumes = [volume()];
  state.chapters = [chapter()];
  state.updateVolume.mockClear();
  state.updateChapter.mockClear();
});

describe('OutlineManager edit dialogs', () => {
  it('closes chapter and volume dialogs after a successful edit save', async () => {
    const view = render(
      <MemoryRouter>
        <OutlineManager novelId="novel-1" />
      </MemoryRouter>,
    );

    await screen.findByText('第 1 章');
    fireEvent.click(screen.getByRole('button', { name: '编辑章节 第 1 章' }));
    const chapterDialog = screen.getByText('编辑章节').closest('.modal-dialog');
    expect(chapterDialog).not.toBeNull();
    fireEvent.click(within(chapterDialog as HTMLElement).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.updateChapter).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.container.querySelector('.modal-overlay')).toBeNull());
    expect(screen.queryByText('编辑章节')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const volumeDialog = screen.getByText('编辑分卷').closest('.modal-dialog');
    expect(volumeDialog).not.toBeNull();
    fireEvent.click(within(volumeDialog as HTMLElement).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.updateVolume).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.container.querySelector('.modal-overlay')).toBeNull());
    expect(screen.queryByText('编辑分卷')).toBeNull();
  });

  it('desktop chapter candidates stay editable on native conflict and apply by original bounded index without renderer creates', async () => {
    state.desktop = true;
    const source: OutlineGenerationEvidence = {
      version: 1,
      novelId: 'novel-1',
      conversationId: 'task',
      turnId: 'turn',
      runId: 'run',
      cardId: 'card',
      artifactId: 'artifact',
      artifactHash: 'a'.repeat(64),
      request: {
        kind: 'outline_generate',
        outlineType: 'chapter',
        format: 'chapter_candidates',
        volumeId: 'volume-1',
        chapterCount: 3,
      },
    };
    state.chapterGenerate.mockImplementation(
      async (_request: unknown, options: OutlineGenerationOptions) => {
        options.onCandidate?.(source);
        return [
          { title: '候选一', outline: '第一份原生提纲', runtimeIndex: 0 },
          { title: '候选二', outline: '第二份原生提纲', runtimeIndex: 1 },
        ];
      },
    );
    state.nativeApply
      .mockRejectedValueOnce(new Error('OUTLINE_BASELINE_CONFLICT'))
      .mockResolvedValue({ receipt: { receiptId: 'committed' } });
    render(
      <MemoryRouter>
        <OutlineManager novelId="novel-1" />
      </MemoryRouter>,
    );
    await screen.findByText('第 1 章');
    fireEvent.click(screen.getByRole('button', { name: '生成章节大纲' }));
    const body = await screen.findByLabelText('章节候选 1 大纲');
    fireEvent.change(body, { target: { value: '必须保留的作者修改' } });
    fireEvent.click(screen.getAllByRole('button', { name: '确认保存为章节' })[0]);
    await screen.findByText(/OUTLINE_BASELINE_CONFLICT/);
    expect(screen.getByDisplayValue('必须保留的作者修改')).not.toBeNull();
    expect(state.updateChapter).not.toHaveBeenCalled();
    expect(state.nativeApply.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        kind: 'chapter',
        candidateIndex: 0,
        candidate: expect.objectContaining({ outline: '必须保留的作者修改' }),
      }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: '确认保存为章节' })[0]);
    await waitFor(() => expect(screen.queryByDisplayValue('必须保留的作者修改')).toBeNull());
    expect(screen.getByDisplayValue('第二份原生提纲')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确认保存为章节' }));
    await waitFor(() => expect(state.nativeApply).toHaveBeenCalledTimes(3));
    expect(state.nativeApply.mock.calls[2][1]).toEqual(
      expect.objectContaining({ candidateIndex: 1 }),
    );
    expect(state.chapterGenerate).toHaveBeenCalledOnce();
  });
});
