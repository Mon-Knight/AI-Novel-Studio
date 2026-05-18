/**
 * AI Novel Studio - 章节角色关联服务
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */
import { dbCall, lsGet, lsSet, isTauri, generateId, nowISO } from '../database/db';
import type { ChapterCharacter, ChapterCharacterRole } from '../../types/character';

const KEY = 'ai_novel_studio_chapter_characters';

// localStorage 回退
function getAllLocal(): ChapterCharacter[] { return lsGet<ChapterCharacter[]>(KEY) ?? []; }
function saveAllLocal(items: ChapterCharacter[]): void { lsSet(KEY, items); }

function mapToChapterCharacter(dto: any): ChapterCharacter {
  return {
    id: dto.id,
    novelId: dto.novelId ?? dto.novel_id,
    chapterId: dto.chapterId ?? dto.chapter_id,
    characterId: dto.characterId ?? dto.character_id,
    characterName: dto.characterName ?? dto.character_name,
    roleInChapter: (dto.roleInChapter ?? dto.role_in_chapter) as ChapterCharacterRole,
    mustAppear: dto.mustAppear ?? dto.must_appear ?? false,
    note: dto.note,
    createdAt: dto.createdAt ?? dto.created_at,
    updatedAt: dto.updatedAt ?? dto.updated_at,
  };
}

export const chapterCharacterService = {
  async getByChapterId(chapterId: string): Promise<ChapterCharacter[]> {
    if (!chapterId) return [];
    if (isTauri()) {
      const list = await dbCall<any[]>('list_chapter_characters', { chapterId });
      return (list ?? []).map(mapToChapterCharacter);
    }
    return getAllLocal().filter((cc) => cc.chapterId === chapterId);
  },

  async add(input: {
    novelId: string; chapterId: string; characterId: string;
    characterName?: string; roleInChapter?: ChapterCharacterRole;
    mustAppear?: boolean; note?: string;
  }): Promise<ChapterCharacter> {
    if (isTauri()) {
      const dto = await dbCall<any>('add_chapter_character', {
        novelId: input.novelId,
        chapterId: input.chapterId,
        characterId: input.characterId,
        characterName: input.characterName,
        roleInChapter: input.roleInChapter || 'supporting',
        mustAppear: input.mustAppear ?? true,
        note: input.note,
      });
      return mapToChapterCharacter(dto);
    }
    const list = getAllLocal(); const now = nowISO();
    const cc: ChapterCharacter = {
      ...input, id: generateId(),
      roleInChapter: input.roleInChapter || 'supporting',
      mustAppear: input.mustAppear || false,
      createdAt: now, updatedAt: now,
    };
    list.push(cc); saveAllLocal(list); return cc;
  },

  async update(id: string, input: Partial<ChapterCharacter>): Promise<ChapterCharacter | null> {
    if (isTauri()) {
      // 通过 remove + add 模拟更新
      const old = getAllLocal().find((c) => c.id === id);
      if (!old) return null;
      await dbCall<void>('remove_chapter_character', { chapterId: old.chapterId, characterId: old.characterId });
      const dto = await dbCall<any>('add_chapter_character', {
        novelId: input.novelId ?? old.novelId,
        chapterId: input.chapterId ?? old.chapterId,
        characterId: input.characterId ?? old.characterId,
        characterName: input.characterName ?? old.characterName,
        roleInChapter: input.roleInChapter ?? old.roleInChapter,
        mustAppear: input.mustAppear ?? old.mustAppear,
        note: input.note ?? old.note,
      });
      return mapToChapterCharacter(dto);
    }
    const list = getAllLocal(); const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAllLocal(list); return list[idx];
  },

  async remove(id: string): Promise<void> {
    if (isTauri()) {
      const all = getAllLocal();
      const item = all.find((c) => c.id === id);
      if (item) {
        await dbCall<void>('remove_chapter_character', { chapterId: item.chapterId, characterId: item.characterId });
      }
      return;
    }
    saveAllLocal(getAllLocal().filter((c) => c.id !== id));
  },

  /** 根据 chapterId + characterId 移除 */
  async removeByChapterAndCharacter(chapterId: string, characterId: string): Promise<void> {
    if (isTauri()) {
      await dbCall<void>('remove_chapter_character', { chapterId, characterId });
      return;
    }
    saveAllLocal(getAllLocal().filter((c) => !(c.chapterId === chapterId && c.characterId === characterId)));
  },
};

