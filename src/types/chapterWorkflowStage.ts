/**
 * Read-only projection returned by `list_chapter_workflow_stages`.
 *
 * These are candidate execution facts, not adopted prose and not apply authority.
 * Large results live in a dedicated large-text document; read it through the
 * existing large-text IPC by `resultDocumentId`.
 */
export type ChapterWorkflowStageKind =
  'scene_plan' | 'beat_plan' | 'beat_write' | 'beat_state' | 'scene_close' | 'chapter_assemble';

export type ChapterWorkflowStageStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ChapterWorkflowStageView {
  stageId: string;
  workflowId: string;
  conversationId: string;
  novelId: string;
  chapterId: string;
  runId: string;
  stageKey: string;
  stageKind: ChapterWorkflowStageKind;
  sceneId?: string;
  beatId?: string;
  planVersion: number;
  modelSnapshotHash: string;
  contextHash: string;
  baseHash: string;
  inputHash: string;
  planHash: string;
  status: ChapterWorkflowStageStatus;
  attempt: number;
  revision: number;
  resultHash?: string;
  resultDocumentId?: string;
  /** Bounded inline JSON only; large results are never returned here. */
  resultJson?: string;
  verifiedArtifactId?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListChapterWorkflowStagesInput {
  novelId: string;
  chapterId: string;
  conversationId?: string;
  workflowId?: string;
  runId?: string;
  stageKey?: string;
  stageKinds?: ChapterWorkflowStageKind[];
  statuses?: ChapterWorkflowStageStatus[];
  limit?: number;
}
