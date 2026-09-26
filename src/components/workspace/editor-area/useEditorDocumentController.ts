import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorCandidateAdoption } from './editorReviewAdoption';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { logWorkspaceWarning } from '../../../services/workspace/workspaceErrorService';
import type { ChapterDraft } from '../../../types/ai';
import { getAppErrorUserMessage, normalizeAppError } from '../../../types/appError';
import type { Chapter } from '../../../types/chapter';
import type { ReviewCandidateDocument } from '../../../types/conversation';
import type { DraftContentState } from '../../../types/draftContentState';
import type { AiTextApplyRequest, EditorContentSnapshot } from '../../../types/workspaceSafety';
import { countTextWords, hashTextContent } from '../../../utils/contentHash';
import { formatDateTime } from '../../../utils/date';
import { isComposingKeyboardEvent } from '../../../utils/keyboardEvent';
import { hasActiveModal } from '../../common/useModalAccessibility';
import type {
  DocumentSaveState,
  DocumentAdoptState,
  EditorAreaProps,
  EditorCommandRequest,
  EditorDocumentState,
} from './editorAreaTypes';
import {
  getEditorDocumentSourceKey,
  isDraftSaveResultForDocument,
  resolveEditorDraftContent,
} from './editorDocumentSafety';
import { useEditorOperationScope } from './useEditorOperationScope';

interface UseEditorDocumentControllerOptions {
  chapter?: Chapter;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
  documentState: EditorDocumentState;
  contentStateOverride?: DraftContentState;
  onDraftChange?: EditorAreaProps['onDraftChange'];
  onEditorContentChange?: EditorAreaProps['onEditorContentChange'];
  onDraftSaved?: EditorAreaProps['onDraftSaved'];
  onActionStateChange?: EditorAreaProps['onActionStateChange'];
  applyTextRequest?: AiTextApplyRequest | null;
  onApplyTextConsumed?: EditorAreaProps['onApplyTextConsumed'];
  onApplyTextRejected?: EditorAreaProps['onApplyTextRejected'];
  commandRequest?: EditorCommandRequest | null;
  onChapterUpdated?: EditorAreaProps['onChapterUpdated'];
  onBeforeAdopt?: EditorAreaProps['onBeforeAdopt'];
  reviewCandidate?: ReviewCandidateDocument | null;
  reviewAuthorizationId?: string;
  reviewArtifactId?: string;
  reviewLocked?: boolean;
}

