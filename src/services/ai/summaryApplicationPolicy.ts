import type { ChapterSummaryValidation } from '../../types/chapterSummary';

export function summaryIssueRequiresHumanReview(code: string): boolean {
  return code === 'SUMMARY_CERTAINTY_ESCALATION' || code === 'SUMMARY_EVIDENCE_FRAGMENT';
}

export type SummaryApplicationMode = 'context' | 'manual_review' | 'task_preauthorization';
export type SummaryPolicyStopReason =
  | 'SUMMARY_BLOCKING_VALIDATION_ERROR'
  | 'SUMMARY_HUMAN_REVIEW_REQUIRED'
  | 'SUMMARY_VALIDATION_INVALID'
  | 'SUMMARY_CONTEXT_UNSAFE';

export interface SummaryApplicationPolicy {
  eligible: boolean;
  blocking: boolean;
  humanReviewRequired: boolean;
  legacyManualReview: boolean;
  stopReason?: SummaryPolicyStopReason;
}

/** A historical native manual receipt used `passed=false` for unproved semantics. */
function isLegacyManualReview(validation: ChapterSummaryValidation): boolean {
  return (
    validation.policyVersion === undefined &&
    validation.passed === false &&
    validation.safeToContext === true &&
    validation.authorReviewed === true &&
    validation.semanticValidation === 'not_checked' &&
    ['passed', 'missing'].includes(validation.evidenceValidation ?? '') &&
    Array.isArray(validation.problems) &&
    validation.problems.every((problem) => problem?.type === 'speculation')
  );
}

/** Eligibility is independent of semantic proof, score and authority to perform a write. */
export function evaluateSummaryApplicationPolicy(
  validation: ChapterSummaryValidation | undefined,
  validationStatus?: string,
  mode: SummaryApplicationMode = 'context',
): SummaryApplicationPolicy {
  const result: SummaryApplicationPolicy = {
    eligible: false,
    blocking: false,
    humanReviewRequired: false,
    legacyManualReview: false,
  };
  const stop = (stopReason: SummaryPolicyStopReason, blocking = false) => ({
    ...result,
    blocking,
    stopReason,
  });
  // Existing manually entered summaries without a validation receipt remain readable.
  // This compatibility is not sufficient for a new preauthorized application.
  if (!validation || Object.keys(validation).length === 0) {
    if (mode === 'task_preauthorization') return stop('SUMMARY_VALIDATION_INVALID');
    return validationStatus === 'failed'
      ? stop('SUMMARY_BLOCKING_VALIDATION_ERROR', true)
      : { ...result, eligible: true };
  }
  if (
    typeof validation.passed !== 'boolean' ||
    typeof validation.safeToContext !== 'boolean' ||
    !Array.isArray(validation.problems) ||
    (validation.policyVersion !== undefined && validation.policyVersion !== 1) ||
    (validation.blockingIssues !== undefined && !Array.isArray(validation.blockingIssues)) ||
    (validation.groundingIssues !== undefined &&
      (!Array.isArray(validation.groundingIssues) ||
        validation.groundingIssues.some(
          (issue) => !issue || !['warning', 'error'].includes(issue.severity),
        ))) ||
    (validation.authorReviewed !== undefined && typeof validation.authorReviewed !== 'boolean') ||
    (validation.semanticValidation !== undefined &&
      validation.semanticValidation !== 'not_checked') ||
    (validation.reviewRequirement !== undefined &&
      !['none', 'human_required'].includes(validation.reviewRequirement)) ||
    (validation.applicationProvenance !== undefined &&
      (!validation.applicationProvenance ||
        !['manual_review', 'task_preauthorization'].includes(
          validation.applicationProvenance.mode,
        )))
  )
    return stop('SUMMARY_VALIDATION_INVALID');
  result.legacyManualReview = isLegacyManualReview(validation);
  const blocking =
    validationStatus === 'failed' ||
    (validation.blockingIssues?.length ?? 0) > 0 ||
    validation.groundingIssues?.some((issue) => issue.severity === 'error') ||
    (!result.legacyManualReview &&
      (validation.problems.length > 0 || !validation.passed || validationStatus === 'failed'));
  if (blocking) return stop('SUMMARY_BLOCKING_VALIDATION_ERROR', true);
  if (
    validation.applicationProvenance?.mode === 'task_preauthorization' &&
    (validation.authorReviewed ||
      typeof validation.applicationProvenance.authorizationId !== 'string' ||
      !validation.applicationProvenance.authorizationId.trim())
  )
    return stop('SUMMARY_VALIDATION_INVALID');
  result.humanReviewRequired = validation.reviewRequirement === 'human_required';
  if (
    (mode === 'task_preauthorization' && result.legacyManualReview) ||
    (result.humanReviewRequired && (mode === 'task_preauthorization' || !validation.authorReviewed))
  )
    return stop('SUMMARY_HUMAN_REVIEW_REQUIRED');
  if (mode === 'task_preauthorization' && validation.policyVersion !== 1)
    return stop('SUMMARY_VALIDATION_INVALID');
  if (!validation.safeToContext) return stop('SUMMARY_CONTEXT_UNSAFE');
  return { ...result, eligible: true };
}

export function assertSummaryContextEligible(
  validation: ChapterSummaryValidation | undefined,
  validationStatus?: string,
): void {
  const policy = evaluateSummaryApplicationPolicy(validation, validationStatus);
  if (!policy.eligible) throw new Error(policy.stopReason);
}
