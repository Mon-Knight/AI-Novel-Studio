import type { ChapterGenerationConstraint, ChapterGenerationConstraintKind } from './chapterGenerationCompilation';

export type ConstraintValidationStatus = 'passed' | 'passed_with_warnings' | 'blocked';
export type ConstraintItemStatus = 'passed' | 'failed' | 'unknown';

export interface ConstraintValidationItem {
  constraintId: string;
  severity: ChapterGenerationConstraintKind;
  code: string;
  status: ConstraintItemStatus;
  message: string;
  evidenceSummary?: string;
}

export interface ConstraintValidationResult {
  artifactId: string;
  taskId: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  baseContentHash: string;
  validationRunId: string;
  status: ConstraintValidationStatus;
  must: ConstraintValidationItem[];
  should: ConstraintValidationItem[];
  forbid: ConstraintValidationItem[];
  blockingCount: number;
  warningCount: number;
  validatorVersion: string;
  validatedAt: string;
}

export interface ChapterConstraintValidationInput {
  artifactId: string;
  taskId: string;
  novelId: string;
  volumeId?: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  baseContentHash: string;
  inputSnapshot: {
    sourceDraftId?: string;
    sourceDraftVersion?: number;
    baseContentHash?: string;
  };
  contextSnapshot: {
    sourceManifestJson: unknown;
  };
  constraintSnapshot: {
    payloadJson: unknown;
  };
  artifactBody: string;
  validationRunId?: string;
  validatedAt?: string;
}

export interface PersistedConstraintValidationInput {
  artifactId: string;
  taskId: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  baseContentHash: string;
  validationRunId: string;
  validatorVersion: string;
  items: ConstraintValidationItem[];
}

export type FrozenChapterConstraint = Pick<ChapterGenerationConstraint, 'id' | 'kind' | 'text'>;
