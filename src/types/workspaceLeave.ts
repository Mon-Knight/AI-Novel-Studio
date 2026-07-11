export type WorkspaceLeaveReason =
  | 'chapter_switch'
  | 'chapter_create'
  | 'chapter_delete'
  | 'novel_switch'
  | 'route_change'
  | 'history_navigation'
  | 'window_close'
  | 'app_exit'
  | 'draft_restore'
  | 'draft_adopt';

export type LeaveDecision = 'proceed' | 'cancel' | 'save_failed';

export interface WorkspaceLeaveRequest {
  reason: WorkspaceLeaveReason;
  targetNovelId?: string;
  targetChapterId?: string;
  continueAction?: () => void | Promise<void>;
}

export interface PendingWorkspaceLeave extends WorkspaceLeaveRequest {
  id: string;
}
