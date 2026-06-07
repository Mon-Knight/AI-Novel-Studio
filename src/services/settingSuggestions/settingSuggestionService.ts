/**
 * AI Novel Studio - 设定库 AI 推演候选服务
 *
 * 候选记录保存在前端本地候选池中，避免在本轮直接变更数据库 schema。
 * 用户点击采纳后，才写入正式角色库、世界设定或规则体系。
 */
import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { aiTaskService } from '../ai/aiTaskService';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { characterService } from '../characters/characterService';
import { generateId, lsGet, lsSet, nowISO } from '../database/db';
import { safeJsonParse } from '../../utils/dataGuard';
import type {
  GenerateSettingSuggestionsInput,
  SettingSuggestionAdoptionResult,
  SettingSuggestionPayload,
  SettingSuggestionRecord,
  SettingSuggestionTargetType,
  SettingSuggestionType,
} from '../../types/settingSuggestion';
import type { RuleCategory } from '../../types/setting';
import type { CharacterRoleType } from '../../types/character';

const KEY = 'ai_novel_studio_setting_suggestions';

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

function stripCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (match?.[1] || text).trim();
}

function normalizePayload(raw: unknown): SettingSuggestionPayload {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  );
}

function extractPayloads(text: string, suggestionType: SettingSuggestionType): SettingSuggestionPayload[] {
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

function fieldValue(item: SettingSuggestionPayload, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = item[key];
    if (value && value.trim()) return value.trim();
  }
  return fallback;
}

