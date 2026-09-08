import { describe, expect, it, vi } from 'vitest';
import type { Novel } from '../../types/novel';
import { importTxtNovelInBrowser, type BrowserImportSteps } from './txtImportService';

const novel = { id: 'novel-1', title: '导入测试' } as Novel;

function steps(overrides: Partial<BrowserImportSteps> = {}): BrowserImportSteps & {
  calls: string[];
} {
  const calls: string[] = [];
  let chapterSeq = 0;
  return {
    calls,
    createNovel: vi.fn(async () => {
      calls.push('novel');
      return novel;
    }),
    createVolume: vi.fn(async () => {
      calls.push('volume');
      return { id: 'volume-1' };
    }),
    createChapter: vi.fn(async (input) => {
      chapterSeq += 1;
      calls.push(`chapter:${input.orderIndex}`);
      return { id: `chapter-${chapterSeq}` };
    }),
    createDraft: vi.fn(async (input) => {
      calls.push(`draft:${input.chapterId}`);
      return { id: `draft-${input.chapterId}` };
    }),
    deleteNovelCascade: vi.fn(async () => {
      calls.push('cascade-delete');
    }),
    ...overrides,
  };
}

describe('importTxtNovelInBrowser', () => {
  it('writes chapters in order and reports progress without any compensation on success', async () => {
    const io = steps();
    const progress: number[] = [];
    const result = await importTxtNovelInBrowser(
      {
        title: ' 书名 ',
        chapters: [
          { title: '第二章', content: '二二二', orderIndex: 2 },
          { title: '第一章', content: '一一一 hello world', orderIndex: 1 },
        ],
      },
      io,
      (update) => progress.push(update.percent),
    );
    expect(io.createNovel).toHaveBeenCalledWith({
      title: '书名',
      genre: undefined,
      description: '由 TXT 导入',
    });
    expect(io.calls).toEqual([
      'novel',
      'volume',
      'chapter:1',
      'draft:chapter-1',
      'chapter:2',
      'draft:chapter-2',
    ]);
    expect(result.chapterCount).toBe(2);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章']);
    expect(result.chapters[0].wordCount).toBe(5);
    expect(result.totalWordCount).toBe(8);
    expect(progress).toEqual([0, 45, 90]);
    expect(io.deleteNovelCascade).not.toHaveBeenCalled();
  });

  it('cascade-deletes the half-imported novel when a later step fails and rethrows the cause', async () => {
    const io = steps({
      createDraft: vi.fn(async (input) => {
        if (input.chapterId === 'chapter-2') throw new Error('disk full');
        return { id: `draft-${input.chapterId}` };
      }),
    });
    await expect(
      importTxtNovelInBrowser(
        {
          title: '书名',
          chapters: [
            { title: '第一章', content: '一', orderIndex: 1 },
            { title: '第二章', content: '二', orderIndex: 2 },
          ],
        },
        io,
      ),
    ).rejects.toThrow('disk full');
    expect(io.deleteNovelCascade).toHaveBeenCalledWith('novel-1');
    expect(io.calls[io.calls.length - 1]).toBe('cascade-delete');
  });

  it('does not attempt compensation when the novel itself was never created', async () => {
    const io = steps({
      createNovel: vi.fn(async () => {
        throw new Error('quota');
      }),
    });
    await expect(
      importTxtNovelInBrowser(
        { title: '书名', chapters: [{ title: '第一章', content: '一', orderIndex: 1 }] },
        io,
      ),
    ).rejects.toThrow('quota');
    expect(io.deleteNovelCascade).not.toHaveBeenCalled();
  });
});
