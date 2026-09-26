/**
 * AI Novel Studio - 世界设定与规则体系 Repository
 */
import type { WorldSetting, SaveWorldSettingInput } from '../../types/setting';
import type { RuleSystem, SaveRuleSystemInput, DeleteRuleSystemInput } from '../../types/setting';
import type {
  WorldRuleChange,
  WorldRuleChangeImpact,
  WorldRuleSaveGuard,
  WorldRuleSetSnapshot,
} from '../../types/worldRules';
import {
  authorizeLocalRuleChange,
  previewLocalRuleChange,
  readLocalRuleSetSnapshot,
} from '../worldRules/localRuleGovernance';
import { dbCall, getDbMode, lsGet, lsSet, generateId, nowISO } from './db';

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

/** Synchronous browser compensation; never presents this as a SQLite transaction. */
function commitLocalRuleChange(
  write: () => void,
  rollback: () => void,
  expireReviews: () => void,
): void {
  write();
  try {
    expireReviews();
  } catch (error) {
    rollback();
    throw error;
  }
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

  async getWorldRuleSetSnapshot(novelId: string): Promise<WorldRuleSetSnapshot> {
    return dbCall('get_world_rule_set_snapshot', { novelId }, () =>
      readLocalRuleSetSnapshot(novelId),
    );
  },

  async previewWorldRuleChange(
    novelId: string,
    changes: WorldRuleChange[],
  ): Promise<WorldRuleChangeImpact> {
    return dbCall('preview_world_rule_change', { novelId, changes }, () =>
      previewLocalRuleChange(novelId, changes),
    );
  },

  async validateWorldRuleChange(
    novelId: string,
    changes: WorldRuleChange[],
    guard: WorldRuleSaveGuard,
  ): Promise<void> {
    if (getDbMode() !== 'tauri') {
      const recheck = await authorizeLocalRuleChange(novelId, changes, guard);
      recheck();
      return;
    }
    // Renderer preflight only; the native mutation always revalidates its own transaction.
    const preview = await this.previewWorldRuleChange(novelId, changes);
    const auth = guard.changeAuthorization;
    if (
      guard.expectedRuleSetFingerprint !== preview.ruleSetFingerprint ||
      !auth ||
      auth.previewHash !== preview.previewHash
    )
      throw new Error('RULE_SET_BASE_CONFLICT: 请重新预览并确认本次变更');
    if (
      preview.blockingConflicts.length ||
      !['confirm_change', 'retcon', 'approve_exception'].includes(auth.intent)
    )
      throw new Error('RULE_CHANGE_BLOCKED');
    if (auth.intent !== 'confirm_change' && !auth.notes?.trim())
      throw new Error('RULE_CHANGE_NOTES_REQUIRED');
  },

  async saveWorldSetting(id: string | null, input: SaveWorldSettingInput): Promise<WorldSetting> {
    return dbCall<WorldSetting>('save_world_setting', { id, input }, async () => {
      const items = getLocalWorldSettings();
      const previous = id ? items.find((s) => s.id === id) : undefined;
      if (id && (!previous || previous.novelId !== input.novelId))
        throw new Error('RULE_SET_SCOPE_MISMATCH');
      if (previous && input.expectedUpdatedAt !== previous.updatedAt)
        throw new Error('RULE_RECORD_BASE_CONFLICT');
      if (!previous && input.expectedUpdatedAt !== undefined)
        throw new Error('RULE_RECORD_BASE_CONFLICT');
      const structuredJson = input.structuredJson ?? previous?.structuredJson;
      const change: WorldRuleChange = {
        targetType: 'world_setting',
        targetId: id ?? undefined,
        title: input.title,
        content: input.content,
        structuredJson,
        isActive: input.isActive ?? true,
      };
      // Load before the mutation to avoid a static repository -> conversation -> context -> repository cycle.
      const { expireBrowserChapterReviewAuthorizations } =
        await import('../conversation/browserChapterReviewBaseline');
      const recheck = await authorizeLocalRuleChange(input.novelId, [change], input);
      recheck();
      const now = nowISO();
      const saved: WorldSetting = {
        id: previous?.id ?? generateId(),
        novelId: input.novelId,
        title: input.title,
        content: input.content,
        structuredJson,
        isActive: change.isActive,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      commitLocalRuleChange(
        () =>
          saveLocalWorldSettings(
            previous ? items.map((s) => (s.id === id ? saved : s)) : [...items, saved],
          ),
        () => saveLocalWorldSettings(items),
        () => expireBrowserChapterReviewAuthorizations(input.novelId),
      );
      return saved;
    });
  },

  // ========== 规则体系 ==========
  async getRuleSystems(novelId: string): Promise<RuleSystem[]> {
    return dbCall<RuleSystem[]>('get_rule_systems', { novelId }, () =>
      getLocalRuleSystems().filter((r) => r.novelId === novelId),
    );
  },

  async saveRuleSystem(id: string | null, input: SaveRuleSystemInput): Promise<RuleSystem> {
    return dbCall<RuleSystem>('save_rule_system', { id, input }, async () => {
      const items = getLocalRuleSystems();
      const previous = id ? items.find((r) => r.id === id) : undefined;
      if (id && (!previous || previous.novelId !== input.novelId))
        throw new Error('RULE_SET_SCOPE_MISMATCH');
      if (previous && input.expectedUpdatedAt !== previous.updatedAt)
        throw new Error('RULE_RECORD_BASE_CONFLICT');
      if (!previous && input.expectedUpdatedAt !== undefined)
        throw new Error('RULE_RECORD_BASE_CONFLICT');
      const structuredJson = input.structuredJson ?? previous?.structuredJson;
      const change: WorldRuleChange = {
        targetType: 'rule_system',
        targetId: id ?? undefined,
        title: input.title,
        content: input.content,
        category: input.category,
        forbiddenRules: input.forbiddenRules,
        structuredJson,
        isActive: input.isActive ?? true,
      };
      // Load before the mutation to avoid a static repository -> conversation -> context -> repository cycle.
      const { expireBrowserChapterReviewAuthorizations } =
        await import('../conversation/browserChapterReviewBaseline');
      const recheck = await authorizeLocalRuleChange(input.novelId, [change], input);
      recheck();
      const now = nowISO();
      const saved: RuleSystem = {
        id: previous?.id ?? generateId(),
        novelId: input.novelId,
        title: input.title,
        content: input.content,
        category: input.category,
        forbiddenRules: input.forbiddenRules,
        structuredJson,
        isActive: change.isActive,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      commitLocalRuleChange(
        () =>
          saveLocalRuleSystems(
            previous ? items.map((r) => (r.id === id ? saved : r)) : [...items, saved],
          ),
        () => saveLocalRuleSystems(items),
        () => expireBrowserChapterReviewAuthorizations(input.novelId),
      );
      return saved;
    });
  },

  async deleteRuleSystem(id: string, input?: DeleteRuleSystemInput): Promise<void> {
    return dbCall<void>('delete_rule_system', { id, input }, async () => {
      const items = getLocalRuleSystems();
      const source = items.find((r) => r.id === id);
      if (!input)
        throw new Error(
          'RULE_CHANGE_CONFIRMATION_REQUIRED: 请预览影响并明确确认删除；建议停用以保留来源',
        );
      if (!source || source.novelId !== input.novelId) throw new Error('RULE_SET_SCOPE_MISMATCH');
      if (input.expectedUpdatedAt !== source.updatedAt)
        throw new Error('RULE_RECORD_BASE_CONFLICT');
      const change: WorldRuleChange = {
        operation: 'delete',
        targetType: 'rule_system',
        targetId: id,
        title: source.title,
        content: source.content,
        category: source.category,
        forbiddenRules: source.forbiddenRules,
        structuredJson: source.structuredJson,
        isActive: source.isActive,
      };
      // Load before the mutation to avoid a static repository -> conversation -> context -> repository cycle.
      const { expireBrowserChapterReviewAuthorizations } =
        await import('../conversation/browserChapterReviewBaseline');
      const recheck = await authorizeLocalRuleChange(input.novelId, [change], input);
      recheck();
      commitLocalRuleChange(
        () => saveLocalRuleSystems(items.filter((r) => r.id !== id)),
        () => saveLocalRuleSystems(items),
        () => expireBrowserChapterReviewAuthorizations(input.novelId),
      );
    });
  },
};