export function useEditorDocumentController({
  chapter,
  novelId,
  currentDraft,
  documentState,
  contentStateOverride,
  onDraftChange,
  onEditorContentChange,
  onDraftSaved,
  onActionStateChange,
  applyTextRequest,
  onApplyTextConsumed,
  onApplyTextRejected,
  commandRequest,
  onChapterUpdated,
  onBeforeAdopt,
  reviewCandidate,
  reviewAuthorizationId,
  reviewLocked = false,
}: UseEditorDocumentControllerOptions) {
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveState, setSaveState] = useState<DocumentSaveState>('idle');
  const [saveFailure, setSaveFailure] = useState('');
  const [adoptState, setAdoptState] = useState<DocumentAdoptState>('idle');
  const [adoptMsg, setAdoptMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastApplyRequestId = useRef('');
  const lastCommandRequestId = useRef('');
  const liveDocumentRef = useRef({ novelId, chapterId: chapter?.id });
  const liveDraftIdRef = useRef(currentDraft?.id);
  const liveContentRef = useRef(content);
  const loadedChapterIdRef = useRef<string>();
  const loadedSourceKeyRef = useRef<string>();
  const saveInFlightRef = useRef<{ epoch: number; promise: Promise<ChapterDraft | null> } | null>(
    null,
  );
  const adoptInFlightRef = useRef<number | null>(null);
  const scopeKey = JSON.stringify([
    novelId,
    chapter?.id,
    reviewCandidate?.artifactId,
    reviewCandidate?.authorizationId,
  ]);
  const { scope, isCurrent } = useEditorOperationScope(scopeKey);
  const [feedbackEpoch, setFeedbackEpoch] = useState(scope.current.epoch);
  const liveAccessRef = useRef({ documentState, reviewLocked, unavailable: false });

  liveDocumentRef.current = { novelId, chapterId: chapter?.id };
  liveDraftIdRef.current = currentDraft?.id;
  liveContentRef.current = content;
  const effectiveContentState = contentStateOverride ?? currentDraft?.contentState;
  const canAdoptReadOnlyCandidate = Boolean(
    reviewCandidate &&
    reviewCandidate.novelId === novelId &&
    reviewCandidate.chapterId === chapter?.id &&
    reviewCandidate.authorizationId &&
    documentState === 'ready' &&
    effectiveContentState?.status !== 'unavailable' &&
    !isDirty &&
    content === reviewCandidate.content &&
    !currentDraft?.isAdopted,
  );
  liveAccessRef.current = {
    documentState,
    reviewLocked,
    unavailable: effectiveContentState?.status === 'unavailable',
  };
  useEffect(() => {
    setFeedbackEpoch(scope.current.epoch);
    setSaving(false);
    setAdopting(false);
    setSaveFailure('');
    setSaveMsg('');
    setSaveState('idle');
    setAdoptMsg('');
    setAdoptState('idle');
  }, [scopeKey, scope]);

  const emitContentSnapshot = useCallback(
    (value: string, dirty: boolean, draft: ChapterDraft | null | undefined = currentDraft) => {
      const draftContentState = contentStateOverride ?? draft?.contentState;
      const unavailable = draftContentState?.status === 'unavailable';
      const safeValue = unavailable ? '' : value;
      const wordCount = countTextWords(safeValue);
      const textarea = textareaRef.current;
      onDraftChange?.(wordCount, dirty);
      const snapshot: EditorContentSnapshot = {
        chapterId: chapter?.id,
        draftId: draft?.id,
        draftVersion: draft?.versionNo,
        content: safeValue,
        wordCount,
        isDirty: unavailable ? false : dirty,
        contentHash: hashTextContent(safeValue),
        contentAvailable: !unavailable,
        persistedContentHash:
          draftContentState?.status === 'ready' ? draftContentState.contentHash : undefined,
        contentState: draftContentState,
        selectionStart: textarea?.selectionStart ?? 0,
        selectionEnd: textarea?.selectionEnd ?? 0,
      };
      onEditorContentChange?.(snapshot);
    },
    [chapter?.id, contentStateOverride, currentDraft, onDraftChange, onEditorContentChange],
  );

  useEffect(() => {
    const sourceInput = {
      documentState,
      novelId,
      chapterId: chapter?.id,
      draft: currentDraft,
      reviewCandidate,
    };
    const sourceKey = getEditorDocumentSourceKey(sourceInput);
    if (sourceKey && loadedSourceKeyRef.current === sourceKey) return;
    const resolution = resolveEditorDraftContent(sourceInput);
    if (resolution.action === 'replace') {
      const unavailable = effectiveContentState?.status === 'unavailable';
      const safeContent = unavailable ? '' : resolution.content;
      setContent(safeContent);
      setIsDirty(false);
      setSaveMsg('');
      setSaveFailure('');
      setSaveState(resolution.draft ? 'saved' : 'idle');
      if (adoptInFlightRef.current !== scope.current.epoch) {
        setAdoptState(resolution.draft?.isAdopted ? 'adopted' : 'idle');
        setAdoptMsg('');
      }
      setLastSaved(resolution.draft ? formatDateTime(resolution.draft.updatedAt) : '');
      loadedChapterIdRef.current = chapter?.id;
      loadedSourceKeyRef.current = sourceKey;
      emitContentSnapshot(safeContent, false, resolution.draft);
    } else if (resolution.reason) {
      setSaveMsg(resolution.reason);
    }
  }, [
    chapter?.id,
    currentDraft,
    documentState,
    effectiveContentState,
    emitContentSnapshot,
    novelId,
    reviewCandidate,
    scope,
  ]);

  const handleContentChange = useCallback(
    (value: string) => {
      if (documentState !== 'ready' || reviewLocked) return;
      setContent(value);
      liveContentRef.current = value;
      const dirty = value !== (currentDraft?.content || '');
      setIsDirty(dirty);
      setSaveState(dirty ? 'editing' : currentDraft ? 'saved' : 'idle');
      setSaveMsg('');
      if (adoptState !== 'error' && adoptInFlightRef.current !== scope.current.epoch) {
        setAdoptState(currentDraft?.isAdopted && !dirty ? 'adopted' : 'idle');
        setAdoptMsg('');
      }
      emitContentSnapshot(value, dirty);
    },
    [adoptState, currentDraft, documentState, emitContentSnapshot, reviewLocked, scope],
  );

  const handleSelectionChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    onEditorContentChange?.({
      chapterId: chapter?.id,
      draftId: currentDraft?.id,
      draftVersion: currentDraft?.versionNo,
      content,
      wordCount: countTextWords(content),
      isDirty,
      contentHash: hashTextContent(content),
      contentAvailable: effectiveContentState?.status !== 'unavailable',
      persistedContentHash:
        effectiveContentState?.status === 'ready' ? effectiveContentState.contentHash : undefined,
      contentState: effectiveContentState,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    });
  }, [chapter?.id, content, currentDraft, effectiveContentState, isDirty, onEditorContentChange]);

  useEffect(() => {
    if (!applyTextRequest || lastApplyRequestId.current === applyTextRequest.id) return;
    lastApplyRequestId.current = applyTextRequest.id;
    const incoming = applyTextRequest.text.trim();
    if (!incoming) return;
    if (documentState !== 'ready' || effectiveContentState?.status === 'unavailable') {
      const reason =
        documentState !== 'ready'
          ? '完整正文尚未安全载入，已阻止应用 AI 输出'
          : '完整正文不可用，已阻止应用 AI 输出';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (
      !chapter ||
      !novelId ||
      applyTextRequest.novelId !== novelId ||
      applyTextRequest.chapterId !== chapter.id
    ) {
      const reason = 'AI 输出目标不是当前作品章节，已阻止应用';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (hashTextContent(content) !== applyTextRequest.baseContentHash) {
      const reason = '正文已在 AI 结果生成后发生变化，已阻止覆盖';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (applyTextRequest.sourceDraftId && currentDraft?.id !== applyTextRequest.sourceDraftId) {
      const reason = '基础草稿已切换，已阻止应用旧结果';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    if (
      applyTextRequest.sourceRevision !== undefined &&
      currentDraft?.versionNo !== applyTextRequest.sourceRevision
    ) {
      const reason = '基础草稿版本已变化，已阻止应用旧结果';
      setSaveMsg(reason);
      onApplyTextRejected?.(applyTextRequest, reason);
      return;
    }
    setContent((previousContent) => {
      const nextContent =
        applyTextRequest.mode === 'append'
          ? [previousContent.trimEnd(), incoming].filter(Boolean).join('\n\n')
          : incoming;
      setIsDirty(true);
      setSaveState('editing');
      emitContentSnapshot(nextContent, true);
      return nextContent;
    });
    setSaveMsg('未保存');
    onApplyTextConsumed?.(applyTextRequest);
    textareaRef.current?.focus();
  }, [
    applyTextRequest,
    chapter,
    content,
    currentDraft,
    documentState,
    effectiveContentState,
    emitContentSnapshot,
    novelId,
    onApplyTextConsumed,
    onApplyTextRejected,
  ]);

  const performSave = useCallback(
    async (forAdoption = false): Promise<ChapterDraft | null> => {
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
                source:
                  reviewCandidate?.content === requestContent ? 'ai_generated' : 'user_edited',
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
    },
    [
      adoptMsg,
      adoptState,
      chapter,
      content,
      currentDraft,
      documentState,
      effectiveContentState,
      emitContentSnapshot,
      isDirty,
      novelId,
      onActionStateChange,
      onDraftSaved,
      canAdoptReadOnlyCandidate,
      reviewCandidate?.content,
      reviewLocked,
      scope,
      isCurrent,
    ],
  );

  const handleSave = useCallback(
    (forAdoption = false): Promise<ChapterDraft | null> => {
      const epoch = scope.current.epoch;
      if (saveInFlightRef.current?.epoch === epoch) return saveInFlightRef.current.promise;
      const save = performSave(forAdoption);
      saveInFlightRef.current = { epoch, promise: save };
      void save.finally(() => {
        if (saveInFlightRef.current?.promise === save) saveInFlightRef.current = null;
      });
      return save;
    },
    [performSave, scope],
  );

  const restoreRecovery = useCallback(
    (recoveryContent: string, selectionStart = 0, selectionEnd = selectionStart): boolean => {
      if (!chapter || effectiveContentState?.status === 'unavailable') return false;
      setContent(recoveryContent);
      setIsDirty(true);
      setSaveMsg('未保存（已恢复）');
      setSaveState('editing');
      emitContentSnapshot(recoveryContent, true);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = Math.max(0, Math.min(selectionStart, recoveryContent.length));
        const end = Math.max(start, Math.min(selectionEnd, recoveryContent.length));
        textarea.focus();
        textarea.setSelectionRange(start, end);
      });
      return true;
    },
    [chapter, effectiveContentState, emitContentSnapshot],
  );

  const handleFormat = useCallback(() => {
    if (documentState !== 'ready' || reviewLocked || saving || adopting) return;
    handleContentChange(content.replace(/\n{3,}/g, '\n\n').trim());
    setSaveMsg('已排版');
    setSaveState('editing');
  }, [adopting, content, documentState, handleContentChange, reviewLocked, saving]);

  const { handleAdoptCurrent } = useEditorCandidateAdoption({
    chapterId: chapter?.id,
    novelId,
    documentState,
    reviewLocked,
    canAdoptReadOnlyCandidate,
    scope,
    isCurrent,
    adoptInFlightRef,
    saveInFlightRef,
    liveContentRef,
    liveAccessRef,
    liveDraftIdRef,
    liveDocumentRef,
    effectiveContentState,
    currentDraft,
    content,
    isDirty,
    handleSave,
    authorizationId: reviewCandidate?.authorizationId || reviewAuthorizationId,
    onBeforeAdopt,
    onChapterUpdated,
    onDraftSaved,
    emitContentSnapshot,
    setFeedbackEpoch,
    setAdopting,
    setAdoptState,
    setAdoptMsg,
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        hasActiveModal() ||
        isComposingKeyboardEvent(event) ||
        (event.target instanceof Element && event.target.closest('[data-editor-outline]'))
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (isDirty) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, isDirty]);

  useEffect(() => {
    if (!commandRequest || lastCommandRequestId.current === commandRequest.id) return;
    lastCommandRequestId.current = commandRequest.id;
    if (commandRequest.type === 'save') {
      void handleSave();
    } else if (commandRequest.type === 'format') {
      handleFormat();
    } else if (commandRequest.type === 'adopt-current') {
      void handleAdoptCurrent();
    }
  }, [commandRequest, handleAdoptCurrent, handleFormat, handleSave]);

  return {
    content,
    effectiveContentState,
    handleContentChange,
    handleSave,
    handleSelectionChange,
    adopting: feedbackEpoch === scope.current.epoch && adopting,
    adoptState: feedbackEpoch === scope.current.epoch ? adoptState : ('idle' as DocumentAdoptState),
    adoptMsg: feedbackEpoch === scope.current.epoch ? adoptMsg : '',
    handleAdoptCurrent,
    canAdoptReadOnlyCandidate,
    isDirty,
    lastSaved,
    loadedChapterIdRef,
    restoreRecovery,
    saveMsg: feedbackEpoch === scope.current.epoch ? saveFailure || saveMsg : '',
    saveState:
      feedbackEpoch === scope.current.epoch
        ? saveFailure
          ? ('error' as const)
          : saveState
        : ('idle' as const),
    saving: feedbackEpoch === scope.current.epoch && saving,
    textareaRef,
  };
}

export type EditorDocumentController = ReturnType<typeof useEditorDocumentController>;
