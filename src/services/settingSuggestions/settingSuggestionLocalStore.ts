/** Browser development recovery journal. This is NOT a SQLite transaction. */
import { lsGet, lsSet } from '../database/db';
import { canonicalHash, stableCanonicalJson } from '../ai/compilation/canonical';
import type {
  SettingSuggestionAdoptionResult,
  SettingSuggestionRecord,
  SettingSuggestionTargetType,
} from '../../types/settingSuggestion';
import type { WorldRuleSaveGuard } from '../../types/worldRules';

export const SUGGESTION_KEY = 'ai_novel_studio_setting_suggestions';
const targetKeys: Record<SettingSuggestionTargetType, string> = {
  character: 'ai_novel_studio_characters',
  world_setting: 'ai_novel_studio_world_settings',
  rule_system: 'ai_novel_studio_rule_systems',
};
const pending = new Map<string, Promise<unknown>>();

export async function withSuggestionLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(id) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return navigator.locks.request('setting-suggestion:' + id, action);
      }
      // Same-context fallback only; callers must not claim cross-tab/SQLite guarantees.
      return action();
    });
  pending.set(id, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(id) === operation) pending.delete(id);
  }
}

export function suggestionEnvelope(record: SettingSuggestionRecord): Record<string, unknown> {
  try {
    const value = JSON.parse(record.resultJson) as Record<string, unknown>;
    if (value?.format === 'setting-candidate-v1' || value?.format === 'setting-adoption-v1')
      return value;
  } catch {
    /* Historical raw output is preserved verbatim. */
  }
  return { format: 'setting-candidate-v1', originalResultJson: record.resultJson };
}

export async function suggestionCandidateHash(record: SettingSuggestionRecord): Promise<string> {
  return canonicalHash({
    id: record.id,
    novelId: record.novelId,
    suggestionType: record.suggestionType,
    item: suggestionEnvelope(record).originalItem ?? record.item,
    prompt: record.prompt,
    createdAt: record.createdAt,
  });
}

interface LocalReceipt extends WorldRuleSaveGuard {
  requestHash: string;
  targetId: string;
  targetType: SettingSuggestionTargetType;
  targetHash: string;
  target: Record<string, unknown>;
}

export async function adoptLocalSuggestion(input: {
  record: SettingSuggestionRecord;
  item: SettingSuggestionRecord['item'];
  edited: boolean;
  requestHash: string;
  candidateHash: string;
  targetType: SettingSuggestionTargetType;
  target: Record<string, unknown>;
  guard?: WorldRuleSaveGuard;
  onTargetWritten?: () => void;
  /** Called under the lock immediately before the synchronous journal/write/CAS section. */
  validate?: () => Promise<(() => void) | undefined>;
}): Promise<SettingSuggestionAdoptionResult> {
  const all = lsGet<SettingSuggestionRecord[]>(SUGGESTION_KEY) ?? [];
  const current = all.find((record) => record.id === input.record.id);
  if (
    !current ||
    current.novelId !== input.record.novelId ||
    (await suggestionCandidateHash(current)) !== input.candidateHash
  ) {
    throw new Error('SETTING_SUGGESTION_CAS_CONFLICT: 候选已变化');
  }
  const metadata = suggestionEnvelope(current);
  const receipt = metadata.receipt as LocalReceipt | undefined;
  if (current.status === 'discarded') throw new Error('SETTING_SUGGESTION_ALREADY_DECIDED');
  if (
    receipt &&
    (receipt.requestHash !== input.requestHash || receipt.targetType !== input.targetType)
  ) {
    throw new Error('SETTING_SUGGESTION_REPLAY_CONFLICT: 本次授权与首次决定不同');
  }
  if (current.status !== 'pending' && !receipt)
    throw new Error('SETTING_SUGGESTION_LEGACY_RECEIPT_MISSING');
  const target = receipt?.target ?? input.target;
  const targetId = String(target.id);
  const targetHash = await canonicalHash(target);
  if (receipt && receipt.targetHash !== targetHash)
    throw new Error('SETTING_SUGGESTION_TARGET_CHANGED');
  const targetKey = targetKeys[input.targetType];
  const existingTargets = lsGet<Record<string, unknown>[]>(targetKey) ?? [];
  const existing = existingTargets.find((row) => row.id === targetId);
  if (existing && stableCanonicalJson(existing) !== stableCanonicalJson(target))
    throw new Error('SETTING_SUGGESTION_TARGET_CHANGED');
  if (current.status !== 'pending') {
    if (
      !existing ||
      current.adoptedTargetId !== targetId ||
      current.adoptedTargetType !== input.targetType
    )
      throw new Error('SETTING_SUGGESTION_TARGET_CHANGED');
    return { record: current, targetId, targetType: input.targetType };
  }
  // A prepared receipt represents an already authorized operation. Replays only finish
  // that exact write, including the case where the target write succeeded before crash.
  const recheck = !receipt || !existing ? await input.validate?.() : undefined;
  const refreshed = lsGet<SettingSuggestionRecord[]>(SUGGESTION_KEY) ?? [];
  const index = refreshed.findIndex((record) => record.id === current.id);
  if (index < 0 || stableCanonicalJson(refreshed[index]) !== stableCanonicalJson(current))
    throw new Error('SETTING_SUGGESTION_CAS_CONFLICT');
  recheck?.();
  const journal: LocalReceipt = receipt ?? {
    ...input.guard,
    requestHash: input.requestHash,
    targetId,
    targetType: input.targetType,
    targetHash,
    target,
  };
  const prepared = {
    ...current,
    resultJson: JSON.stringify({
      ...metadata,
      format: 'setting-adoption-v1',
      originalItem: metadata.originalItem ?? current.item,
      receipt: journal,
    }),
  };
  // No asynchronous boundary below. Failure leaves the exact deterministic journal for
  // retry, not a new random target; the final decision is never written before the target.
  refreshed[index] = prepared;
  lsSet(SUGGESTION_KEY, refreshed);
  const targets = lsGet<Record<string, unknown>[]>(targetKey) ?? [];
  const live = targets.find((row) => row.id === targetId);
  if (live && stableCanonicalJson(live) !== stableCanonicalJson(target))
    throw new Error('SETTING_SUGGESTION_TARGET_CHANGED');
  if (!live) {
    lsSet(targetKey, [...targets, target]);
    input.onTargetWritten?.();
  }
  const updated: SettingSuggestionRecord = {
    ...prepared,
    item: input.item,
    status: input.edited ? 'edited_adopted' : 'adopted',
    adoptedTargetId: targetId,
    adoptedTargetType: input.targetType,
    updatedAt: String(target.updatedAt),
  };
  refreshed[index] = updated;
  lsSet(SUGGESTION_KEY, refreshed);
  return { record: updated, targetId, targetType: input.targetType };
}
