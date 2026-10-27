import type { WorldRuleChangeIntent } from '../../types/worldRules';
import { parseWorldRuleDocument } from './worldRuleSchema';

/** Mirrors native validate_metadata; caller must still verify the preview-bound guard. */
export function validateWorldRuleMutation(
  next: string | undefined,
  previous: string | undefined,
  intent?: WorldRuleChangeIntent,
): void {
  if (next === undefined) return;
  const parsed = parseWorldRuleDocument(next);
  if (parsed.status !== 'valid') {
    if (next === previous) return;
    throw new Error('WORLD_RULE_SCHEMA_INVALID: 未识别的旧材料只能原样保留，不能冒充新结构规则');
  }
  const value = parsed.document;
  if (intent !== undefined && !['confirm_change', 'retcon', 'approve_exception'].includes(intent))
    throw new Error('RULE_CHANGE_CONFIRMATION_REQUIRED: 请先预览影响并明确确认本次变更');
  if (value.authority === 'confirmed' && !intent)
    throw new Error('RULE_CHANGE_CONFIRMATION_REQUIRED: 请先预览影响并明确确认本次变更');
  const prior = parseWorldRuleDocument(previous);
  if (
    prior.status === 'valid' &&
    next !== previous &&
    (value.identity.id !== prior.document.identity.id ||
      value.identity.revision !== prior.document.identity.revision + 1 ||
      value.identity.supersedesRevision !== prior.document.identity.revision)
  )
    throw new Error('WORLD_RULE_REVISION_CONFLICT');
  for (const exception of value.exceptions) {
    if (exception.approval !== 'author_approved') continue;
    const alreadyApproved =
      prior.status === 'valid' &&
      prior.document.exceptions.some((old) => JSON.stringify(old) === JSON.stringify(exception));
    if (
      !alreadyApproved &&
      (intent !== 'approve_exception' ||
        !exception.condition.trim() ||
        !exception.effect.trim() ||
        !exception.reason.trim())
    )
      throw new Error('RULE_EXCEPTION_CONFIRMATION_REQUIRED');
  }
}
