import type {
  ChapterConstraintValidationInput,
  ConstraintValidationResult,
  PersistedConstraintValidationInput,
} from '../../types/chapterConstraintValidation';
import { dbCall, lsGet, lsSet } from '../database/db';
import { validateChapterArtifactConstraints } from './chapterConstraintValidator';

function storageKey(artifactId: string): string {
  return `ai_novel_studio_chapter_constraint_validation_${artifactId}`;
}

function persistedInput(result: ConstraintValidationResult): PersistedConstraintValidationInput {
  return {
    artifactId: result.artifactId,
    taskId: result.taskId,
    novelId: result.novelId,
    chapterId: result.chapterId,
    sourceDraftId: result.sourceDraftId,
    sourceDraftVersion: result.sourceDraftVersion,
    baseContentHash: result.baseContentHash,
    validationRunId: result.validationRunId,
    validatorVersion: result.validatorVersion,
    items: [...result.must, ...result.should, ...result.forbid],
  };
}

export const chapterConstraintValidationService = {
  async validateAndPersist(input: ChapterConstraintValidationInput): Promise<ConstraintValidationResult> {
    const result = validateChapterArtifactConstraints(input);
    await dbCall<ConstraintValidationResult>(
      'record_chapter_constraint_validation',
      { input: persistedInput(result) },
      () => {
        const existing = lsGet<ConstraintValidationResult[]>(storageKey(result.artifactId)) || [];
        lsSet(storageKey(result.artifactId), [...existing, result]);
        return result;
      },
    );
    return result;
  },

  async getLatest(artifactId: string): Promise<ConstraintValidationResult | null> {
    return dbCall<ConstraintValidationResult | null>(
      'get_latest_chapter_constraint_validation',
      { artifactId },
      () => {
        const runs = lsGet<ConstraintValidationResult[]>(storageKey(artifactId)) || [];
        return runs[runs.length - 1] || null;
      },
    );
  },
};
