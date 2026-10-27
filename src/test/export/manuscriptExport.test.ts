import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type { Volume } from '../../types/volume';

const mocks = vi.hoisted(() => ({
  chapters: vi.fn(),
  chapter: vi.fn(),
  draft: vi.fn(),
  volumes: vi.fn(),
  save: vi.fn(),
  novel: vi.fn(),
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getByNovelId: mocks.chapters, getById: mocks.chapter },
}));
vi.mock('../../services/database/novelRepository', () => ({
  novelRepository: { getById: mocks.novel },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: { getAdoptedByChapterId: mocks.draft },
}));
vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getByNovelId: mocks.volumes },
}));
vi.mock('../../services/backup/projectBackupService', () => ({
  createCompleteProjectBackup: vi.fn(),
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '3.7.0') }));
vi.mock('../../services/tauri/scopedDesktopFs', () => ({ writeTextFromSaveDialog: mocks.save }));

import {
  exportNovelToTxt,
  exportNovelToMarkdown,
  exportChapterToTxt,
} from '../../services/export/exportService';
import { formatChapterHeading } from '../../utils/chapterHeading';

function chapter(number: number, overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: `c${number}`,
    novelId: 'novel',
    volumeId: 'volume',
    title: `第${number}章【正文${number}】`,
    chapterNumber: number,
    orderIndex: number,
    sortOrder: number,
    status: 'adopted',
    adoptedDraftId: `d${number}`,
    wordCount: 999,
    currentWords: 999,
    targetWords: 3400,
    drafts: [],
    createdAt: '2026-10-16',
    updatedAt: '2026-10-16',
    ...overrides,
  };
}
function draft(number: number, overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  const content = `正式正文${number}`;
  return {
    id: `d${number}`,
    chapterId: `c${number}`,
    novelId: 'novel',
    content,
    contentState: {
      status: 'ready',
      content,
      contentHash: 'verified-by-repository',
      contentLength: content.length,
    },
    source: 'user_edited',
    versionNo: 1,
    wordCount: 999,
    isAdopted: true,
    createdAt: '2026-10-16',
    updatedAt: '2026-10-16',
    ...overrides,
  };
}

function volume(number: number, overrides: Partial<Volume> = {}): Volume {
  return {
    id: `v${number}`,
    novelId: 'novel',
    title: `第${number}卷`,
    orderIndex: number - 1,
    sortOrder: number - 1,
    volumeNumber: number,
    status: 'completed',
    createdAt: '2026-10-16',
    updatedAt: '2026-10-16',
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.novel.mockResolvedValue({ id: 'novel', title: '作品' });
  mocks.chapters.mockResolvedValue([chapter(1), chapter(2)]);
  mocks.chapter.mockResolvedValue(chapter(1));
  mocks.draft.mockImplementation(async (id: string) => draft(Number(id.slice(1))));
  mocks.volumes.mockResolvedValue([volume(1, { id: 'volume', title: '第一卷' })]);
  mocks.save.mockResolvedValue('F:/exports/book.txt');
});

