/**
 * AI Novel Studio - 章节角色关联服务
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */
import { dbCall, lsGet, lsSet, isTauri, generateId, nowISO } from '../database/db';
import type { ChapterCharacter, ChapterCharacterRole } from '../../types/character';

const KEY = 'ai_novel_studio_chapter_characters';

interface ChapterCharacterDto extends Record<string, unknown> {
  id?: unknown;
  novelId?: unknown;
  novel_id?: unknown;
  chapterId?: unknown;
  chapter_id?: unknown;
  characterId?: unknown;
  character_id?: unknown;
  characterName?: unknown;
  character_name?: unknown;
  roleInChapter?: unknown;
  role_in_chapter?: unknown;
  mustAppear?: unknown;
  must_appear?: unknown;
  note?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function requiredString(field: string, ...values: unknown[]): string {
  const value = firstString(...values);
  if (value === undefined) throw new Error(`章节角色数据缺少 ${field}`);
  return value;
}

function isChapterCharacterRole(value: unknown): value is ChapterCharacterRole {
  return value === 'main' || value === 'supporting' || value === 'mentioned' || value === 'hidden';
}

// localStorage 回退
function getAllLocal(): ChapterCharacter[] {
  return lsGet<ChapterCharacter[]>(KEY) ?? [];
}
function saveAllLocal(items: ChapterCharacter[]): void {
  lsSet(KEY, items);
}

function mapToChapterCharacter(dto: ChapterCharacterDto): ChapterCharacter {
  const role = dto.roleInChapter ?? dto.role_in_chapter;
  const mustAppear = dto.mustAppear ?? dto.must_appear;
  return {
    id: requiredString('id', dto.id),
    novelId: requiredString('novelId', dto.novelId, dto.novel_id),
    chapterId: requiredString('chapterId', dto.chapterId, dto.chapter_id),
    characterId: requiredString('characterId', dto.characterId, dto.character_id),
    characterName: firstString(dto.characterName, dto.character_name),
    roleInChapter: isChapterCharacterRole(role) ? role : 'supporting',
    mustAppear: typeof mustAppear === 'boolean' ? mustAppear : false,
    note: firstString(dto.note),
    createdAt: requiredString('createdAt', dto.createdAt, dto.created_at),
    updatedAt: requiredString('updatedAt', dto.updatedAt, dto.updated_at),
  };
}

export const chapterCharacterService = {
  async getByChapterId(chapterId: string): Promise<ChapterCharacter[]> {
    if (!chapterId) return [];
    if (isTauri()) {
      const list = await dbCall<ChapterCharacterDto[]>('list_chapter_characters', { chapterId });
      return (list ?? []).map(mapToChapterCharacter);
    }
    return getAllLocal().filter((cc) => cc.chapterId === chapterId);
  },

  async add(input: {
    novelId: string;
    chapterId: string;
    characterId: string;
    characterName?: string;
    roleInChapter?: ChapterCharacterRole;
    mustAppear?: boolean;
    note?: string;
  }): Promise<ChapterCharacter> {
    if (isTauri()) {
      const dto = await dbCall<ChapterCharacterDto>('add_chapter_character', {
        input: {
          novelId: input.novelId,
          chapterId: input.chapterId,
          characterId: input.characterId,
          characterName: input.characterName,
          roleInChapter: input.roleInChapter || 'supporting',
          mustAppear: input.mustAppear ?? true,
          note: input.note,
        },
      });
      return mapToChapterCharacter(dto);
    }
    const list = getAllLocal();
    const now = nowISO();
    const existing = list.find(
      (item) => item.chapterId === input.chapterId && item.characterId === input.characterId,
    );
    if (existing) {
      Object.assign(existing, {
        characterName: input.characterName ?? existing.characterName,
        roleInChapter: input.roleInChapter || existing.roleInChapter,
        mustAppear: input.mustAppear ?? existing.mustAppear,
        note: input.note ?? existing.note,
        updatedAt: now,
      });
      saveAllLocal(list);
      return existing;
    }
    const cc: ChapterCharacter = {
      ...input,
      id: generateId(),
      roleInChapter: input.roleInChapter || 'supporting',
      mustAppear: input.mustAppear || false,
      createdAt: now,
      updatedAt: now,
    };
    list.push(cc);
    saveAllLocal(list);
    return cc;
  },

  async update(id: string, input: Partial<ChapterCharacter>): Promise<ChapterCharacter | null> {
    if (isTauri()) {
      // 通过 remove + add 模拟更新
      const old = getAllLocal().find((c) => c.id === id);
      if (!old) return null;
      await dbCall<void>('remove_chapter_character', {
        chapterId: old.chapterId,
        characterId: old.characterId,
      });
      const dto = await dbCall<ChapterCharacterDto>('add_chapter_character', {
        input: {
          novelId: input.novelId ?? old.novelId,
          chapterId: input.chapterId ?? old.chapterId,
          characterId: input.characterId ?? old.characterId,
          characterName: input.characterName ?? old.characterName,
          roleInChapter: input.roleInChapter ?? old.roleInChapter,
          mustAppear: input.mustAppear ?? old.mustAppear,
          note: input.note ?? old.note,
        },
      });
      return mapToChapterCharacter(dto);
    }
    const list = getAllLocal();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
    saveAllLocal(list);
    return list[idx];
  },

  async remove(itemOrId: string | ChapterCharacter): Promise<void> {
    if (isTauri()) {
      const item =
        typeof itemOrId === 'string' ? getAllLocal().find((c) => c.id === itemOrId) : itemOrId;
      if (!item) {
        throw new Error('缺少章节角色关联信息，无法移除');
      }
      if (item.chapterId && item.characterId) {
        await dbCall<void>('remove_chapter_character', {
          chapterId: item.chapterId,
          characterId: item.characterId,
        });
      }
      return;
    }
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
    saveAllLocal(getAllLocal().filter((c) => c.id !== id));
  },

  /** 根据 chapterId + characterId 移除 */
  async removeByChapterAndCharacter(chapterId: string, characterId: string): Promise<void> {
    if (isTauri()) {
      await dbCall<void>('remove_chapter_character', { chapterId, characterId });
      return;
    }
    saveAllLocal(
      getAllLocal().filter((c) => !(c.chapterId === chapterId && c.characterId === characterId)),
    );
  },
};