function toContentBlock(item: SettingSuggestionPayload): string {
  return Object.entries(item)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function mapRuleCategory(type?: string): RuleCategory {
  const normalized = (type || '').toLowerCase();
  if (normalized.includes('magic') || normalized.includes('魔法')) return 'magic';
  if (normalized.includes('technology') || normalized.includes('科技')) return 'technology';
  if (normalized.includes('cultivation') || normalized.includes('修炼')) return 'cultivation';
  if (normalized.includes('combat') || normalized.includes('战斗')) return 'combat';
  if (normalized.includes('social') || normalized.includes('社会')) return 'social';
  return 'other';
}

function mapCharacterRole(item: SettingSuggestionPayload): CharacterRoleType {
  const roleText = fieldValue(item, ['roleType', 'role_type', 'plot_role', 'identity']).toLowerCase();
  if (roleText.includes('antagonist') || roleText.includes('反派') || roleText.includes('敌')) return 'antagonist';
  if (roleText.includes('protagonist') || roleText.includes('主角')) return 'protagonist';
  if (roleText.includes('neutral') || roleText.includes('中立')) return 'neutral';
  return 'supporting';
}

async function buildPrompt(input: GenerateSettingSuggestionsInput): Promise<string> {
  const [novel, worldSettings, ruleSystems, characters] = await Promise.all([
    novelRepository.getById(input.novelId),
    input.includeWorldSettings ? settingRepository.getWorldSettings(input.novelId).catch(() => []) : Promise.resolve([]),
    input.includeWorldSettings ? settingRepository.getRuleSystems(input.novelId).catch(() => []) : Promise.resolve([]),
    input.includeExistingAssets ? characterService.getByNovelId(input.novelId).catch(() => []) : Promise.resolve([]),
  ]);

  const worldSummary = worldSettings
    .map((item) => `《${item.title}》${item.content}`)
    .join('\n')
    .slice(0, 2400);
  const ruleSummary = ruleSystems
    .map((item) => `《${item.title}》${item.content}`)
    .join('\n')
    .slice(0, 1800);
  const characterSummary = characters
    .map((item) => `${item.name}${item.identity ? `（${item.identity}）` : ''}${item.faction ? ` / ${item.faction}` : ''}`)
    .join('、')
    .slice(0, 1200);

  return [
    '你是 AI Novel Studio 的设定库 AI 推演助手。',
    '你的职责是生成候选设定，不能把候选当作正式正史。',
    '',
    `作品：《${novel?.title || '未命名作品'}》`,
    novel?.genre ? `题材：${novel.genre}` : '',
    novel?.description ? `简介：${novel.description}` : '',
    `生成类型：${input.suggestionType}`,
    `世界类型：${input.worldType}`,
    `参考方向：${input.referenceStyle}`,
    `生成数量：${input.count}`,
    input.userInstruction ? `用户补充要求：${input.userInstruction}` : '',
    '',
    input.includeWorldSettings && worldSummary ? `【已有世界设定摘要】\n${worldSummary}` : '',
    input.includeWorldSettings && ruleSummary ? `【已有规则体系摘要】\n${ruleSummary}` : '',
    input.includeExistingAssets && characterSummary ? `【已有角色/势力线索摘要】\n${characterSummary}` : '',
    '',
    '请参考典型题材中的世界结构、势力矛盾、种族关系、力量体系、宗教冲突、社会结构和战争格局，生成原创设定。',
    '不得直接使用任何现成作品中的专有名称、角色、地点、势力、具体剧情或可识别 IP 元素。',
    '只能借鉴类型结构，不能复制具体作品内容。',
    '输出必须为结构化 JSON，不要输出解释文字。',
    '',
    '请严格按以下 JSON 格式返回：',
    '{',
    '  "items": [',
    input.suggestionType === 'character'
      ? '    { "name": "角色姓名", "identity": "身份", "faction": "所属势力", "personality": "性格", "goal": "目标", "ability": "能力", "weakness": "弱点", "current_status": "当前状态", "plot_role": "潜在剧情作用", "mainline_relation": "与主线关系" }'
      : input.suggestionType === 'faction'
        ? '    { "name": "势力名称", "type": "势力类型", "leader": "领袖", "goal": "核心目标", "resources": "资源", "allies": "盟友", "enemies": "敌人", "territory": "控制区域", "internal_conflict": "内部矛盾", "plot_role": "剧情作用" }'
        : input.suggestionType === 'location'
          ? '    { "name": "地点名称", "type": "地点类型", "region": "所在区域", "controlled_by": "控制势力", "description": "描述", "danger_level": "危险程度", "resource": "重要资源", "history": "关键历史", "plot_trigger": "可触发剧情" }'
          : '    { "name": "规则名称", "type": "规则类型", "content": "规则内容", "limits": "限制条件", "scope": "影响范围", "possible_conflict": "可能冲突", "plot_usage": "剧情用途" }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');
}

function updateRecord(record: SettingSuggestionRecord): SettingSuggestionRecord {
  const all = getAllLocal();
  const idx = all.findIndex((item) => item.id === record.id);
  if (idx === -1) throw new Error('候选记录不存在');
  all[idx] = record;
  saveAllLocal(all);
  return record;
}

async function adoptTarget(
  record: SettingSuggestionRecord,
  item: SettingSuggestionPayload,
): Promise<{ targetId?: string; targetType?: SettingSuggestionTargetType }> {
  if (record.suggestionType === 'character') {
    const created = await characterService.create({
      novelId: record.novelId,
      name: fieldValue(item, ['name'], '未命名角色'),
      roleType: mapCharacterRole(item),
      identity: fieldValue(item, ['identity']),
      faction: fieldValue(item, ['faction']),
      relationToProtagonist: fieldValue(item, ['mainline_relation', 'relationToProtagonist']),
      goal: fieldValue(item, ['goal']),
      personality: fieldValue(item, ['personality']),
      behaviorLimits: fieldValue(item, ['weakness']) ? `弱点：${fieldValue(item, ['weakness'])}` : undefined,
      currentState: fieldValue(item, ['current_status', 'currentState']),
    });
    return { targetId: created.id, targetType: 'character' };
  }

  if (record.suggestionType === 'rule') {
    const created = await settingRepository.saveRuleSystem(null, {
      novelId: record.novelId,
      title: fieldValue(item, ['name'], '未命名规则'),
      category: mapRuleCategory(fieldValue(item, ['type'])),
      content: [
        fieldValue(item, ['content', 'description'], '（空）'),
        fieldValue(item, ['limits']) ? `限制条件：${fieldValue(item, ['limits'])}` : '',
        fieldValue(item, ['scope']) ? `影响范围：${fieldValue(item, ['scope'])}` : '',
        fieldValue(item, ['possible_conflict']) ? `可能冲突：${fieldValue(item, ['possible_conflict'])}` : '',
        fieldValue(item, ['plot_usage']) ? `剧情用途：${fieldValue(item, ['plot_usage'])}` : '',
      ].filter(Boolean).join('\n'),
      isActive: true,
    });
    return { targetId: created.id, targetType: 'rule_system' };
  }

  const prefix = record.suggestionType === 'faction' ? '势力' : '地点';
  const created = await settingRepository.saveWorldSetting(null, {
    novelId: record.novelId,
    title: `${prefix}：${fieldValue(item, ['name'], `未命名${prefix}`)}`,
    content: [
      `来源：设定库 AI 推演候选`,
      `类型：${typeLabels[record.suggestionType]}`,
      '',
      toContentBlock(item),
    ].join('\n'),
    isActive: true,
  });
  return { targetId: created.id, targetType: 'world_setting' };
}

export const settingSuggestionService = {
  async getByNovelId(novelId: string): Promise<SettingSuggestionRecord[]> {
    return getAllLocal().filter((item) => item.novelId === novelId);
  },

  async generate(input: GenerateSettingSuggestionsInput): Promise<SettingSuggestionRecord[]> {
    const settings = aiSettingsService.getSettings();
    const prompt = await buildPrompt(input);
    const task = await aiTaskService.create('setting_suggestion_generate', {
      novelId: input.novelId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `${typeLabels[input.suggestionType]}：${input.worldType} / ${input.referenceStyle}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate({
        taskType: 'setting_suggestion_generate',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `请生成 ${input.count} 条${typeLabels[input.suggestionType]}。` },
        ],
        maxTokens: 5000,
      });

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
        resultJson: JSON.stringify(item, null, 2),
        item,
        status: 'pending' as const,
        userInstruction: input.userInstruction,
        rawOutput: response.text,
        createdAt: now,
        updatedAt: now,
      }));

      saveAllLocal([...records, ...getAllLocal()]);
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `生成 ${records.length} 条${typeLabels[input.suggestionType]}`,
        promptSnapshot: prompt,
        resultJson: JSON.stringify(records.map((item) => item.item), null, 2),
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return records;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '设定库 AI 推演失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },

  async adopt(id: string, editedItem?: SettingSuggestionPayload): Promise<SettingSuggestionAdoptionResult> {
    const record = getAllLocal().find((item) => item.id === id);
    if (!record) throw new Error('候选记录不存在');
    if (record.status !== 'pending') throw new Error('该候选已处理，不能重复采纳');

    const item = editedItem ? normalizePayload(editedItem) : record.item;
    const target = await adoptTarget(record, item);
    const updated = updateRecord({
      ...record,
      item,
      status: editedItem ? 'edited_adopted' : 'adopted',
      adoptedTargetId: target.targetId,
      adoptedTargetType: target.targetType,
      updatedAt: nowISO(),
    });

    return { record: updated, targetId: target.targetId, targetType: target.targetType };
  },

  async discard(id: string): Promise<SettingSuggestionRecord> {
    const record = getAllLocal().find((item) => item.id === id);
    if (!record) throw new Error('候选记录不存在');
    if (record.status !== 'pending') throw new Error('该候选已处理');
    return updateRecord({ ...record, status: 'discarded', updatedAt: nowISO() });
  },

  _private: {
    extractPayloads,
    normalizePayload,
  },
};
