import type { ReviewCandidateDocument } from '../../types/conversation';

const CHAPTER_RECONSENT_CODES = new Set([
  'REVIEW_AUTHORIZATION_BASELINE_REQUIRED',
  'REVIEW_AUTHORIZATION_BASE_CONFLICT',
  'REVIEW_AUTHORIZATION_EXPIRED',
]);

/** Only native preview may decide renewability; rule/quality/scope failures are not chapter reconsent. */
export function canPreviewReviewAuthorizationRenewal(
  code: string,
  candidate?: ReviewCandidateDocument | null,
): boolean {
  return Boolean(
    candidate?.authorizationId && candidate.artifactId && CHAPTER_RECONSENT_CODES.has(code),
  );
}
