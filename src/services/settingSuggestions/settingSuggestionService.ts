/**
 * AI Novel Studio - 设定库 AI 推演候选服务
 *
 * 候选记录在桌面端以 SQLite `setting_suggestions`（migration 037）为事实源，浏览器开发模式
 * 继续使用 LocalStorage 候选池；首次在桌面端读取时把历史 LocalStorage 候选幂等迁入 SQLite。
 * 用户点击采纳后，才写入正式角色库、世界设定或规则体系。
 */
import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { aiTaskService } from '../ai/aiTaskService';
import { settingRepository } from '../database/settingRepository';
import { dbCall, generateId, getDbMode, lsGet, lsSet, nowISO } from '../database/db';
import { safeJsonParse } from '../../utils/dataGuard';
import type {
  GenerateSettingSuggestionsInput,
  SettingSuggestionAdoptionResult,
  SettingSuggestionPayload,
  SettingSuggestionRecord,
  SettingSuggestionTargetType,
  SettingSuggestionType,
} from '../../types/settingSuggestion';
import type { AiGenerateOptions } from '../../types/ai';
import { throwIfAiRequestCancelled } from '../ai/aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from '../ai/aiTaskCancellation';
import { suggestionEnvelope, withSuggestionLock } from './settingSuggestionLocalStore';
import { normalizePayload } from './settingSuggestionPayload';
import { buildSettingSuggestionPrompt as buildPrompt } from './settingSuggestionPrompt';
import {
  adoptSettingSuggestion,
  previewSettingSuggestionAdoption,
  type SuggestionAdoptionGuard,
} from './settingSuggestionAdoption';
export type { SuggestionAdoptionGuard };
import type { WorldRuleChangeImpact } from '../../types/worldRules';

interface RuleSetSnapshot {
  novelId: string;
  fingerprint: string;
  sources: Array<Record<string, unknown>>;
}

const KEY = 'ai_novel_studio_setting_suggestions';
export const SETTING_SUGGESTIONS_SQLITE_MIGRATION_KEY =
  'ai_novel_studio_setting_suggestions_sqlite_v1';

const typeLabels: Record<SettingSuggestionType, string> = {
  character: '角色候选',
  faction: '势力候选',
  location: '地点候选',
  rule: '规则候选',
};

const arrayKeys: Record<SettingSuggestionType, string[]> = {
  character: ['items', 'characters', '角色候选'],
  faction: ['items', 'factions', '势力候选'],
  location: ['items', 'locations', '地点候选'],
  rule: ['items', 'rules', '规则候选'],
};

