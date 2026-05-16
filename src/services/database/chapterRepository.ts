/**
 * AI Novel Studio - 章节 Repository
 */
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';

const CHAPTERS_KEY = 'ai_novel_studio_chapters';

function getLocalChapters(): Chapter[] {
  return lsGet<Chapter[]>(CHAPTERS_KEY) ?? [];
}

function saveLocalChapters(items: Chapter[]): void {
  lsSet(CHAPTERS_KEY, items);
}

export const chapterRepository = {
  async getByNovelId(novelId: string): Promise<Chapter[]> {
    return dbCall<Chapter[]>('get_chapters_by_novel_id', { novelId }, () =>
      getLocalChapters().filter((ch) => ch.novelId === novelId).sort((a, b) => a.orderIndex - b.orderIndex),
    );
  },

  async getByVolumeId(volumeId: string): Promise<Chapter[]> {
    return dbCall<Chapter[]>('get_chapters_by_volume_id', { volumeId }, () =>
      getLocalChapters().filter((ch) => ch.volumeId === volumeId).sort((a, b) => a.orderIndex - b.orderIndex),
    );
  },

  async getById(id: string): Promise<Chapter | null> {
    return dbCall<Chapter | null>('get_chapter_by_id', { id }, () =>
      getLocalChapters().find((ch) => ch.id === id) ?? null,
    );
  },

  async create(input: CreateChapterInput): Promise<Chapter> {
    return dbCall<Chapter>('create_chapter', { input }, () => {
      const items = getLocalChapters();
      const now = nowISO();
      const siblings = items.filter((ch) => ch.volumeId === input.volumeId);
      const maxOrder = siblings.reduce((max, ch) => Math.max(max, ch.orderIndex), -1);
      const status = input.outline ? 'outline_ready' : 'not_started';
      const chapter: Chapter = {
        id: generateId(),
        novelId: input.novelId,
        volumeId: input.volumeId,
        title: input.title,
        outline: input.outline,
        goal: input.goal,
        chapterNumber: maxOrder + 2,
        orderIndex: input.orderIndex ?? maxOrder + 1,
        sortOrder: input.orderIndex ?? maxOrder + 1,
        status: status as Chapter['status'],
        wordCount: 0,
        currentWords: 0,
        targetWordCount: input.targetWordCount ?? 4000,
        targetWords: input.targetWordCount ?? 4000,
        drafts: [],
        createdAt: now,
        updatedAt: now,
      };
      items.push(chapter);
      saveLocalChapters(items);
      return chapter;
    });
  },

  async update(id: string, input: UpdateChapterInput): Promise<Chapter | null> {
    return dbCall<Chapter>('update_chapter', { id, input }, () => {
      const items = getLocalChapters();
      const idx = items.findIndex((ch) => ch.id === id);
      if (idx === -1) return null as unknown as Chapter;
      const updated = { ...items[idx], ...input, updatedAt: nowISO() };
      if (input.targetWordCount !== undefined) {
        updated.targetWords = input.targetWordCount;
      }
      items[idx] = updated;
      saveLocalChapters(items);
      return updated;
    });
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_chapter', { id }, () => {
      const items = getLocalChapters().filter((ch) => ch.id !== id);
      saveLocalChapters(items);
    });
  },
};
