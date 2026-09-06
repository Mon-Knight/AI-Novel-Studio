/** Local review feedback only; never part of an artifact application payload. */
export interface ArtifactCandidateReviewDraft {
  originalTitle: string;
  suggestedTitle: string;
  suggestedSummary: string;
  notes: string;
}
