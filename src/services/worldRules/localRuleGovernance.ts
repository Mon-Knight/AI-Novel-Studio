import type { RuleSystem, WorldSetting } from '../../types/setting';
import type {
  WorldRuleChange,
  WorldRuleChangeImpact,
  WorldRuleSaveGuard,
} from '../../types/worldRules';
import { canonicalHash, stableCanonicalJson } from '../ai/compilation/canonical';
import { lsGet } from '../database/db';
import { parseWorldRuleDocument } from './worldRuleSchema';
import { validateWorldRuleMutation } from './worldRuleMutation';

type ChapterIdentity = {
  id: string;
  novelId: string;
  title: string;
  adoptedDraftId?: string;
  updatedAt?: string;
};
function captureLocalRuleAssets(novelId: string) {
  const worlds = (lsGet<WorldSetting[]>('ai_novel_studio_world_settings') ?? []).filter(
    (r) => r.novelId === novelId,
  );
  const rules = (lsGet<RuleSystem[]>('ai_novel_studio_rule_systems') ?? []).filter(
    (r) => r.novelId === novelId,
  );
  return { worlds, rules };
}
function localRows(state: ReturnType<typeof captureLocalRuleAssets>) {
  return [
    ...state.worlds.map((r) => ({ ...r, targetType: 'world_setting' })),
    ...state.rules.map((r) => ({ ...r, targetType: 'rule_system' })),
  ].sort((a, b) => a.id.localeCompare(b.id));
}
export async function readLocalRuleSetSnapshot(
  novelId: string,
  state = captureLocalRuleAssets(novelId),
) {
  const sources = await Promise.all(
    localRows(state).map(async (row) => ({
      sourceType: row.targetType,
      sourceId: row.id,
      title: row.title,
      isActive: row.isActive,
      recordHash: await canonicalHash(row),
    })),
  );
  return {
    novelId,
    fingerprint: await canonicalHash({ mode: 'browser-world-rule-set-v1', novelId, sources }),
    sources,
  };
}
export function captureLocalRuleState(novelId: string) {
  const { worlds, rules } = captureLocalRuleAssets(novelId);
  const chapters = (lsGet<ChapterIdentity[]>('ai_novel_studio_chapters') ?? []).filter(
    (r) => r.novelId === novelId && r.adoptedDraftId,
  );
  const drafts = chapters.map((c) => ({
    chapterId: c.id,
    records: lsGet<unknown>('ai_novel_studio_drafts_list_' + c.id),
  }));
  return { worlds, rules, chapters, drafts };
}
export async function previewLocalRuleChange(
  novelId: string,
  changes: WorldRuleChange[],
  state = captureLocalRuleState(novelId),
): Promise<WorldRuleChangeImpact> {
  if (!novelId || !changes.length || changes.length > 200)
    throw new Error('RULE_CHANGE_INPUT_INVALID');
  const rows = localRows(state);
  const { sources, fingerprint: ruleSetFingerprint } = await readLocalRuleSetSnapshot(
    novelId,
    state,
  );
  const blockingConflicts: Array<Record<string, unknown>> = [];
  const dependentRules: Array<Record<string, unknown>> = [];
  for (const change of changes) {
    if (
      !['world_setting', 'rule_system'].includes(change.targetType) ||
      !change.title.trim() ||
      !change.content.trim()
    )
      throw new Error('RULE_CHANGE_INPUT_INVALID');
    if (change.operation && !['upsert', 'delete'].includes(change.operation))
      throw new Error('RULE_CHANGE_INPUT_INVALID');
    if (
      change.targetId &&
      !rows.some((r) => r.id === change.targetId && r.targetType === change.targetType)
    )
      throw new Error('RULE_SET_SCOPE_MISMATCH');
    const parsed = parseWorldRuleDocument(change.structuredJson);
    if (parsed.status === 'valid')
      for (const id of parsed.document.dependencies.filter((id) => id.trim())) {
        if (!rows.some((r) => r.id === id))
          blockingConflicts.push({
            code: 'RULE_DEPENDENCY_MISSING',
            ruleId: id,
            certainty: 'verified_reference',
          });
      }
    if (change.operation === 'delete') {
      if (!change.targetId) throw new Error('RULE_SET_SCOPE_MISMATCH');
      for (const row of rows) {
        const reference = parseWorldRuleDocument(row.structuredJson);
        if (
          reference.status === 'valid' &&
          reference.document.dependencies.includes(change.targetId)
        ) {
          const fact = {
            code: 'RULE_DELETE_DEPENDENCY',
            ruleId: row.id,
            certainty: 'verified_reference',
            evidence: '此规则显式依赖待删除资产，请先修订依赖或选择停用。',
          };
          dependentRules.push(fact);
          blockingConflicts.push(fact);
        }
      }
    }
  }
  const affectedChapters = state.chapters.map((c) => ({
    chapterId: c.id,
    title: c.title,
    adoptedDraftId: c.adoptedDraftId!,
    evidence: '已有采用稿，变更可能影响正史；未证明语义矛盾。',
    certainty: 'potential_impact',
  }));
  const normalizedChanges = changes.map((c) => ({
    operation: c.operation ?? 'upsert',
    targetType: c.targetType,
    targetId: c.targetId ?? null,
    title: c.title,
    content: c.content,
    category: c.category ?? null,
    forbiddenRules: c.forbiddenRules ?? null,
    structuredJson: c.structuredJson ?? null,
    isActive: c.isActive,
  }));
  const previewHash = await canonicalHash({
    mode: 'browser-world-rule-change-v1',
    novelId,
    changes: normalizedChanges,
    ruleSetFingerprint,
    state,
    blockingConflicts,
  });
  return {
    novelId,
    ruleSetFingerprint,
    sources,
    previewHash,
    affectedChapters,
    dependentRules,
    blockingConflicts,
    uncertainty: ['浏览器开发回退：保守列出采用章；不冒充桌面SQLite事务或任意小说语义证明。'],
    requiresConfirmation: true,
  };
}
export async function authorizeLocalRuleChange(
  novelId: string,
  changes: WorldRuleChange[],
  guard: WorldRuleSaveGuard,
): Promise<() => void> {
  const confirmationRequired =
    'RULE_CHANGE_CONFIRMATION_REQUIRED: 请先预览影响并明确确认本次变更；浏览器回退不提供SQLite事务';
  const auth = guard?.changeAuthorization;
  if (
    !guard ||
    typeof guard.expectedRuleSetFingerprint !== 'string' ||
    !guard.expectedRuleSetFingerprint.trim() ||
    !auth ||
    typeof auth.previewHash !== 'string' ||
    !auth.previewHash.trim() ||
    !['confirm_change', 'retcon', 'approve_exception'].includes(auth.intent)
  )
    throw new Error(confirmationRequired);

  const state = captureLocalRuleState(novelId);
  const preview = await previewLocalRuleChange(novelId, changes, state);
  if (guard.expectedRuleSetFingerprint !== preview.ruleSetFingerprint)
    throw new Error('RULE_SET_BASE_CONFLICT: 请重新预览并确认本次变更');
  if (auth.previewHash !== preview.previewHash) throw new Error(confirmationRequired);
  if (preview.blockingConflicts.length) throw new Error('RULE_CHANGE_BLOCKED: 请先解决显式依赖');
  if (auth.intent !== 'confirm_change' && !auth.notes?.trim())
    throw new Error('RULE_CHANGE_NOTES_REQUIRED');
  if (
    auth.intent === 'approve_exception' &&
    changes.some((change) => {
      const parsed = parseWorldRuleDocument(change.structuredJson);
      return (
        parsed.status !== 'valid' ||
        !parsed.document.exceptions.length ||
        parsed.document.exceptions.some(
          (e) => !e.condition.trim() || !e.effect.trim() || !e.reason.trim(),
        )
      );
    })
  )
    throw new Error('RULE_EXCEPTION_SCOPE_REQUIRED');
  for (const change of changes) {
    const previous = (change.targetType === 'world_setting' ? state.worlds : state.rules).find(
      (r) => r.id === change.targetId,
    );
    validateWorldRuleMutation(
      change.structuredJson ?? previous?.structuredJson,
      previous?.structuredJson,
      auth.intent,
    );
  }
  const baseline = stableCanonicalJson(state);
  return () => {
    if (stableCanonicalJson(captureLocalRuleState(novelId)) !== baseline)
      throw new Error('RULE_SET_BASE_CONFLICT: 预览后资料已改变');
  };
}
