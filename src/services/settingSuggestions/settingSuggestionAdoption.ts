import { dbCall, getDbMode } from '../database/db';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { canonicalHash } from '../ai/compilation/canonical';
import { authorizeLocalRuleChange } from '../worldRules/localRuleGovernance';
import { expireBrowserChapterReviewAuthorizations } from '../conversation/browserChapterReviewBaseline';
import {
  adoptLocalSuggestion,
  suggestionCandidateHash,
  suggestionEnvelope,
  withSuggestionLock,
} from './settingSuggestionLocalStore';
import { normalizePayload } from './settingSuggestionPayload';
import type {
  SettingSuggestionRecord,
  SettingSuggestionPayload,
  SettingSuggestionAdoptionResult,
  SettingSuggestionTargetType,
} from '../../types/settingSuggestion';
import type { RuleCategory } from '../../types/setting';
import type { CharacterRoleType } from '../../types/character';
import type {
  WorldRuleChange,
  WorldRuleChangeAuthorization,
  WorldRuleChangeImpact,
  WorldRuleSetSnapshot as RuleSetSnapshot,
} from '../../types/worldRules';

export interface SuggestionAdoptionGuard {
  expectedRuleSetFingerprint?: string;
  changeAuthorization?: WorldRuleChangeAuthorization;
}
interface AdoptionDependencies {
  getById: (id: string) => Promise<SettingSuggestionRecord | null>;
  fromDto: (dto: Record<string, unknown>) => SettingSuggestionRecord;
}
const currentRuleSetSnapshot = (novelId: string) =>
  settingRepository.getWorldRuleSetSnapshot(novelId);

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
  const roleText = fieldValue(item, [
    'roleType',
    'role_type',
    'plot_role',
    'identity',
  ]).toLowerCase();
  if (roleText.includes('antagonist') || roleText.includes('反派') || roleText.includes('敌'))
    return 'antagonist';
  if (roleText.includes('protagonist') || roleText.includes('主角')) return 'protagonist';
  if (roleText.includes('neutral') || roleText.includes('中立')) return 'neutral';
  return 'supporting';
}

function localTarget(record: SettingSuggestionRecord, item: SettingSuggestionPayload) {
  const common = {
    id: 'setting-suggestion-' + record.id,
    novelId: record.novelId,
    isActive: true,
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
  };
  if (record.suggestionType === 'character')
    return {
      targetType: 'character' as const,
      target: {
        ...common,
        name: fieldValue(item, ['name']),
        roleType: mapCharacterRole(item),
        identity: fieldValue(item, ['identity']),
        faction: fieldValue(item, ['faction']),
        relationToProtagonist: fieldValue(item, ['mainline_relation', 'relationToProtagonist']),
        goal: fieldValue(item, ['goal']),
        personality: fieldValue(item, ['personality']),
        behaviorLimits: fieldValue(item, ['weakness'])
          ? '弱点：' + fieldValue(item, ['weakness'])
          : '',
        currentState: fieldValue(item, ['current_status', 'currentState']),
        source: 'manual',
        isProtagonist: mapCharacterRole(item) === 'protagonist',
      },
    };
  if (record.suggestionType === 'rule')
    return {
      targetType: 'rule_system' as const,
      target: {
        ...common,
        title: fieldValue(item, ['name']),
        category: mapRuleCategory(fieldValue(item, ['type'])),
        content: [
          fieldValue(item, ['content', 'description']),
          ...[
            ['limits', '限制条件'],
            ['scope', '影响范围'],
            ['possible_conflict', '可能冲突'],
            ['plot_usage', '剧情用途'],
          ].map(([key, label]) =>
            fieldValue(item, [key]) ? label + '：' + fieldValue(item, [key]) : '',
          ),
        ]
          .filter(Boolean)
          .join('\n'),
        forbiddenRules: fieldValue(item, ['forbiddenRules', 'forbidden_rules']),
        structuredJson: fieldValue(item, ['structuredJson']),
      },
    };
  if (!['faction', 'location'].includes(record.suggestionType)) throw new Error('未知候选类型');
  const prefix = record.suggestionType === 'faction' ? '势力' : '地点';
  return {
    targetType: 'world_setting' as const,
    target: {
      ...common,
      title: prefix + '：' + fieldValue(item, ['name']),
      content: [
        '来源：设定库 AI 推演候选',
        '类型：' + prefix + '候选',
        '',
        toContentBlock(item),
      ].join('\n'),
      structuredJson: fieldValue(item, ['structuredJson']),
    },
  };
}

function localRuleChange(
  record: SettingSuggestionRecord,
  item: SettingSuggestionPayload,
): WorldRuleChange | null {
  const result = localTarget(record, item);
  if (result.targetType === 'character') return null;
  const target = result.target as Record<string, unknown>;
  return {
    targetType: result.targetType,
    title: String(target.title),
    content: String(target.content),
    category: typeof target.category === 'string' ? target.category : undefined,
    forbiddenRules:
      typeof target.forbiddenRules === 'string' && target.forbiddenRules
        ? target.forbiddenRules
        : undefined,
    structuredJson:
      typeof target.structuredJson === 'string' && target.structuredJson
        ? target.structuredJson
        : undefined,
    isActive: true,
  };
}

