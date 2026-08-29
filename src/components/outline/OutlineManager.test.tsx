import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import OutlineManager from './OutlineManager';

const state = vi.hoisted(() => ({
  volumes: [] as Volume[],
  chapters: [] as Chapter[],
  updateVolume: vi.fn(),
  updateChapter: vi.fn(),
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
    generateNovelOutline: vi.fn(),
    generateVolumeOutline: vi.fn(),
    generateChapterOutlines: vi.fn(),
  },
}));

vi.mock('../../services/outlines/outlineService', () => ({
  masterOutlineService: {
    getVersions: async () => [],
    save: vi.fn(),
    setActive: vi.fn(),
  },
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
    fireEvent.click(screen.getByRole('button', { name: '✏️' }));
    const chapterDialog = screen.getByText('编辑章节').closest('.modal-dialog');
    expect(chapterDialog).not.toBeNull();
    fireEvent.click(within(chapterDialog as HTMLElement).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.updateChapter).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.container.querySelector('.modal-overlay')).toBeNull());
    expect(screen.queryByText('新建章节')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '✏️ 编辑' }));
    const volumeDialog = screen.getByText('编辑分卷').closest('.modal-dialog');
    expect(volumeDialog).not.toBeNull();
    fireEvent.click(within(volumeDialog as HTMLElement).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(state.updateVolume).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.container.querySelector('.modal-overlay')).toBeNull());
    expect(screen.queryByText('新建分卷')).toBeNull();
  });
});
