/**
 * AI Novel Studio - 角色服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { Character, CreateCharacterInput } from '../../types/character';

const KEY = 'ai_novel_studio_characters';
function getAll(): Character[] { return lsGet<Character[]>(KEY) ?? []; }
function saveAll(items: Character[]): void { lsSet(KEY, items); }

export const characterService = {
  async getByNovelId(novelId: string): Promise<Character[]> {
    return getAll().filter((c) => c.novelId === novelId);
  },
  async getById(id: string): Promise<Character | null> {
    return getAll().find((c) => c.id === id) ?? null;
  },
  async create(input: CreateCharacterInput): Promise<Character> {
    const list = getAll(); const now = nowISO();
    const ch: Character = { ...input, id: generateId(), source: 'manual', isActive: true, createdAt: now, updatedAt: now };
    list.push(ch); saveAll(list); return ch;
  },
  async update(id: string, input: Partial<CreateCharacterInput & { isActive?: boolean }>): Promise<Character | null> {
    const list = getAll(); const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAll(list); return list[idx];
  },
  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((c) => c.id !== id));
  },
};