function getAllLocal(): SettingSuggestionRecord[] {
  return (lsGet<SettingSuggestionRecord[]>(KEY) ?? [])
    .filter((item) => item && item.id && item.novelId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveAllLocal(items: SettingSuggestionRecord[]): void {
  lsSet(KEY, items);
}

function fromDto(dto: Record<string, unknown>): SettingSuggestionRecord {
  return {
    id: String(dto.id),
    novelId: String(dto.novelId),
    suggestionType: dto.suggestionType as SettingSuggestionType,
    worldType: typeof dto.worldType === 'string' ? dto.worldType : '',
    referenceStyle: typeof dto.referenceStyle === 'string' ? dto.referenceStyle : '',
    prompt: typeof dto.prompt === 'string' ? dto.prompt : '',
    resultJson: typeof dto.resultJson === 'string' ? dto.resultJson : '{}',
    item: normalizePayload(dto.item),
    status: dto.status as SettingSuggestionRecord['status'],
    adoptedTargetId: (dto.adoptedTargetId as string | null) ?? undefined,
    adoptedTargetType: (dto.adoptedTargetType as SettingSuggestionTargetType | null) ?? undefined,
    userInstruction: (dto.userInstruction as string | null) ?? undefined,
    rawOutput: (dto.rawOutput as string | null) ?? undefined,
    createdAt: String(dto.createdAt),
    updatedAt: String(dto.updatedAt),
  };
}

function toSaveInput(record: SettingSuggestionRecord): Record<string, unknown> {
  return {
    id: record.id,
    novelId: record.novelId,
    suggestionType: record.suggestionType,
    worldType: record.worldType,
    referenceStyle: record.referenceStyle,
    prompt: record.prompt,
    resultJson: record.resultJson,
    expectedRuleSetFingerprint:
      (suggestionEnvelope(record).nativeRuleSet as RuleSetSnapshot | undefined)?.fingerprint ??
      null,
    item: record.item,
    status: record.status,
    adoptedTargetId: record.adoptedTargetId ?? null,
    adoptedTargetType: record.adoptedTargetType ?? null,
    userInstruction: record.userInstruction ?? null,
    rawOutput: record.rawOutput ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function ensureDesktopMigrated(): Promise<void> {
  if (lsGet<boolean>(SETTING_SUGGESTIONS_SQLITE_MIGRATION_KEY)) return;
  for (const record of getAllLocal()) {
    try {
      const existing = await dbCall<Record<string, unknown> | null>('get_setting_suggestion', {
        suggestionId: record.id,
      });
      if (existing) continue;
      await dbCall('save_setting_suggestions', {
        inputs: [{ ...toSaveInput(record), expectedRuleSetFingerprint: null }],
      });
    } catch {
      // Candidates whose novel no longer exists stay in LocalStorage only; never block the rest.
    }
  }
  lsSet(SETTING_SUGGESTIONS_SQLITE_MIGRATION_KEY, true);
}

/** 桌面端走 SQLite 命令，浏览器模式走 LocalStorage 候选池。 */
const suggestionStore = {
  async listByNovel(novelId: string): Promise<SettingSuggestionRecord[]> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const rows = await dbCall<Record<string, unknown>[]>('list_setting_suggestions', {
        novelId,
      });
      return rows.map(fromDto);
    }
    return getAllLocal().filter((item) => item.novelId === novelId);
  },

  async getById(id: string): Promise<SettingSuggestionRecord | null> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const dto = await dbCall<Record<string, unknown> | null>('get_setting_suggestion', {
        suggestionId: id,
      });
      return dto ? fromDto(dto) : null;
    }
    return getAllLocal().find((item) => item.id === id) ?? null;
  },

  /** 一次生成的候选整批落库；桌面端由 Rust 事务保证全有或全无。 */
  async insertBatch(records: SettingSuggestionRecord[]): Promise<SettingSuggestionRecord[]> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const rows = await dbCall<Record<string, unknown>[]>('save_setting_suggestions', {
        inputs: records.map(toSaveInput),
      });
      return rows.map(fromDto);
    }
    saveAllLocal([...records, ...getAllLocal()]);
    return records;
  },

  /** pending → adopted / edited_adopted / discarded，只允许推进一次。 */
  async decide(
    record: SettingSuggestionRecord,
    decision: {
      status: 'adopted' | 'edited_adopted' | 'discarded';
      item?: SettingSuggestionPayload;
      adoptedTargetId?: string;
      adoptedTargetType?: SettingSuggestionTargetType;
    },
  ): Promise<SettingSuggestionRecord> {
    if (getDbMode() === 'tauri') {
      const dto = await dbCall<Record<string, unknown>>('decide_setting_suggestion', {
        input: {
          id: record.id,
          status: decision.status,
          item: decision.item ?? null,
          adoptedTargetId: decision.adoptedTargetId ?? null,
          adoptedTargetType: decision.adoptedTargetType ?? null,
        },
      });
      return fromDto(dto);
    }
    return updateRecord({
      ...record,
      item: decision.item ?? record.item,
      status: decision.status,
      adoptedTargetId: decision.adoptedTargetId,
      adoptedTargetType: decision.adoptedTargetType,
      updatedAt: nowISO(),
    });
  },
};

function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (match?.[1] || text).trim();
}

function extractPayloads(
  text: string,
  suggestionType: SettingSuggestionType,
): SettingSuggestionPayload[] {
  const parsed = safeJsonParse<unknown>(stripCodeFence(text), null);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.map(normalizePayload).filter((item) => item.name);

  if (typeof parsed === 'object') {
    const source = parsed as Record<string, unknown>;
    for (const key of arrayKeys[suggestionType]) {
      const value = source[key];
      if (Array.isArray(value)) {
        return value.map(normalizePayload).filter((item) => item.name);
      }
    }
  }

  return [];
}

function updateRecord(record: SettingSuggestionRecord): SettingSuggestionRecord {
  const all = getAllLocal();
  const idx = all.findIndex((item) => item.id === record.id);
  if (idx === -1) throw new Error('候选记录不存在');
  all[idx] = record;
  saveAllLocal(all);
  return record;
}

async function currentRuleSetSnapshot(novelId: string): Promise<RuleSetSnapshot> {
  return settingRepository.getWorldRuleSetSnapshot(novelId);
}

