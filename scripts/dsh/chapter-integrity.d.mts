import type {
  ChapterCandidateIntegrityIssue,
  InspectChapterCandidateIntegrityInput,
} from '../../src/services/generation/chapterCandidateIntegrityReview';
export declare function inspectChapterCandidateIntegrity(
  input: InspectChapterCandidateIntegrityInput,
): ChapterCandidateIntegrityIssue[];
