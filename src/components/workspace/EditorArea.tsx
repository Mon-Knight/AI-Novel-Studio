import { forwardRef, useImperativeHandle } from 'react';
import EditorAreaView from './editor-area/EditorAreaView';
import type { EditorAreaHandle, EditorAreaProps } from './editor-area/editorAreaTypes';
import { useChapterOutlineEditor } from './editor-area/useChapterOutlineEditor';
import { useEditorDocumentController } from './editor-area/useEditorDocumentController';
import { useEditorLocateTarget } from './editor-area/useEditorLocateTarget';

export type { EditorContentSnapshot } from '../../types/workspaceSafety';
export type {
  AiTextApplyMode,
  AiTextApplyPayload,
  AiTextApplyRequest,
} from '../../types/workspaceSafety';
export type {
  EditorAreaHandle,
  EditorCommandRequest,
  EditorCommandType,
  EditorDocumentState,
  EditorDraftContentResolution,
} from './editor-area/editorAreaTypes';
// eslint-disable-next-line react-refresh/only-export-components
export { isDraftSaveResultForDocument } from './editor-area/editorDocumentSafety';
// eslint-disable-next-line react-refresh/only-export-components
export { resolveEditorDraftContent } from './editor-area/editorDocumentSafety';

const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(function EditorArea(props, ref) {
  const documentState = props.documentState ?? 'ready';
  const document = useEditorDocumentController({
    chapter: props.chapter,
    novelId: props.novelId,
    currentDraft: props.currentDraft,
    documentState,
    contentStateOverride: props.contentStateOverride,
    onDraftChange: props.onDraftChange,
    onEditorContentChange: props.onEditorContentChange,
    onDraftSaved: props.onDraftSaved,
    applyTextRequest: props.applyTextRequest,
    onApplyTextConsumed: props.onApplyTextConsumed,
    onApplyTextRejected: props.onApplyTextRejected,
    commandRequest: props.commandRequest,
    onChapterUpdated: props.onChapterUpdated,
    onBeforeAdopt: props.onBeforeAdopt,
  });
  const outline = useChapterOutlineEditor({
    chapter: props.chapter,
    novelId: props.novelId,
    currentDraft: props.currentDraft,
    documentState,
    effectiveContentState: document.effectiveContentState,
    onChapterUpdated: props.onChapterUpdated,
  });

  useEditorLocateTarget({
    textareaRef: document.textareaRef,
    locateTarget: props.locateTarget,
    onLocateDone: props.onLocateDone,
  });
  useImperativeHandle(
    ref,
    () => ({
      save: document.handleSave,
      restoreRecovery: document.restoreRecovery,
    }),
    [document.handleSave, document.restoreRecovery],
  );

  return (
    <EditorAreaView
      chapter={props.chapter}
      currentDraft={props.currentDraft}
      documentState={documentState}
      document={document}
      outline={outline}
      onRetryContent={props.onRetryContent}
      retryingContent={props.retryingContent}
      onOpenDraftHistory={props.onOpenDraftHistory}
      onBackToChapters={props.onBackToChapters}
      reviewLocked={props.reviewLocked}
      onUnlockReview={props.onUnlockReview}
    />
  );
});

export default EditorArea;
