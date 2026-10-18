import type { Chapter } from '../types/chapter';

/** Unquoted leading 第…章 remains a heading prefix; embedded text and volume names stay titles. */
export function formatChapterHeading(chapter: Pick<Chapter, 'chapterNumber' | 'title'>): string {
  const title = chapter.title
    .trim()
    .replace(/^(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*章\s*[:：、.．-]?\s*)+/u, '')
    .trim();
  return `第${chapter.chapterNumber}章${title ? ` ${title}` : ''}`;
}
