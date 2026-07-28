import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { DraftContentState } from '../../../types/draftContentState';
import type { AiTextApplyRequest, EditorContentSnapshot } from '../../../types/workspaceSafety';

export type EditorDocumentState = 'ready' | 'loading' | 'error';

export type EditorDraftContentResolution =
  | { action: 'preserve'; reason?: string }
  | { action: 'replace'; content: string; draft?: ChapterDraft | null };

export type EditorCommandType = 'save' | 'format' | 'adopt-current';

export interface EditorCommandRequest {
  id: string;
  type: EditorCommandType;
}

export interface EditorLocateTarget {
  startOffset: number;
  endOffset: number;
  quote?: string;
  paragraphIndex?: number;
}

export interface EditorAreaProps {
  chapter?: Chapter;
  novelTitle?: string;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
  documentState?: EditorDocumentState;
  contentStateOverride?: DraftContentState;
  onDraftChange?: (wordCount: number, isDirty: boolean) => void;
  onEditorContentChange?: (snapshot: EditorContentSnapshot) => void;
  onDraftSaved?: (draft: ChapterDraft) => void | Promise<void>;
  applyTextRequest?: AiTextApplyRequest | null;
  onApplyTextConsumed?: (request: AiTextApplyRequest) => void;
  onApplyTextRejected?: (request: AiTextApplyRequest, reason: string) => void;
  commandRequest?: EditorCommandRequest | null;
  onChapterUpdated?: (chapterId: string) => void;
  /** 定位目标：设置后自动在正文中搜索并高亮指定文本 */
  locateTarget?: EditorLocateTarget | null;
  onLocateDone?: (result?: { found: boolean; message?: string }) => void;
  onRetryContent?: () => void;
  retryingContent?: boolean;
  onOpenDraftHistory?: () => void;
  onBackToChapters?: () => void;
}

export interface EditorAreaHandle {
  save: () => Promise<ChapterDraft | null>;
  restoreRecovery: (content: string, selectionStart?: number, selectionEnd?: number) => boolean;
}
