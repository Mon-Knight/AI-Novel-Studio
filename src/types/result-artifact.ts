export type ResultArtifactType =
  | 'chapter_text'
  | 'outline'
  | 'character_candidates'
  | 'event_candidates'
  | 'setting_candidates'
  | 'style_analysis'
  | 'quality_report'
  | 'chapter_summary'
  | 'volume_summary'
  | 'generic_text'
  | 'generic_json';

export type ArtifactProcessingStatus = 'raw' | 'parsing' | 'valid' | 'valid_with_warnings' | 'invalid';

export interface ArtifactValidationIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  jsonPath?: string;
}

export interface ResultArtifact {
  artifactId: string;
  taskId: string;
  attemptId: string;
  artifactType: ResultArtifactType;
  schemaVersion: number;
  rawContentRefId: string;
  displayContentRefId?: string;
  contentHash: string;
  contentLength: number;
  processingStatus: ArtifactProcessingStatus;
  issues: ArtifactValidationIssue[];
  createdAt: string;
}
