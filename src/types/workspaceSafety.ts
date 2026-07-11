export type AiTextApplyMode = 'replace_all' | 'append';

export type AiTextApplySource = 'ai_generate' | 'quality_check' | 'polish' | 'layout';

/** Immutable target captured when an AI/editor result starts. */
export interface WorkspaceResultTarget {
  resultId: string;
  novelId: string;
  chapterId: string;
  sourceDraftId?: string;
  sourceRevision?: number;
  baseContentHash: string;
  draftVersion?: number;
  contentHash?: string;
  taskId?: string;
  artifactId?: string;
}

export interface DraftResultMetadata extends WorkspaceResultTarget {
  source: AiTextApplySource | 'chapter_engineering';
}

export interface ChapterCandidateTarget {
  resultId: string;
  novelId: string;
  chapterId: string;
  volumeId?: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  baseContentHash?: string;
  artifactId?: string;
  createdAt: string;
}

export interface AiTextApplyPayload extends WorkspaceResultTarget {
  mode: AiTextApplyMode;
  text: string;
  source: AiTextApplySource;
}

export interface AiTextApplyRequest extends AiTextApplyPayload {
  id: string;
}
