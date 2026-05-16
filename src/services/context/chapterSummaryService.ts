/**
 * AI Novel Studio - 章节总结服务（localStorage）
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ChapterSummary, CreateChapterSummaryInput } from '../../types/chapterSummary';

const KEY = 'ai_novel_studio_chapter_summaries';
function getAll(): ChapterSummary[] { return lsGet<ChapterSummary[]>(KEY) ?? []; }
function saveAll(items: ChapterSummary[]): void { lsSet(KEY, items); }

export const chapterSummaryService = {
  async getByChapterId(chapterId: string): Promise<ChapterSummary | null> {
    return getAll().find((s) => s.chapterId === chapterId) ?? null;
  },
  async getByNovelId(novelId: string): Promise<ChapterSummary[]> {
    return getAll().filter((s) => s.novelId === novelId);
  },
  async create(input: CreateChapterSummaryInput): Promise<ChapterSummary> {
    const list = getAll(); const now = nowISO();
    const s: ChapterSummary = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    list.push(s); saveAll(list); return s;
  },
  async update(id: string, input: Partial<CreateChapterSummaryInput>): Promise<ChapterSummary | null> {
    const list = getAll(); const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },
  async remove(id: string): Promise<void> { saveAll(getAll().filter((s) => s.id !== id)); },
};
