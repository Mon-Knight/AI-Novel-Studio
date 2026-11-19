/** One pure implementation shared by browser previews and native candidate admission. */
export { inspectChapterCandidateIntegrity } from '../../../scripts/dsh/chapter-integrity.mjs';

export {
  CHAPTER_CANDIDATE_INTEGRITY_ISSUE_CODES,
  buildChapterCandidateIntegrityReview,
  formatChapterCandidateIntegrityReview,
  type ChapterCandidateIntegrityIssue,
  type ChapterCandidateIntegrityIssueCode,
  type ChapterCandidateIntegrityReview,
  type InspectChapterCandidateIntegrityInput,
} from './chapterCandidateIntegrityReview';
