/**
 * AI Novel Studio - 角色服务
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */
import { dbCall, lsGet, lsSet, isTauri, generateId, nowISO } from '../database/db';
import type { Character, CreateCharacterInput } from '../../types/character';

const KEY = 'ai_novel_studio_characters';

interface CharacterDto {
  id: string;
  novelId?: string;
  novel_id?: string;
  name: string;
  roleType?: Character['roleType'];
  role_type?: Character['roleType'];
  identity?: string;
  faction?: string;
  relationToProtagonist?: string;
  relation_to_protagonist?: string;
  goal?: string;
  personality?: string;
  behaviorLimits?: string;
  behavior_limits?: string;
  forbiddenBehaviors?: string;
  forbidden_behaviors?: string;
  firstAppearanceChapterId?: string;
  first_appearance_chapter_id?: string;
  currentState?: string;
  current_state?: string;
  isProtagonist?: boolean;
  is_protagonist?: boolean;
  protagonistKey?: string;
  protagonist_key?: string;
  protagonistLabel?: string;
  protagonist_label?: string;
  protagonistOrder?: number;
  protagonist_order?: number;
  source?: Character['source'];
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

interface LocalProtagonistRecord {
  novelId?: string;
  name?: string;
  identity?: string;
  personality?: string;
  goal?: string;
  abilityLimits?: string;
  limitation?: string;
  forbiddenBehaviors?: string;
  currentState?: string;
}

interface LocalNovelRecord {
  id?: string;
  mainCharacter?: string;
  main_character?: string;
  protagonistAbility?: string;
  protagonist_ability?: string;
  protagonists?: LocalProtagonistRecord[];
}

// localStorage 回退
function getAllLocal(): Character[] {
  return lsGet<Character[]>(KEY) ?? [];
}
function saveAllLocal(items: Character[]): void {
  lsSet(KEY, items);
}

function readRequiredDtoString(primary: unknown, legacy: unknown, fieldName: string): string {
  const value = primary ?? legacy;
  if (typeof value !== 'string') {
    throw new Error(`Invalid character DTO field: ${fieldName}`);
  }
  return value;
}

// 从 Tauri DTO 映射到前端类型
function mapToCharacter(dto: CharacterDto): Character {
  return {
    id: dto.id,
    novelId: readRequiredDtoString(dto.novelId, dto.novel_id, 'novelId'),
    name: dto.name,
    roleType: dto.roleType ?? dto.role_type,
    identity: dto.identity,
    faction: dto.faction,
    relationToProtagonist: dto.relationToProtagonist ?? dto.relation_to_protagonist,
    goal: dto.goal,
    personality: dto.personality,
    behaviorLimits: dto.behaviorLimits ?? dto.behavior_limits,
    forbiddenBehaviors: dto.forbiddenBehaviors ?? dto.forbidden_behaviors,
    firstAppearanceChapterId: dto.firstAppearanceChapterId ?? dto.first_appearance_chapter_id,
    currentState: dto.currentState ?? dto.current_state,
    isProtagonist:
      dto.isProtagonist ?? dto.is_protagonist ?? (dto.roleType ?? dto.role_type) === 'protagonist',
    protagonistKey: dto.protagonistKey ?? dto.protagonist_key,
    protagonistLabel: dto.protagonistLabel ?? dto.protagonist_label,
    protagonistOrder: dto.protagonistOrder ?? dto.protagonist_order ?? 0,
    source: dto.source ?? 'manual',
    isActive: dto.isActive ?? dto.is_active ?? true,
    createdAt: readRequiredDtoString(dto.createdAt, dto.created_at, 'createdAt'),
    updatedAt: readRequiredDtoString(dto.updatedAt, dto.updated_at, 'updatedAt'),
  };
}

export const characterService = {
  /** 同步主角到角色库（从 protagonists 表 → characters 表） */
  async syncProtagonist(novelId: string): Promise<Character | null> {
    if (isTauri()) {
      const result = await dbCall<CharacterDto | null>('sync_protagonist_to_character_library', {
        novelId,
      });
      return result ? mapToCharacter(result) : null;
    }
    // localStorage 回退：从 novels 或 protagonists 表同步
    const protagonist = await tryGetLocalProtagonist(novelId);
    if (!protagonist || !protagonist.name) return null;

    // 检查是否已存在主角角色
    const all = getAllLocal();
    const existing = all.find((c) => c.novelId === novelId && c.roleType === 'protagonist');
    const name = protagonist.name;
    const identity = protagonist.identity ?? undefined;
    const personality = protagonist.personality ?? undefined;
    const goal = protagonist.goal ?? undefined;
    const behaviorLimits = protagonist.behaviorLimits ?? undefined;
    const forbiddenBehaviors = protagonist.forbiddenBehaviors ?? undefined;
    const currentState = protagonist.currentState ?? undefined;

    if (existing) {
      // 更新已有主角
      Object.assign(existing, {
        name,
        identity,
        personality,
        goal,
        behaviorLimits,
        forbiddenBehaviors,
        currentState,
        isProtagonist: true,
        updatedAt: nowISO(),
      });
      saveAllLocal(all);
      return existing;
    }

    // 新插入主角
    const ch: Character = {
      id: generateId(),
      novelId,
      name,
      roleType: 'protagonist',
      identity,
      personality,
      goal,
      behaviorLimits,
      forbiddenBehaviors,
      currentState,
      isProtagonist: true,
      source: 'manual',
      isActive: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    all.push(ch);
    saveAllLocal(all);
    return ch;
  },

  /** 获取主角角色（单主角，向后兼容） */
  async getProtagonist(novelId: string): Promise<Character | null> {
    if (isTauri()) {
      const result = await dbCall<CharacterDto | null>('get_protagonist_character', { novelId });
      return result ? mapToCharacter(result) : null;
    }
    return getAllLocal().find((c) => c.novelId === novelId && c.roleType === 'protagonist') ?? null;
  },

  /** 同步所有主角到角色库（新接口，返回数组） */
  async syncProtagonists(novelId: string): Promise<Character[]> {
    if (isTauri()) {
      const list = await dbCall<CharacterDto[]>('sync_protagonists_to_character_library', {
        novelId,
      });
      return (list ?? []).map(mapToCharacter);
    }
    // localStorage 回退：逐个调用单体同步
    const single = await this.syncProtagonist(novelId);
    return single ? [single] : [];
  },

  /** 获取所有主角角色（新接口，返回数组） */
  async getProtagonists(novelId: string): Promise<Character[]> {
    if (isTauri()) {
      const list = await dbCall<CharacterDto[]>('get_protagonist_characters', { novelId });
      return (list ?? []).map(mapToCharacter);
    }
    return getAllLocal().filter((c) => c.novelId === novelId && c.roleType === 'protagonist');
  },

  async getByNovelId(novelId: string): Promise<Character[]> {
    if (isTauri()) {
      const list = await dbCall<CharacterDto[]>('list_characters', { novelId });
      return (list ?? []).map(mapToCharacter);
    }
    return getAllLocal()
      .filter((c) => c.novelId === novelId)
      .sort(
        (a, b) =>
          Number(b.isProtagonist || b.roleType === 'protagonist') -
          Number(a.isProtagonist || a.roleType === 'protagonist'),
      );
  },

  async getById(id: string): Promise<Character | null> {
    if (isTauri()) {
      // 通过 list_characters 查找单个（也可扩展专用接口）
      const all = await this.getByNovelId('');
      return all.find((c) => c.id === id) ?? null;
    }
    return getAllLocal().find((c) => c.id === id) ?? null;
  },

  async create(input: CreateCharacterInput & { isProtagonist?: boolean }): Promise<Character> {
    if (isTauri()) {
      const dto = await dbCall<CharacterDto>('create_character', {
        input: {
          novelId: input.novelId,
          name: input.name,
          roleType: input.roleType,
          identity: input.identity,
          faction: input.faction,
          relationToProtagonist: input.relationToProtagonist,
          goal: input.goal,
          personality: input.personality,
          behaviorLimits: input.behaviorLimits,
          forbiddenBehaviors: input.forbiddenBehaviors,
          currentState: input.currentState,
          isProtagonist: input.isProtagonist ?? false,
        },
      });
      return mapToCharacter(dto);
    }
    const list = getAllLocal();
    const now = nowISO();
    const ch: Character = {
      ...input,
      id: generateId(),
      source: 'manual',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    list.push(ch);
    saveAllLocal(list);
    return ch;
  },

  async update(
    id: string,
    input: Partial<CreateCharacterInput & { isActive?: boolean; isProtagonist?: boolean }>,
  ): Promise<Character | null> {
    if (isTauri()) {
      const dto = await dbCall<CharacterDto>('update_character', {
        id,
        input: {
          name: input.name,
          roleType: input.roleType,
          identity: input.identity,
          faction: input.faction,
          relationToProtagonist: input.relationToProtagonist,
          goal: input.goal,
          personality: input.personality,
          behaviorLimits: input.behaviorLimits,
          forbiddenBehaviors: input.forbiddenBehaviors,
          currentState: input.currentState,
          isProtagonist: input.isProtagonist,
          isActive: input.isActive,
        },
      });
      return mapToCharacter(dto);
    }
    const list = getAllLocal();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
    saveAllLocal(list);
    return list[idx];
  },

  async remove(id: string): Promise<void> {
    if (isTauri()) {
      await dbCall<void>('delete_character', { id });
      return;
    }
    saveAllLocal(getAllLocal().filter((c) => c.id !== id));
  },
};

/** 从 localStorage 中的 novels/protagonists 数据获取主角 */
async function tryGetLocalProtagonist(novelId: string): Promise<Partial<Character> | null> {
  try {
    // 尝试读取 novels localStorage
    const novels = lsGet<LocalNovelRecord[]>('ai_novel_studio_novels') ?? [];
    const novel = novels.find((n) => n.id === novelId);
    if (!novel) {
      // 尝试 protagonists
      const protagonists = lsGet<LocalProtagonistRecord[]>('ai_novel_studio_protagonists') ?? [];
      const protag = protagonists.find((p) => p.novelId === novelId);
      if (protag) {
        return {
          name: protag.name,
          identity: protag.identity,
          personality: protag.personality,
          goal: protag.goal,
          behaviorLimits: protag.abilityLimits,
          forbiddenBehaviors: protag.forbiddenBehaviors,
          currentState: protag.currentState,
        };
      }
      return null;
    }

    // 从 novel 的 main_character / protagonists 字段读取
    const mainChar = novel.mainCharacter || novel.main_character || '';
    if (!mainChar && (!novel.protagonists || novel.protagonists.length === 0)) {
      return null;
    }

    if (novel.protagonists && novel.protagonists.length > 0) {
      const first = novel.protagonists[0];
      return {
        name: first.name,
        identity: first.identity,
        personality: first.personality,
        goal: first.goal,
        behaviorLimits: first.abilityLimits || first.limitation,
        forbiddenBehaviors: first.forbiddenBehaviors,
        currentState: undefined,
      };
    }

    return {
      name: mainChar,
      identity: undefined,
      personality: undefined,
      goal: undefined,
      behaviorLimits: novel.protagonistAbility || novel.protagonist_ability || undefined,
      forbiddenBehaviors: undefined,
      currentState: undefined,
    };
  } catch {
    return null;
  }
}
