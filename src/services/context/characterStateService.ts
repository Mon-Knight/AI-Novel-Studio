/**
 * AI Novel Studio - 角色状态持久化服务。
 *
 * Tauri 桌面端以 SQLite 为唯一事实源；浏览器开发模式才使用
 * localStorage。状态记录与 characters.currentState 始终一起提交或回滚。
 */
import {
  dbCall,
  generateId,
  getDbMode,
  lsGet,
  nowISO,
} from '../database/db';
import type {
  Character,
  CharacterState,
  CreateCharacterStateInput,
} from '../../types/character';

export const CHARACTER_STATES_STORAGE_KEY = 'ai_novel_studio_character_states';
export const CHARACTERS_STORAGE_KEY = 'ai_novel_studio_characters';

export type PersistableCharacterStateInput = CreateCharacterStateInput & { id?: string };

function getAllLocal(): CharacterState[] {
  return lsGet<CharacterState[]>(CHARACTER_STATES_STORAGE_KEY) ?? [];
}

function getLocalCharacters(): Character[] {
  return lsGet<Character[]>(CHARACTERS_STORAGE_KEY) ?? [];
}

function compareNewest(left: CharacterState, right: CharacterState): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function restoreLocalSnapshot(key: string, raw: string | null): void {
  if (raw === null) localStorage.removeItem(key);
  else localStorage.setItem(key, raw);
}

