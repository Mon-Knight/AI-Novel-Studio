export type ArtifactProcessingStatus =
  | 'raw'
  | 'parsing'
  | 'valid'
  | 'valid_with_warnings'
  | 'invalid';

export type ResultArtifactType =
  | 'generic_text'
  | 'generic_json'
  | 'chapter_text'
  | 'quality_report'
  | 'character_candidates'
  | 'event_candidates'
  | 'setting_candidates'
  | 'style_analysis'
  | 'chapter_summary'
  | 'volume_summary'
  | 'outline'
  | 'tool_result'
  | 'plan';

export interface ResultArtifact {
  artifactId: string;
  taskId: string;
  attemptId: string;
  sourceInputSnapshotId: string;
  artifactType: ResultArtifactType;
  schemaVersion: number;
  rawContentRefId: string;
  displayContentRefId?: string;
  displayContentHash?: string;
  structuredPayloadRefId?: string;
  structuredPayloadHash?: string;
  sourceNovelId: string;
  sourceChapterId?: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  sourceBaseContentHash?: string;
  contentHash: string;
  contentLength: number;
  processingStatus: ArtifactProcessingStatus;
  parentArtifactId?: string;
  derivationType?: string;
  createdAt: string;
}

export interface ArtifactValidationIssue {
  issueId: string;
  artifactId: string;
  validationRunId: string;
  issueIndex: number;
  severity: 'warning' | 'error';
  code: string;
  message: string;
  jsonPath?: string;
  detailsJson?: Record<string, unknown>;
  validatorVersion: string;
  createdAt: string;
}

export interface ResultArtifactBundle {
  artifact: ResultArtifact;
  rawContent: string;
  displayContent?: string;
  structuredPayloadJson?: unknown;
  issues: ArtifactValidationIssue[];
}

export interface CreateResultArtifactInput {
  taskId: string;
  attemptId: string;
  artifactType: ResultArtifactType;
  schemaVersion: number;
  rawContent: string;
  displayContent?: string;
  structuredPayloadJson?: unknown;
  parentArtifactId?: string;
  derivationType?: string;
}
