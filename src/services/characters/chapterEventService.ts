/**
 * AI Novel Studio - 章节事件服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ChapterEvent, CreateChapterEventInput, ChapterEventStatus } from '../../types/chapterEvent';

const KEY = 'ai_novel_studio_chapter_events';
function getAll(): ChapterEvent[] { return lsGet<ChapterEvent[]>(KEY) ?? []; }
function saveAll(items: ChapterEvent[]): void { lsSet(KEY, items); }

export const chapterEventService = {
  async getByChapterId(chapterId: string): Promise<ChapterEvent[]> {
    return getAll().filter((e) => e.chapterId === chapterId);
  },
  async create(input: CreateChapterEventInput): Promise<ChapterEvent> {
    const list = getAll(); const now = nowISO();
    const ev: ChapterEvent = { ...input, id: generateId(), status: input.status || 'candidate', source: input.source || 'manual', createdAt: now, updatedAt: now };
    list.push(ev); saveAll(list); return ev;
  },
  async update(id: string, input: Partial<ChapterEvent>): Promise<ChapterEvent | null> {
    const list = getAll(); const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },
  async setStatus(id: string, status: ChapterEventStatus): Promise<void> {
    const list = getAll(); const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return;
    list[idx].status = status; list[idx].updatedAt = nowISO(); saveAll(list);
  },
  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((e) => e.id !== id));
  },
};
