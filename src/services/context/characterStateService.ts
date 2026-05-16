/**
 * AI Novel Studio - 角色状态服务（localStorage）
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import { characterService } from '../characters/characterService';
import type { CharacterState, CreateCharacterStateInput } from '../../types/character';

const KEY = 'ai_novel_studio_character_states';
function getAll(): CharacterState[] { return lsGet<CharacterState[]>(KEY) ?? []; }
function saveAll(items: CharacterState[]): void { lsSet(KEY, items); }

export const characterStateService = {
  async getByCharacterId(characterId: string): Promise<CharacterState[]> {
    return getAll().filter((s) => s.characterId === characterId);
  },
  async getLatest(characterId: string): Promise<CharacterState | null> {
    return getAll().filter((s) => s.characterId === characterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  },
  async getByChapterId(chapterId: string): Promise<CharacterState[]> {
    return getAll().filter((s) => s.chapterId === chapterId);
  },
  async create(input: CreateCharacterStateInput): Promise<CharacterState> {
    const list = getAll(); const now = nowISO();
    const s: CharacterState = { ...input, id: generateId(), createdAt: now };
    list.push(s); saveAll(list);
    // 同时更新角色 currentState
    await characterService.update(input.characterId, { currentState: input.stateSummary });
    return s;
  },
  async remove(id: string): Promise<void> { saveAll(getAll().filter((s) => s.id !== id)); },
};
