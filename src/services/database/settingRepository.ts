/**
 * AI Novel Studio - 世界设定与规则体系 Repository
 */
import type { WorldSetting, SaveWorldSettingInput } from '../../types/setting';
import type { RuleSystem, SaveRuleSystemInput } from '../../types/setting';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';

const WORLD_SETTINGS_KEY = 'ai_novel_studio_world_settings';
const RULE_SYSTEMS_KEY = 'ai_novel_studio_rule_systems';

function getLocalWorldSettings(): WorldSetting[] {
  return lsGet<WorldSetting[]>(WORLD_SETTINGS_KEY) ?? [];
}

function saveLocalWorldSettings(items: WorldSetting[]): void {
  lsSet(WORLD_SETTINGS_KEY, items);
}

function getLocalRuleSystems(): RuleSystem[] {
  return lsGet<RuleSystem[]>(RULE_SYSTEMS_KEY) ?? [];
}

function saveLocalRuleSystems(items: RuleSystem[]): void {
  lsSet(RULE_SYSTEMS_KEY, items);
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function orderWorldSettings(items: readonly WorldSetting[]): WorldSetting[] {
  return [...items].sort(
    (left, right) =>
      Number(right.isActive) - Number(left.isActive) ||
      timestampValue(right.updatedAt) - timestampValue(left.updatedAt) ||
      timestampValue(right.createdAt) - timestampValue(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

export const settingRepository = {
  // ========== 世界设定 ==========
  async getWorldSettings(novelId: string): Promise<WorldSetting[]> {
    const items = await dbCall<WorldSetting[]>('get_world_settings', { novelId }, () =>
      getLocalWorldSettings().filter((s) => s.novelId === novelId),
    );
    return orderWorldSettings(items);
  },

  async saveWorldSetting(id: string | null, input: SaveWorldSettingInput): Promise<WorldSetting> {
    return dbCall<WorldSetting>('save_world_setting', { id, input }, () => {
      const items = getLocalWorldSettings();
      const now = nowISO();
      if (id) {
        const idx = items.findIndex((s) => s.id === id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...input, updatedAt: now };
          saveLocalWorldSettings(items);
          return items[idx];
        }
      }
      const newItem: WorldSetting = {
        id: generateId(),
        novelId: input.novelId,
        title: input.title,
        content: input.content,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      };
      items.push(newItem);
      saveLocalWorldSettings(items);
      return newItem;
    });
  },

  // ========== 规则体系 ==========
  async getRuleSystems(novelId: string): Promise<RuleSystem[]> {
    return dbCall<RuleSystem[]>('get_rule_systems', { novelId }, () =>
      getLocalRuleSystems().filter((r) => r.novelId === novelId),
    );
  },

  async saveRuleSystem(id: string | null, input: SaveRuleSystemInput): Promise<RuleSystem> {
    return dbCall<RuleSystem>('save_rule_system', { id, input }, () => {
      const items = getLocalRuleSystems();
      const now = nowISO();
      if (id) {
        const idx = items.findIndex((r) => r.id === id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...input, updatedAt: now };
          saveLocalRuleSystems(items);
          return items[idx];
        }
      }
      const newItem: RuleSystem = {
        id: generateId(),
        novelId: input.novelId,
        title: input.title,
        category: input.category,
        content: input.content,
        forbiddenRules: input.forbiddenRules,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      };
      items.push(newItem);
      saveLocalRuleSystems(items);
      return newItem;
    });
  },

  async deleteRuleSystem(id: string): Promise<void> {
    return dbCall<void>('delete_rule_system', { id }, () => {
      const items = getLocalRuleSystems().filter((r) => r.id !== id);
      saveLocalRuleSystems(items);
    });
  },
};
