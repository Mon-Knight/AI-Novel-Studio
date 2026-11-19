import type { ReviewAuthorization } from './conversation';

/** Explicit manual re-consent, never task-level automatic application permission. */
export interface ReviewAuthorizationSavedDraft {
  draftId: string;
  draftVersion: number;
  contentHash: string;
}
export interface ReviewAuthorizationRenewalPreview {
  authorizationId: string;
  cardId: string;
  conversationId: string;
  novelId: string;
  chapterId: string;
  artifactId: string;
  artifactHash: string;
  chapterBaselineHash: string;
  chapterRevision: string;
  adoptedDraftId?: string;
  adoptedContentHash?: string;
  savedDraft?: ReviewAuthorizationSavedDraft;
  previewHash: string;
}
export interface PreviewReviewAuthorizationRenewalInput {
  authorizationId: string;
  savedDraftId?: string;
}
export interface RenewReviewAuthorizationInput extends PreviewReviewAuthorizationRenewalInput {
  operationId: string;
  expectedPreviewHash: string;
}
export interface GetReviewAuthorizationRenewalInput {
  authorizationId: string;
  operationId: string;
}
export interface ReviewAuthorizationResume {
  requestedAuthorizationId: string;
  authorization: ReviewAuthorization;
  /** Current native-verified fingerprint of the same bound saved draft. */
  reviewDraftBinding?: ReviewAuthorizationSavedDraft & { changedSinceRenewal: boolean };
}

export type PreviewReviewRenewalInput = PreviewReviewAuthorizationRenewalInput;
export type RenewReviewInput = RenewReviewAuthorizationInput;
export type ReviewRenewalPreview = ReviewAuthorizationRenewalPreview;
