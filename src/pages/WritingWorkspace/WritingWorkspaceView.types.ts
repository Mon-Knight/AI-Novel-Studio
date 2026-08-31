import type { MouseEvent, MutableRefObject, ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type {
  EditorAreaHandle,
  EditorContentSnapshot,
} from '../../components/workspace/EditorArea';
import type { useWorkspaceChapterLoader } from '../../features/workspace/useWorkspaceChapterLoader';
import type { useWorkspaceCreationActions } from '../../features/workspace/useWorkspaceCreationActions';
import type { useWorkspaceDraftApplication } from '../../features/workspace/useWorkspaceDraftApplication';
import type { useWorkspaceRecoveryActions } from '../../features/workspace/useWorkspaceRecoveryActions';
import type { useWorkspaceSummary } from '../../features/workspace/useWorkspaceSummary';
import type { PanelToolState, RightSidebarState } from '../../store/rightSidebarStore';
import type { WorkspaceSessionState } from '../../store/workspaceSessionStore';
import type { ReviewCandidateDocument } from '../../types/conversation';
import type { QualityCheckItem, QualityCheckReport } from '../../types/qualityCheck';
import type { PanelType } from '../../types/rightSidebar';
import type {
  RecoveryPromptState,
  WorkspaceRecoverySaveStatus,
} from '../../types/workspaceRecovery';
import type { WritingContext } from '../../utils/writingContext';

type ChapterLoader = ReturnType<typeof useWorkspaceChapterLoader>;
type DraftApplication = ReturnType<typeof useWorkspaceDraftApplication>;
type CreationActions = ReturnType<typeof useWorkspaceCreationActions>;
type RecoveryActions = ReturnType<typeof useWorkspaceRecoveryActions>;
type WorkspaceSummary = ReturnType<typeof useWorkspaceSummary>;
type ViewSession = Pick<
  WorkspaceSessionState,
  | 'novel'
  | 'volumes'
  | 'chapters'
  | 'activeChapterId'
  | 'currentDraft'
  | 'editorSnapshot'
  | 'draftWordCount'
  | 'isDirty'
  | 'qcReport'
  | 'qcItems'
  | 'aiModal'
>;

interface WorkspaceViewRefs {
  editor: MutableRefObject<EditorAreaHandle | null>;
  activeChapterId: MutableRefObject<string>;
  editorSnapshot: MutableRefObject<EditorContentSnapshot>;
}

interface WorkspaceViewActions {
  selectChapter(chapterId: string): Promise<void>;
  togglePanel(panel: PanelType): Promise<void>;
  closePanel(): Promise<void>;
  editorClick(event: MouseEvent<HTMLDivElement>): void;
  editorContentChange(snapshot: EditorContentSnapshot): void;
  chapterOutlineApplied(chapterId: string): Promise<void>;
  confirmEditorLeave(): Promise<boolean>;
  openSidebarTool(panel: Exclude<PanelType, null>): void;
  closeSidebar(): void;
  setChapterGoalDirty(dirty: boolean): void;
  bumpContextVersion(): void;
  locateText(start: number, end: number, quote?: string, paragraphIndex?: number): void;
  locateDone(): void;
  setQuality(report: QualityCheckReport | null, items: QualityCheckItem[]): void;
  showAiModal(title: string, subtitle?: string): void;
  updateAiModal(stage: string, progress: number): void;
  hideAiModal(): void;
  updateSidebarTool(toolKey: string, patch: Partial<PanelToolState>): void;
  dismissRecoveryPrompt(): void;
}

export interface WritingWorkspaceViewProps {
  novelId?: string;
  navigate: NavigateFunction;
  session: ViewSession;
  sidebarState: RightSidebarState;
  chapterLoader: ChapterLoader;
  draftApplication: DraftApplication;
  creationActions: CreationActions;
  recoveryActions: RecoveryActions;
  summary: WorkspaceSummary;
  recoveryPrompt: RecoveryPromptState;
  recoverySaveStatus: WorkspaceRecoverySaveStatus;
  refs: WorkspaceViewRefs;
  actions: WorkspaceViewActions;
  contextVersion: number;
  locateTarget: {
    startOffset: number;
    endOffset: number;
    quote?: string;
    paragraphIndex?: number;
  } | null;
  writingContext: WritingContext;
  leaveGuardDialog: ReactNode;
  reviewLocked?: boolean;
  onUnlockReview?: () => void;
  reviewCandidate?: ReviewCandidateDocument | null;
  reviewAuthorizationId?: string;
  reviewArtifactId?: string;
  onBeforeAdopt?: (draftId: string) => Promise<void>;
}