describe('complete adopted manuscript exports', () => {
  it('counts actual exported prose, normalizes headings and reports a body-free receipt', async () => {
    const progress = vi.fn();
    await exportNovelToTxt('novel', { onProgress: progress });
    const body = mocks.save.mock.calls[0][1] as string;
    expect(body).toContain('第1章 【正文1】');
    expect(body).not.toContain('第1章 第1章');
    expect(body).toContain('已导出：2 章\n总字数：10 字');
    expect(body.indexOf('正式正文1')).toBeLessThan(body.indexOf('正式正文2'));
    expect(progress.mock.calls[progress.mock.calls.length - 1]?.[0]).toEqual({
      stage: 'complete',
      chapterCount: 2,
      totalChapters: 2,
      wordCount: 10,
    });
    expect(progress.mock.calls.some(([event]) => event.stage === 'saving')).toBe(true);
  });

  it.each(['txt', 'md'])(
    'refuses the whole %s file when one adopted draft is missing',
    async (format) => {
      mocks.draft.mockImplementation(async (id: string) => (id === 'c2' ? null : draft(1)));
      const operation = format === 'txt' ? exportNovelToTxt : exportNovelToMarkdown;
      await expect(operation('novel')).rejects.toThrow('第2章');
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it('never exports preview content when full text is unavailable', async () => {
    mocks.draft.mockResolvedValue(
      draft(1, {
        content: '预览不能代替正文',
        contentState: { status: 'unavailable', retryable: true, errorCode: 'READ_FAILED' },
      }),
    );
    await expect(exportChapterToTxt('c1')).rejects.toThrow('完整正文读取失败');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other-draft' },
    { novelId: 'other-novel' },
    { chapterId: 'other-chapter' },
    { isAdopted: false },
  ])('refuses changed or cross-scope adopted drafts: %j', async (override) => {
    mocks.draft.mockResolvedValue(draft(1, override));
    await expect(exportChapterToTxt('c1')).rejects.toThrow('归属不匹配');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('refuses a chapter or adoption change while the book is being read', async () => {
    mocks.chapters
      .mockResolvedValueOnce([chapter(1), chapter(2)])
      .mockResolvedValueOnce([chapter(1), chapter(2, { adoptedDraftId: 'new-adoption' })]);
    await expect(exportNovelToTxt('novel')).rejects.toThrow('读取期间');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('refuses changed full text even when the adopted pointer returns to the same draft id', async () => {
    let firstChapterReads = 0;
    mocks.draft.mockImplementation(async (id: string) => {
      if (id !== 'c1' || firstChapterReads++ === 0) return draft(Number(id.slice(1)));
      const content = '原稿取消采用后被编辑，再次采用同一ID';
      return draft(1, {
        content,
        contentState: {
          status: 'ready',
          content,
          contentHash: 'new-verified-body',
          contentLength: content.length,
        },
      });
    });
    await expect(exportNovelToTxt('novel')).rejects.toThrow('采用稿正文已变化');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['txt', 'md'])(
    'keeps complete volumes together in %s when chapter indices restart',
    async (format) => {
      mocks.volumes.mockResolvedValue([volume(2), volume(1)]);
      mocks.chapters.mockResolvedValue([
        chapter(3, { volumeId: 'v2', orderIndex: 0 }),
        chapter(1, { volumeId: 'v1', orderIndex: 0 }),
        chapter(4, { volumeId: 'v2', orderIndex: 1 }),
        chapter(2, { volumeId: 'v1', orderIndex: 1 }),
      ]);
      const operation = format === 'txt' ? exportNovelToTxt : exportNovelToMarkdown;
      await operation('novel');
      const body = mocks.save.mock.calls[0][1] as string;
      for (const number of [1, 2, 3]) {
        expect(body.indexOf(`正式正文${number}`)).toBeLessThan(
          body.indexOf(`正式正文${number + 1}`),
        );
      }
      expect(body.match(/第1卷/g)).toHaveLength(1);
      expect(body.match(/第2卷/g)).toHaveLength(1);
      expect(body).toContain('已导出：4 章');
    },
  );

  it.each([
    { title: '已改卷名' },
    { orderIndex: 4 },
    { sortOrder: 4 },
    { deletedAt: '2026-10-17' },
  ])('refuses volume changes while reading: %j', async (change) => {
    mocks.volumes
      .mockResolvedValueOnce([volume(1, { id: 'volume' })])
      .mockResolvedValueOnce([volume(1, { id: 'volume', ...change })]);
    await expect(exportNovelToMarkdown('novel')).rejects.toThrow('读取期间分卷');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('uses stable chapter tie-breaks without treating repository arrival order as a change', async () => {
    const first = chapter(1, { orderIndex: 0, sortOrder: 0 });
    const second = chapter(2, { orderIndex: 0, sortOrder: 0 });
    mocks.chapters.mockResolvedValueOnce([second, first]).mockResolvedValueOnce([first, second]);
    await exportNovelToTxt('novel');
    const body = mocks.save.mock.calls[0][1] as string;
    expect(body.indexOf('正式正文1')).toBeLessThan(body.indexOf('正式正文2'));
  });

  it('refuses cross-project volume metadata before opening the save dialog', async () => {
    mocks.volumes.mockResolvedValue([volume(1, { novelId: 'other-novel' })]);
    await expect(exportNovelToTxt('novel')).rejects.toThrow('分卷归属不匹配');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('includes a formal chapter even when its UI status is editing and a volume is missing', async () => {
    mocks.chapters.mockResolvedValue([
      chapter(1, { status: 'editing', volumeId: 'missing-volume' }),
      chapter(2),
    ]);
    await exportNovelToMarkdown('novel');
    const body = mocks.save.mock.calls[0][1] as string;
    expect(body).toContain('正式正文1');
    expect(body).toContain('正式正文2');
    expect(body).toContain('## 未分卷章节');
    expect(body.indexOf('正式正文1')).toBeLessThan(body.indexOf('正式正文2'));
  });

  it('does not claim completion when the user cancels the save dialog', async () => {
    mocks.save.mockResolvedValue(null);
    const progress = vi.fn();
    await expect(exportNovelToTxt('novel', { onProgress: progress })).rejects.toThrow('取消');
    expect(progress.mock.calls.some(([event]) => event.stage === 'complete')).toBe(false);
  });

  it('keeps formal chapters with invalid missing pointers visible as errors', async () => {
    mocks.chapters.mockResolvedValue([chapter(1, { adoptedDraftId: undefined })]);
    await expect(exportNovelToTxt('novel')).rejects.toThrow('采用稿指针缺失');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('handles a title with a Chinese chapter number without altering its actual text', () => {
    expect(formatChapterHeading({ chapterNumber: 10, title: '第十章：雨停之前' })).toBe(
      '第10章 雨停之前',
    );
    expect(formatChapterHeading({ chapterNumber: 1, title: '街角的第十章' })).toBe(
      '第1章 街角的第十章',
    );
  });

  it.each<[number, string, string]>([
    [1, '第１章：雨停之前', '第1章 雨停之前'],
    [10, '第１０章 第十章：第10章．雨停之前', '第10章 雨停之前'],
    [1, '第1章 第1章 雨停之前', '第1章 雨停之前'],
    [1, '第１章 第一章', '第1章'],
    [1, '第一章人生', '第1章 人生'],
    [1, '街角的第一章人生', '第1章 街角的第一章人生'],
    [1, '《第一章人生》', '第1章 《第一章人生》'],
    [1, '第一卷 第１章：雨停之前', '第1章 第一卷 第１章：雨停之前'],
  ])('normalizes only leading chapter prefixes: %s / %s', (chapterNumber, title, expected) => {
    expect(formatChapterHeading({ chapterNumber, title })).toBe(expected);
  });

  it.each(['txt', 'md'])(
    'exports one canonical heading for repeated mixed-width prefixes in %s',
    async (format) => {
      mocks.chapters.mockResolvedValue([
        chapter(1, { title: '第１章 第一章 第1章：雨停之前' }),
        chapter(2),
      ]);
      const operation = format === 'txt' ? exportNovelToTxt : exportNovelToMarkdown;
      await operation('novel');
      const body = mocks.save.mock.calls[0][1] as string;
      expect(body.match(/第1章 雨停之前/g)).toHaveLength(1);
      expect(body).not.toContain('第１章');
      expect(body).not.toContain('第一章');
      expect(body).toContain('正式正文1');
      expect(body).toContain('正式正文2');
    },
  );
});