export const settingSuggestionService = {
  async getByNovelId(novelId: string): Promise<SettingSuggestionRecord[]> {
    return suggestionStore.listByNovel(novelId);
  },

  async generate(
    input: GenerateSettingSuggestionsInput,
    options: AiGenerateOptions = {},
  ): Promise<SettingSuggestionRecord[]> {
    const settings = aiSettingsService.getSettings();
    const frozenRuleSet = await currentRuleSetSnapshot(input.novelId);
    const prompt = await buildPrompt(input);
    if ((await currentRuleSetSnapshot(input.novelId)).fingerprint !== frozenRuleSet.fingerprint)
      throw new Error('RULE_SET_BASE_CONFLICT: 构建上下文期间规则变化');
    const task = await aiTaskService
      .create('setting_suggestion_generate', {
        novelId: input.novelId,
        runtimeMode: settings.runtimeMode,
        provider: settings.provider,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        inputSummary: `${typeLabels[input.suggestionType]}：${input.worldType} / ${input.referenceStyle}`,
      })
      .catch(() => null);
    const releaseCancellation = bindAiTaskCancellation(task?.id, options);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(
        {
          taskType: 'setting_suggestion_generate',
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: `请生成 ${input.count} 条${typeLabels[input.suggestionType]}。`,
            },
          ],
          maxTokens: 5000,
        },
        options,
      );
      throwIfAiRequestCancelled(options.signal);

      const payloads = extractPayloads(response.text, input.suggestionType);
      if (payloads.length === 0) {
        throw new Error('AI 返回格式无法解析，请检查模型输出或切换 Mock 模式重试');
      }

      const now = nowISO();
      const records = payloads.slice(0, Math.max(1, input.count)).map((item) => ({
        id: generateId(),
        novelId: input.novelId,
        suggestionType: input.suggestionType,
        worldType: input.worldType,
        referenceStyle: input.referenceStyle,
        prompt,
        resultJson: JSON.stringify({
          format: 'setting-candidate-v1',
          originalResultJson: JSON.stringify(item, null, 2),
          nativeRuleSet: frozenRuleSet,
        }),
        item,
        status: 'pending' as const,
        userInstruction: input.userInstruction,
        rawOutput: response.text,
        createdAt: now,
        updatedAt: now,
      }));

      if ((await currentRuleSetSnapshot(input.novelId)).fingerprint !== frozenRuleSet.fingerprint)
        throw new Error('RULE_SET_BASE_CONFLICT: 生成期间规则变化，候选不能使用新基线');
      const persisted = await suggestionStore.insertBatch(records);
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `生成 ${records.length} 条${typeLabels[input.suggestionType]}`,
        promptSnapshot: prompt,
        resultJson: JSON.stringify(
          records.map((item) => item.item),
          null,
          2,
        ),
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return persisted;
    } catch (e: unknown) {
      await settleAiTaskError({
        taskId: task?.id,
        error: e,
        signal: options.signal,
        fallbackMessage: '设定库 AI 推演失败',
      });
      throw e;
    } finally {
      releaseCancellation();
    }
  },

  async previewAdoption(
    id: string,
    editedItem?: SettingSuggestionPayload,
  ): Promise<WorldRuleChangeImpact | null> {
    return previewSettingSuggestionAdoption(
      { getById: suggestionStore.getById, fromDto },
      id,
      editedItem,
    );
  },

  async adopt(
    id: string,
    editedItem?: SettingSuggestionPayload,
    guard: SuggestionAdoptionGuard = {},
  ): Promise<SettingSuggestionAdoptionResult> {
    return adoptSettingSuggestion(
      { getById: suggestionStore.getById, fromDto },
      id,
      editedItem,
      guard,
    );
  },

  async discard(id: string): Promise<SettingSuggestionRecord> {
    return withSuggestionLock(id, async () => {
      const record = await suggestionStore.getById(id);
      if (!record) throw new Error('候选记录不存在');
      if (record.status !== 'pending') throw new Error('该候选已处理');
      if (getDbMode() !== 'tauri' && suggestionEnvelope(record).receipt)
        throw new Error('浏览器采用恢复尚未完成，请重试原采用，不可丢弃已有目标回执');
      return suggestionStore.decide(record, { status: 'discarded' });
    });
  },

  _private: {
    extractPayloads,
    normalizePayload,
    buildPrompt,
  },
};
