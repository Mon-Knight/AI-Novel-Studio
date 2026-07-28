import type { Chapter } from '../types/chapter';

export interface ChapterListIndex {
  byVolume: ReadonlyMap<string, readonly Chapter[]>;
  orphaned: readonly Chapter[];
}

export function buildChapterListIndex(chapters: readonly Chapter[]): ChapterListIndex {
  const mutable = new Map<string, Chapter[]>();
  const orphaned: Chapter[] = [];
  for (const chapter of chapters) {
    if (!chapter.volumeId) {
      orphaned.push(chapter);
      continue;
    }
    const volumeChapters = mutable.get(chapter.volumeId) ?? [];
    volumeChapters.push(chapter);
    mutable.set(chapter.volumeId, volumeChapters);
  }
  for (const volumeChapters of mutable.values()) {
    volumeChapters.sort((left, right) => left.orderIndex - right.orderIndex);
  }
  orphaned.sort((left, right) => left.orderIndex - right.orderIndex);
  return { byVolume: mutable, orphaned };
}

export function visibleChapterWindow(
  chapters: readonly Chapter[],
  windowSize: number,
  activeChapterId: string,
  requestedStart?: number,
): readonly Chapter[] {
  const size = Math.max(1, Math.trunc(windowSize));
  const start = requestedStart ?? centeredChapterWindowStart(chapters, size, activeChapterId);
  return resolveChapterWindow(chapters, start, size).items;
}

export interface ResolvedChapterWindow {
  items: readonly Chapter[];
  start: number;
  end: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function centeredChapterWindowStart(
  chapters: readonly Chapter[],
  windowSize: number,
  activeChapterId: string,
): number {
  const size = Math.max(1, Math.trunc(windowSize));
  const activeIndex = chapters.findIndex((chapter) => chapter.id === activeChapterId);
  if (activeIndex < 0) return 0;
  return Math.min(
    Math.max(0, activeIndex - Math.floor(size / 2)),
    Math.max(0, chapters.length - size),
  );
}

export function resolveChapterWindow(
  chapters: readonly Chapter[],
  requestedStart: number,
  windowSize: number,
): ResolvedChapterWindow {
  const size = Math.max(1, Math.trunc(windowSize));
  const start = Math.min(
    Math.max(0, Math.trunc(requestedStart)),
    Math.max(0, chapters.length - size),
  );
  const end = Math.min(chapters.length, start + size);
  return {
    items: chapters.slice(start, end),
    start,
    end,
    total: chapters.length,
    hasPrevious: start > 0,
    hasNext: end < chapters.length,
  };
}
