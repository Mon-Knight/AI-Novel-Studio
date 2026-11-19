import { useCallback, useRef, type MutableRefObject } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { ReviewCandidateDocument } from '../../../types/conversation';
import type { DraftContentState } from '../../../types/draftContentState';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { logWorkspaceWarning } from '../../../services/workspace/workspaceErrorService';
import { getAppErrorUserMessage, normalizeAppError } from '../../../types/appError';
import { formatDateTime } from '../../../utils/date';
import { isDraftSaveResultForDocument } from './editorDocumentSafety';
import type {
  DocumentAdoptState,
  DocumentSaveState,
  EditorAreaProps,
  EditorDocumentState,
} from './editorAreaTypes';

interface Options {
  chapter?: Chapter;
  novelId?: string;
  documentState: EditorDocumentState;
  reviewLocked: boolean;
  canAdoptReadOnlyCandidate: boolean;
  scope: MutableRefObject<{ epoch: number }>;
  isCurrent: (epoch: number) => boolean;
  adoptInFlightRef: MutableRefObject<number | null>;
  saveInFlightRef: MutableRefObject<{
    epoch: number;
    promise: Promise<ChapterDraft | null>;
  } | null>;
  effectiveContentState?: DraftContentState;
  currentDraft?: ChapterDraft | null;
  content: string;
  isDirty: boolean;
  reviewCandidate?: ReviewCandidateDocument | null;
  liveDocumentRef: MutableRefObject<{ novelId?: string; chapterId?: string }>;
  liveDraftIdRef: MutableRefObject<string | undefined>;
  liveContentRef: MutableRefObject<string>;
  onActionStateChange?: EditorAreaProps['onActionStateChange'];
  onDraftSaved?: EditorAreaProps['onDraftSaved'];
  emitContentSnapshot: (content: string, dirty: boolean, draft?: ChapterDraft | null) => void;
  setFeedbackEpoch: (epoch: number) => void;
  setSaveFailure: (value: string) => void;
  setSaveState: (value: DocumentSaveState) => void;
  setSaveMsg: (value: string) => void;
  setSaving: (value: boolean) => void;
  setIsDirty: (value: boolean) => void;
  setLastSaved: (value: string) => void;
  adoptState: DocumentAdoptState;
  adoptMsg: string;
}

/** Existing draft persistence, isolated from authorization renewal and formal adoption. */
export function useEditorDraftPersistence(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const performSave = useCallback(async (forAdoption = false): Promise<ChapterDraft | null> => {
    const {
      chapter,
      novelId,
      documentState,
      reviewLocked,
      canAdoptReadOnlyCandidate,
      scope,
      isCurrent,
      adoptInFlightRef,
      effectiveContentState,
      currentDraft,
      content,
      isDirty,
      reviewCandidate,
      liveDocumentRef,
      liveDraftIdRef,
      liveContentRef,
      onActionStateChange,
      onDraftSaved,
      emitContentSnapshot,
      setFeedbackEpoch,
      setSaveFailure,
      setSaveState,
      setSaveMsg,
      setSaving,
      setIsDirty,
      setLastSaved,
      adoptState,
      adoptMsg,
    } = latest.current;
    const requestEpoch = scope.current.epoch;
    if (
      !chapter ||
      !novelId ||
      documentState !== 'ready' ||
      (reviewLocked && !(forAdoption && canAdoptReadOnlyCandidate)) ||
      (!forAdoption && adoptInFlightRef.current === requestEpoch)
    )
      return null;
    setFeedbackEpoch(requestEpoch);
    if (effectiveContentState?.status === 'unavailable') {
      setSaveFailure('正文不可用，已阻止保存');
      setSaveState('error');
      return null;
    }
    setSaveFailure('');
    if (currentDraft && !isDirty && currentDraft.content === content) {
      setSaveMsg(currentDraft.isAdopted ? '当前正文已采用，无需保存' : '没有未保存修改');
      setSaveState('saved');
      return currentDraft;
    }
    setSaving(true);
    setSaveState('saving');
    setSaveMsg('保存中');
    onActionStateChange?.({
      saving: true,
      adopting: forAdoption,
      saveState: 'saving',
      saveMessage: '保存中',
      chapterId: chapter.id,
      adoptState: forAdoption ? 'confirming' : adoptState,
      adoptMessage: forAdoption ? '正在保存待采用的草稿' : adoptMsg,
    });
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    const requestDraftId = currentDraft?.id;
    const requestContent = content;
    try {
      const savedDraft =
        currentDraft && !currentDraft.isAdopted
          ? await draftVersionService.update(
              currentDraft.id,
              requestChapterId,
              requestContent,
              'user_edited',
              undefined,
              currentDraft,
            )
          : await draftVersionService.create({
              novelId: requestNovelId,
              chapterId: requestChapterId,
              content: requestContent,
              source: reviewCandidate?.content === requestContent ? 'ai_generated' : 'user_edited',
            });
      if (!isDraftSaveResultForDocument(savedDraft, requestNovelId, requestChapterId)) {
        throw new Error('草稿保存结果与当前章节不一致');
      }
      const liveDocument = liveDocumentRef.current;
      if (
        !isCurrent(requestEpoch) ||
        liveDocument.novelId !== requestNovelId ||
        liveDocument.chapterId !== requestChapterId ||
        liveDraftIdRef.current !== requestDraftId
      ) {
        return null;
      }
      if (liveContentRef.current !== requestContent) {
        setSaveMsg('正文已变化，请再次保存');
        setSaveState('editing');
        return null;
      }
      setIsDirty(false);
      setSaveMsg('已保存');
      setSaveState('saved');
      setLastSaved(formatDateTime(new Date()));
      try {
        await onDraftSaved?.(savedDraft);
      } catch (error) {
        logWorkspaceWarning('post_save_callback_failed', {
          novelId: requestNovelId,
          chapterId: requestChapterId,
          draftId: savedDraft.id,
          errorCode:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : 'UNKNOWN_ERROR',
        });
      }
      if (isCurrent(requestEpoch) && liveContentRef.current === requestContent) {
        emitContentSnapshot(savedDraft.content, false, savedDraft);
      }
      return savedDraft;
    } catch (error) {
      const liveDocument = liveDocumentRef.current;
      if (
        isCurrent(requestEpoch) &&
        liveDocument.novelId === requestNovelId &&
        liveDocument.chapterId === requestChapterId &&
        liveDraftIdRef.current === requestDraftId
      ) {
        const appError = normalizeAppError(error, '正文保存失败。');
        setSaveFailure(getAppErrorUserMessage(appError));
        setSaveState('error');
      }
      return null;
    } finally {
      if (isCurrent(requestEpoch)) setSaving(false);
    }
  }, []);

  const handleSave = useCallback(
    (forAdoption = false): Promise<ChapterDraft | null> => {
      const { scope, saveInFlightRef } = latest.current;
      const epoch = scope.current.epoch;
      if (saveInFlightRef.current?.epoch === epoch) return saveInFlightRef.current.promise;
      const save = performSave(forAdoption);
      saveInFlightRef.current = { epoch, promise: save };
      void save.finally(() => {
        if (saveInFlightRef.current?.promise === save) saveInFlightRef.current = null;
      });
      return save;
    },
    [performSave],
  );

  return { handleSave };
}
