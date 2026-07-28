import { describe, expect, it } from 'vitest';
import type { Chapter } from '../types/chapter';
import {
  centeredChapterWindowStart,
  resolveChapterWindow,
  visibleChapterWindow,
} from './chapterListWindow';

function chapter(index: number): Chapter {
  return {
    id: `chapter-${index}`,
    novelId: 'novel-1',
    volumeId: 'volume-1',
    title: `章节 ${index}`,
    outline: '',
    goal: '',
    chapterNumber: index + 1,
    orderIndex: index,
    sortOrder: index,
    status: 'not_started',
    wordCount: 0,
    currentWords: 0,
    targetWords: 0,
    drafts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('chapterListWindow', () => {
  const chapters = Array.from({ length: 1_000 }, (_, index) => chapter(index));

  it('centers a late active chapter without rendering all preceding rows', () => {
    const visible = visibleChapterWindow(chapters, 80, 'chapter-999');

    expect(visible).toHaveLength(80);
    expect(visible[visible.length - 1]?.id).toBe('chapter-999');
    expect(visible[0]?.id).toBe('chapter-920');
  });

  it('clamps previous and next windows to stable DOM bounds', () => {
    expect(centeredChapterWindowStart(chapters, 80, 'chapter-500')).toBe(460);
    const first = resolveChapterWindow(chapters, -500, 80);
    const last = resolveChapterWindow(chapters, 99_999, 80);

    expect(first.start).toBe(0);
    expect(first.end).toBe(80);
    expect(first.hasPrevious).toBe(false);
    expect(first.hasNext).toBe(true);
    expect(last.start).toBe(920);
    expect(last.end).toBe(1_000);
    expect(last.hasPrevious).toBe(true);
    expect(last.hasNext).toBe(false);
  });
});
