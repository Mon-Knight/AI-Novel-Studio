import type { DraftContentState } from './draftContentState';

export interface EditorContentSnapshot {
  chapterId?: string;
  draftId?: string;
  draftVersion?: number;
  content: string;
  wordCount: number;
  isDirty: boolean;
  contentHash: string;
  contentAvailable: boolean;
  persistedContentHash?: string;
  contentState?: DraftContentState;
  selectionStart?: number;
  selectionEnd?: number;
}

export interface AiTaskModalState {
  running: boolean;
  title: string;
  subtitle?: string;
  stage: string;
  progress: number;
}

export type AiTextApplyMode = 'replace_all' | 'append';

export type AiTextApplySource =
  'ai_generate' | 'quality_check' | 'polish' | 'layout' | 'multi_agent';

/** Immutable target captured when an AI/editor result starts. */
export interface WorkspaceResultTarget {
  resultId: string;
  novelId: string;
  chapterId: string;
  sourceDraftId?: string;
  sourceRevision?: number;
  baseContentHash: string;
}

export interface DraftResultMetadata extends WorkspaceResultTarget {
  source: AiTextApplySource | 'chapter_engineering';
}

export interface AiTextApplyPayload extends WorkspaceResultTarget {
  mode: AiTextApplyMode;
  text: string;
  source: AiTextApplySource;
}

export interface AiTextApplyRequest extends AiTextApplyPayload {
  id: string;
}
