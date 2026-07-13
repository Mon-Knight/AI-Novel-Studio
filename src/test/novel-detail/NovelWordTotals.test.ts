import { describe, expect, it } from 'vitest';

import { novelRepository } from '../../services/database/novelRepository';
import type { Novel } from '../../types/novel';

function storedNovel(): Novel {
  return {
    id: 'novel-1',
    title: '统计测试',
    description: '',
    outline: '',
    protagonistMode: 'single',
    protagonists: [],
    dualProtagonistRelation: {
      type: 'partner', description: '', conflict: '', cooperation: '',
      emotionalProgression: '', narrativeWeight: 'balanced',
    },
    status: 'writing',
    totalWordCount: 999999,
    totalWords: 999999,
    targetWordCount: 1000,
    targetWords: 1000,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    volumes: [],
  };
}

describe('local novel adopted word totals', () => {
  it('ignores stale caches and follows only the current adopted draft', async () => {
    localStorage.setItem('ai_novel_studio_novels', JSON.stringify([storedNovel()]));
    localStorage.setItem('ai_novel_studio_chapters', JSON.stringify([
      { id: 'chapter-1', novelId: 'novel-1', adoptedDraftId: 'draft-current' },
    ]));
    localStorage.setItem('ai_novel_studio_drafts_list_chapter-1', JSON.stringify([
      { id: 'draft-old', novelId: 'novel-1', chapterId: 'chapter-1', wordCount: 900, isAdopted: true },
      { id: 'draft-current', novelId: 'novel-1', chapterId: 'chapter-1', wordCount: 42, isAdopted: true },
    ]));

    expect((await novelRepository.getById('novel-1'))?.totalWordCount).toBe(42);

    localStorage.setItem('ai_novel_studio_drafts_list_chapter-1', JSON.stringify([
      { id: 'draft-current', novelId: 'novel-1', chapterId: 'chapter-1', wordCount: 57, isAdopted: true },
    ]));
    expect((await novelRepository.getById('novel-1'))?.totalWordCount).toBe(57);

    localStorage.setItem('ai_novel_studio_chapters', JSON.stringify([
      { id: 'chapter-1', novelId: 'novel-1' },
    ]));
    expect((await novelRepository.getById('novel-1'))?.totalWordCount).toBe(0);
  });
});