function commitLocalStateAndCharacters(
  states: CharacterState[],
  characters: Character[],
  snapshots: { states: string | null; characters: string | null },
): void {
  try {
    localStorage.setItem(CHARACTER_STATES_STORAGE_KEY, JSON.stringify(states));
    localStorage.setItem(CHARACTERS_STORAGE_KEY, JSON.stringify(characters));
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try { restoreLocalSnapshot(CHARACTER_STATES_STORAGE_KEY, snapshots.states); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    try { restoreLocalSnapshot(CHARACTERS_STORAGE_KEY, snapshots.characters); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (rollbackErrors.length > 0) {
      const rollbackFailure = new Error('角色状态本地保存失败，且回滚未完全成功。');
      Object.assign(rollbackFailure, { cause: error, rollbackErrors });
      throw rollbackFailure;
    }
    throw error;
  }
}

export function toTauriCharacterStateInput(
  input: PersistableCharacterStateInput,
): Record<string, unknown> {
  return {
    id: input.id,
    novelId: input.novelId,
    characterId: input.characterId,
    chapterId: input.chapterId ?? null,
    stateSummary: input.stateSummary,
    relationshipChanges: input.relationshipChanges ?? null,
    goalChanges: input.goalChanges ?? null,
    location: input.location ?? null,
    healthState: input.healthState ?? null,
    knowledgeState: input.knowledgeState ?? null,
  };
}

function readDtoValue(dto: unknown, camelKey: string, snakeKey: string): unknown {
  if (!dto || typeof dto !== 'object') return undefined;
  const record = dto as Record<string, unknown>;
  return record[camelKey] ?? record[snakeKey];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function mapCharacterStateFromTauriDto(dto: unknown): CharacterState {
  const id = readDtoValue(dto, 'id', 'id');
  const novelId = readDtoValue(dto, 'novelId', 'novel_id');
  const characterId = readDtoValue(dto, 'characterId', 'character_id');
  const stateSummary = readDtoValue(dto, 'stateSummary', 'state_summary');
  const createdAt = readDtoValue(dto, 'createdAt', 'created_at');
  if (![id, novelId, characterId, stateSummary, createdAt]
    .every((value) => typeof value === 'string')) {
    throw new Error('SQLite 返回了无效的角色状态。');
  }
  return {
    id: id as string,
    novelId: novelId as string,
    characterId: characterId as string,
    chapterId: optionalString(readDtoValue(dto, 'chapterId', 'chapter_id')),
    stateSummary: stateSummary as string,
    relationshipChanges: optionalString(
      readDtoValue(dto, 'relationshipChanges', 'relationship_changes'),
    ),
    goalChanges: optionalString(readDtoValue(dto, 'goalChanges', 'goal_changes')),
    location: optionalString(readDtoValue(dto, 'location', 'location')),
    healthState: optionalString(readDtoValue(dto, 'healthState', 'health_state')),
    knowledgeState: optionalString(readDtoValue(dto, 'knowledgeState', 'knowledge_state')),
    createdAt: createdAt as string,
  };
}

export const characterStateService = {
  async getByCharacterId(characterId: string): Promise<CharacterState[]> {
    if (getDbMode() === 'tauri') {
      const dtos = await dbCall<unknown[]>('get_character_states_by_character', { characterId });
      if (!Array.isArray(dtos)) {
        throw new Error('SQLite 返回了无效的角色状态列表。');
      }
      return dtos.map(mapCharacterStateFromTauriDto);
    }
    return getAllLocal()
      .filter((item) => item.characterId === characterId)
      .sort(compareNewest);
  },

  async getLatest(characterId: string): Promise<CharacterState | null> {
    return (await this.getByCharacterId(characterId))[0] ?? null;
  },

  async getByChapterId(chapterId: string): Promise<CharacterState[]> {
    if (getDbMode() === 'tauri') {
      const dtos = await dbCall<unknown[]>('get_character_states_by_chapter', { chapterId });
      if (!Array.isArray(dtos)) {
        throw new Error('SQLite 返回了无效的角色状态列表。');
      }
      return dtos.map(mapCharacterStateFromTauriDto);
    }
    return getAllLocal()
      .filter((item) => item.chapterId === chapterId)
      .sort(compareNewest);
  },

  async create(input: CreateCharacterStateInput): Promise<CharacterState> {
    if (getDbMode() === 'tauri') {
      const requested: PersistableCharacterStateInput = { ...input, id: generateId() };
      const dto = await dbCall<unknown>('save_character_state', {
        input: toTauriCharacterStateInput(requested),
      });
      return mapCharacterStateFromTauriDto(dto);
    }

    const snapshots = {
      states: localStorage.getItem(CHARACTER_STATES_STORAGE_KEY),
      characters: localStorage.getItem(CHARACTERS_STORAGE_KEY),
    };
    const characters = getLocalCharacters();
    const characterIndex = characters.findIndex((item) => (
      item.id === input.characterId && item.novelId === input.novelId
    ));
    if (characterIndex === -1) {
      throw new Error('角色状态所属角色不存在或不属于当前作品。');
    }
    const state: CharacterState = {
      ...input,
      id: generateId(),
      createdAt: nowISO(),
    };
    const states = getAllLocal();
    states.push(state);
    characters[characterIndex] = {
      ...characters[characterIndex],
      currentState: input.stateSummary,
      updatedAt: nowISO(),
    };
    commitLocalStateAndCharacters(states, characters, snapshots);
    return state;
  },

  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall('delete_character_state', { id });
      return;
    }

    const snapshots = {
      states: localStorage.getItem(CHARACTER_STATES_STORAGE_KEY),
      characters: localStorage.getItem(CHARACTERS_STORAGE_KEY),
    };
    const states = getAllLocal();
    const removed = states.find((item) => item.id === id);
    if (!removed) return;
    const remaining = states.filter((item) => item.id !== id);
    const characters = getLocalCharacters();
    const characterIndex = characters.findIndex((item) => (
      item.id === removed.characterId && item.novelId === removed.novelId
    ));
    if (characterIndex === -1) {
      throw new Error('角色状态所属角色不存在或不属于当前作品。');
    }
    const latest = remaining
      .filter((item) => item.characterId === removed.characterId)
      .sort(compareNewest)[0];
    characters[characterIndex] = {
      ...characters[characterIndex],
      currentState: latest?.stateSummary,
      updatedAt: nowISO(),
    };
    commitLocalStateAndCharacters(remaining, characters, snapshots);
  },
};
