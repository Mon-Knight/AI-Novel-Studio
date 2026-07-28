import { beforeEach, describe, expect, it } from 'vitest';
import type { ChapterDraft } from '../../types/ai';
import { draftVersionService } from './draftVersionService';

const CHAPTER_ID = 'chapter-pagination';
const STORAGE_KEY = `ai_novel_studio_drafts_list_${CHAPTER_ID}`;

function draft(versionNo: number): ChapterDraft {
  return {
    id: `draft-${versionNo}`,
    novelId: 'novel-1',
    chapterId: CHAPTER_ID,
    content: `第 ${versionNo} 版正文`,
    source: 'user_edited',
    versionNo,
    wordCount: 6,
    isAdopted: versionNo === 45,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, versionNo)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, versionNo)).toISOString(),
  };
}

describe('draftVersionService pagination fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from({ length: 45 }, (_, i) => draft(i + 1))),
    );
  });

  it('counts first and pages before hydrating only the visible drafts', async () => {
    const result = await draftVersionService.getPageByChapterId(CHAPTER_ID, 2, 20);

    expect(result.total).toBe(45);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.versionNo).toBe(25);
    expect(result.items[19]?.versionNo).toBe(6);
    expect(result.items.every((item) => item.contentState?.status === 'ready')).toBe(true);
  });

  it('reads the adopted draft directly instead of loading the full history', async () => {
    const adopted = await draftVersionService.getAdoptedByChapterId(CHAPTER_ID);

    expect(adopted?.id).toBe('draft-45');
    expect(adopted?.isAdopted).toBe(true);
  });
});
