/**
 * AI Novel Studio - 角色服务
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */
import { dbCall, lsGet, lsSet, isTauri, generateId, nowISO } from '../database/db';
import type { Character, CreateCharacterInput } from '../../types/character';

const KEY = 'ai_novel_studio_characters';

// localStorage 回退
function getAllLocal(): Character[] { return lsGet<Character[]>(KEY) ?? []; }
function saveAllLocal(items: Character[]): void { lsSet(KEY, items); }

// 从 Tauri DTO 映射到前端类型
function mapToCharacter(dto: any): Character {
  return {
    id: dto.id,
    novelId: dto.novelId ?? dto.novel_id,
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
    source: dto.source ?? 'manual',
    isActive: dto.isActive ?? dto.is_active ?? true,
    createdAt: dto.createdAt ?? dto.created_at,
    updatedAt: dto.updatedAt ?? dto.updated_at,
  };
}

export const characterService = {
  /** 同步主角到角色库（从 protagonists 表 → characters 表） */
  async syncProtagonist(novelId: string): Promise<Character | null> {
    if (isTauri()) {
      const result = await dbCall<any>('sync_protagonist_to_character_library', { novelId });
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
      source: 'manual' as any,
      isActive: true,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    all.push(ch);
    saveAllLocal(all);
    return ch;
  },

  /** 获取主角角色 */
  async getProtagonist(novelId: string): Promise<Character | null> {
    if (isTauri()) {
      const result = await dbCall<any>('get_protagonist_character', { novelId });
      return result ? mapToCharacter(result) : null;
    }
    return getAllLocal().find((c) => c.novelId === novelId && c.roleType === 'protagonist') ?? null;
  },

  async getByNovelId(novelId: string): Promise<Character[]> {
    if (isTauri()) {
      const list = await dbCall<any[]>('list_characters', { novelId });
      return (list ?? []).map(mapToCharacter);
    }
    return getAllLocal().filter((c) => c.novelId === novelId);
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
      const dto = await dbCall<any>('create_character', {
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
        isProtagonist: (input as any).isProtagonist ?? false,
      });
      return mapToCharacter(dto);
    }
    const list = getAllLocal(); const now = nowISO();
    const ch: Character = { ...input, id: generateId(), source: 'manual' as any, isActive: true, createdAt: now, updatedAt: now };
    list.push(ch); saveAllLocal(list); return ch;
  },

  async update(id: string, input: Partial<CreateCharacterInput & { isActive?: boolean; isProtagonist?: boolean }>): Promise<Character | null> {
    if (isTauri()) {
      const dto = await dbCall<any>('update_character', {
        id,
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
        isProtagonist: (input as any).isProtagonist,
        isActive: input.isActive,
      });
      return mapToCharacter(dto);
    }
    const list = getAllLocal(); const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() }; saveAllLocal(list); return list[idx];
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
    const novels = lsGet<any[]>('ai_novel_studio_novels') ?? [];
    const novel = novels.find((n: any) => n.id === novelId);
    if (!novel) {
      // 尝试 protagonists
      const protagonists = lsGet<any[]>('ai_novel_studio_protagonists') ?? [];
      const protag = protagonists.find((p: any) => p.novelId === novelId);
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

