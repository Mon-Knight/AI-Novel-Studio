export interface WorkspaceRecoveryTarget {
  novelId: string;
  chapterId: string;
}

export interface WorkspaceRecoverySnapshot extends WorkspaceRecoveryTarget {
  baseDraftId?: string;
  baseDraftVersion?: number;
  baseContentHash?: string;
  recoveryContent: string;
  recoveryContentHash: string;
  selectionStart?: number;
  selectionEnd?: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkspaceRecoveryInput extends WorkspaceRecoveryTarget {
  traceId: string;
  baseDraftId?: string;
  baseDraftVersion?: number;
  baseContentHash?: string;
  recoveryContent: string;
  recoveryContentHash: string;
  selectionStart?: number;
  selectionEnd?: number;
}

export type RecoveryPromptState =
  | { status: 'none' }
  | { status: 'loading' }
  | {
      status: 'available';
      snapshot: WorkspaceRecoverySnapshot;
      conflict: false;
    }
  | {
      status: 'conflict';
      snapshot: WorkspaceRecoverySnapshot;
      conflict: true;
      errorCode: 'RECOVERY_BASE_CONFLICT';
    };

export type WorkspaceRecoverySaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';
