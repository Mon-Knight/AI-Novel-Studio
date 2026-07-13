export type NormalizedCandidateMode = 'targeted_fix' | 'full_rewrite';

export type NormalizedCandidateStatus = 'ready' | 'format_error' | 'rebuild_error';

export interface NormalizedCandidateChange {
  id: string;
  originalText: string;
  revisedText: string;
  summary?: string;
  /** Internal-only source position. Never render these values in the ordinary review UI. */
  paragraphIndex?: number;
  /** Internal-only source position. Never render these values in the ordinary review UI. */
  startOffset?: number;
  /** Internal-only source position. Never render these values in the ordinary review UI. */
  endOffset?: number;
  /** Internal-only candidate paragraph used by the review surface for scrolling/highlighting. */
  candidateParagraphIndex?: number;
}

export interface NormalizedCandidate {
  mode: NormalizedCandidateMode;
  status: NormalizedCandidateStatus;
  fullText: string;
  revisionSummary?: string;
  changes: NormalizedCandidateChange[];
  rawResponse: string;
  error?: string;
  rebuiltFrom: 'structured_full_text' | 'changed_ranges' | 'plain_text' | 'unavailable';
}

export interface NormalizeCandidateInput {
  content?: string;
  rawResponse?: string;
  structuredPayload?: unknown;
  baseContent?: string;
}