async function scopeLocalPreview(
  preview: WorldRuleChangeImpact,
  request: Awaited<ReturnType<typeof adoptionInput>>,
) {
  return {
    ...preview,
    previewHash: await canonicalHash({
      previewHash: preview.previewHash,
      novelId: request.novelId,
      suggestionId: request.id,
      candidateHash: request.expectedCandidateHash,
      authorizedItemHash: request.authorizedItemHash,
      edited: request.editedItem !== null,
    }),
  };
}

async function adoptionInput(
  record: SettingSuggestionRecord,
  editedItem?: SettingSuggestionPayload,
  guard: SuggestionAdoptionGuard = {},
) {
  const metadata = suggestionEnvelope(record);
  const receipt = metadata.receipt as SuggestionAdoptionGuard | undefined;
  const item = editedItem
    ? normalizePayload(editedItem)
    : ((metadata.originalItem as SettingSuggestionPayload | undefined) ?? record.item);
  if (!fieldValue(item, ['name'])) throw new Error('候选名称不能为空');
  return {
    id: record.id,
    novelId: record.novelId,
    expectedCandidateHash: await suggestionCandidateHash(record),
    authorizedItemHash: await canonicalHash(item),
    editedItem: editedItem ? item : null,
    actor: 'user',
    expectedRuleSetFingerprint:
      guard.expectedRuleSetFingerprint ?? receipt?.expectedRuleSetFingerprint ?? null,
    changeAuthorization: guard.changeAuthorization ?? receipt?.changeAuthorization ?? null,
  };
}

export async function previewSettingSuggestionAdoption(
  dependencies: AdoptionDependencies,
  id: string,
  editedItem?: SettingSuggestionPayload,
): Promise<WorldRuleChangeImpact | null> {
  const record = await dependencies.getById(id);
  if (!record) throw new Error('候选记录不存在');
  const request = await adoptionInput(record, editedItem);
  if (getDbMode() === 'tauri')
    return dbCall<WorldRuleChangeImpact | null>('preview_setting_suggestion_adoption', {
      input: request,
    });
  const item = request.editedItem ?? record.item;
  const frozen = suggestionEnvelope(record).nativeRuleSet as RuleSetSnapshot | undefined;
  if (frozen && (await currentRuleSetSnapshot(record.novelId)).fingerprint !== frozen.fingerprint)
    throw new Error('RULE_SET_BASE_CONFLICT: 候选后规则已变化');
  const change = localRuleChange(record, item);
  return change
    ? scopeLocalPreview(
        await settingRepository.previewWorldRuleChange(record.novelId, [change]),
        request,
      )
    : null;
}

export async function adoptSettingSuggestion(
  dependencies: AdoptionDependencies,
  id: string,
  editedItem?: SettingSuggestionPayload,
  guard: SuggestionAdoptionGuard = {},
): Promise<SettingSuggestionAdoptionResult> {
  return withSuggestionLock(id, async () => {
    const record = await dependencies.getById(id);
    if (!record) throw new Error('候选记录不存在');
    const request = await adoptionInput(record, editedItem, guard);
    if (getDbMode() === 'tauri') {
      const result = await dbCall<{
        record: Record<string, unknown>;
        targetId: string;
        targetType: SettingSuggestionTargetType;
      }>('adopt_setting_suggestion', { input: request });
      return {
        record: dependencies.fromDto(result.record),
        targetId: result.targetId,
        targetType: result.targetType,
      };
    }
    if (!(await novelRepository.getById(record.novelId))) throw new Error('作品不存在');
    const item =
      request.editedItem ??
      (suggestionEnvelope(record).originalItem as SettingSuggestionPayload | undefined) ??
      record.item;
    const target = localTarget(record, item);
    const change = localRuleChange(record, item);
    const requestHash = await canonicalHash({
      candidateHash: request.expectedCandidateHash,
      authorizedItemHash: request.authorizedItemHash,
      edited: request.editedItem !== null,
      novelId: record.novelId,
      targetType: target.targetType,
      expectedRuleSetFingerprint: request.expectedRuleSetFingerprint,
      changeAuthorization: request.changeAuthorization,
    });
    return adoptLocalSuggestion({
      record,
      item,
      edited: request.editedItem !== null,
      requestHash,
      candidateHash: request.expectedCandidateHash,
      ...target,
      onTargetWritten: change
        ? () => expireBrowserChapterReviewAuthorizations(record.novelId)
        : undefined,
      guard: {
        expectedRuleSetFingerprint: request.expectedRuleSetFingerprint ?? undefined,
        changeAuthorization: request.changeAuthorization ?? undefined,
      },
      validate: async () => {
        const frozen = suggestionEnvelope(record).nativeRuleSet as RuleSetSnapshot | undefined;
        if (
          frozen &&
          (await currentRuleSetSnapshot(record.novelId)).fingerprint !== frozen.fingerprint
        )
          throw new Error('RULE_SET_BASE_CONFLICT: 候选后规则已变化');
        if (!change) return undefined;
        const preview = await settingRepository.previewWorldRuleChange(record.novelId, [change]);
        const scoped = await scopeLocalPreview(preview, request);
        if (
          !request.changeAuthorization ||
          scoped.previewHash !== request.changeAuthorization.previewHash
        )
          throw new Error('RULE_CHANGE_CONFIRMATION_REQUIRED: 需要本候选的影响确认');
        return authorizeLocalRuleChange(record.novelId, [change], {
          expectedRuleSetFingerprint: request.expectedRuleSetFingerprint ?? undefined,
          changeAuthorization: { ...request.changeAuthorization, previewHash: preview.previewHash },
        });
      },
    });
  });
}
