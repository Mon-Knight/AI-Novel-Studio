/**
 * AI Novel Studio - 章节角色关联服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ChapterCharacter, ChapterCharacterRole } from '../../types/character';

const KEY = 'ai_novel_studio_chapter_characters';
function getAll(): ChapterCharacter[] { return lsGet<ChapterCharacter[]>(KEY) ?? []; }
function saveAll(items: ChapterCharacter[]): void { lsSet(KEY, items); }

export const chapterCharacterService = {
  async getByChapterId(chapterId: string): Promise<ChapterCharacter[]> {
    return getAll().filter((cc) => cc.chapterId === chapterId);
  },
  async add(input: { novelId: string; chapterId: string; characterId: string; characterName?: string; roleInChapter?: ChapterCharacterRole; mustAppear?: boolean; note?: string }): Promise<ChapterCharacter> {
    const list = getAll(); const now = nowISO();
    const cc: ChapterCharacter = { ...input, id: generateId(), roleInChapter: input.roleInChapter || 'supporting', mustAppear: input.mustAppear || false, createdAt: now, updatedAt: now };
    list.push(cc); saveAll(list); return cc;
  },
  async update(id: string, input: Partial<ChapterCharacter>): Promise<ChapterCharacter | null> {
    const list = getAll(); const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },
  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((c) => c.id !== id));
  },
};
