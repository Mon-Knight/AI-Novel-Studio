import { useCallback, useEffect, useRef, useState } from 'react';
import { runWithLoading } from '../../../lib/runWithLoading';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { logWorkspaceWarning } from '../../../services/workspace/workspaceErrorService';
import type { ChapterDraft } from '../../../types/ai';
import { getAppErrorUserMessage, normalizeAppError } from '../../../types/appError';
import type { Chapter } from '../../../types/chapter';
import type { ReviewCandidateDocument } from '../../../types/conversation';
import type { DraftContentState } from '../../../types/draftContentState';
import type { AiTextApplyRequest, EditorContentSnapshot } from '../../../types/workspaceSafety';
import { countTextWords, hashTextContent } from '../../../utils/contentHash';
import { computeContentSha256 } from '../../../utils/contentIntegrity';
import { formatDateTime } from '../../../utils/date';
import { confirmInfo } from '../../../utils/nativeDialog';
import type { EditorAreaProps, EditorCommandRequest, EditorDocumentState } from './editorAreaTypes';
import {
  getEditorDocumentSourceKey,
  isDraftSaveResultForDocument,
  resolveEditorDraftContent,
} from './editorDocumentSafety';

interface UseEditorDocumentControllerOptions {
  chapter?: Chapter;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
  documentState: EditorDocumentState;
  contentStateOverride?: DraftContentState;
  onDraftChange?: EditorAreaProps['onDraftChange'];
  onEditorContentChange?: EditorAreaProps['onEditorContentChange'];
  onDraftSaved?: EditorAreaProps['onDraftSaved'];
  applyTextRequest?: AiTextApplyRequest | null;
  onApplyTextConsumed?: EditorAreaProps['onApplyTextConsumed'];
  onApplyTextRejected?: EditorAreaProps['onApplyTextRejected'];
  commandRequest?: EditorCommandRequest | null;
  onChapterUpdated?: EditorAreaProps['onChapterUpdated'];
  onBeforeAdopt?: EditorAreaProps['onBeforeAdopt'];
  reviewCandidate?: ReviewCandidateDocument | null;
  reviewAuthorizationId?: string;
  reviewArtifactId?: string;
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
  applyTextRequest,
  onApplyTextConsumed,
  onApplyTextRejected,
  commandRequest,
  onChapterUpdated,
  onBeforeAdopt,
  reviewCandidate,
  reviewAuthorizationId,
}: UseEditorDocumentControllerOptions) {
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
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
  const saveInFlightRef = useRef<Promise<ChapterDraft | null> | null>(null);

  liveDocumentRef.current = { novelId, chapterId: chapter?.id };
  liveDraftIdRef.current = currentDraft?.id;
  liveContentRef.current = content;
  const effectiveContentState = contentStateOverride ?? currentDraft?.contentState;

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
  ]);

  const handleContentChange = useCallback(
    (value: string) => {
      if (documentState !== 'ready') return;
      setContent(value);
      const dirty = value !== (currentDraft?.content || '');
      setIsDirty(dirty);
      emitContentSnapshot(value, dirty);
    },
    [currentDraft, documentState, emitContentSnapshot],
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

  const performSave = useCallback(async (): Promise<ChapterDraft | null> => {
    if (!chapter || !novelId || documentState !== 'ready') return null;
    if (effectiveContentState?.status === 'unavailable') {
      setSaveMsg('正文不可用，已阻止保存');
      return null;
    }
    setSaving(true);
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    const requestDraftId = currentDraft?.id;
    const requestContent = content;
    try {
      const savedDraft = await runWithLoading(
        {
          title: '正在保存草稿',
          initialMessage: '正在保存正文……',
          successMessage: '草稿已保存',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async ({ setMessage }) => {
          if (currentDraft && !currentDraft.isAdopted) {
            setMessage('正在更新草稿……');
            return await draftVersionService.update(
              currentDraft.id,
              requestChapterId,
              requestContent,
              'user_edited',
              undefined,
              currentDraft,
            );
          }
          setMessage('正在创建草稿……');
          return await draftVersionService.create({
            novelId: requestNovelId,
            chapterId: requestChapterId,
            content: requestContent,
            source: 'user_edited',
          });
        },
      );
      if (!isDraftSaveResultForDocument(savedDraft, requestNovelId, requestChapterId)) {
        throw new Error('草稿保存结果与当前章节不一致');
      }
      const liveDocument = liveDocumentRef.current;
      if (
        liveDocument.novelId !== requestNovelId ||
        liveDocument.chapterId !== requestChapterId ||
        liveDraftIdRef.current !== requestDraftId
      ) {
        return null;
      }
      if (liveContentRef.current !== requestContent) {
        setSaveMsg('正文已变化，请再次保存');
        setTimeout(() => setSaveMsg(''), 3000);
        return null;
      }
      setIsDirty(false);
      setSaveMsg('已保存');
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
      emitContentSnapshot(savedDraft.content, false, savedDraft);
      setTimeout(() => setSaveMsg(''), 2000);
      return savedDraft;
    } catch (error) {
      const liveDocument = liveDocumentRef.current;
      if (liveDocument.novelId === requestNovelId && liveDocument.chapterId === requestChapterId) {
        const appError = normalizeAppError(error, '正文保存失败。');
        setSaveMsg(`❌ ${getAppErrorUserMessage(appError)}`);
        setTimeout(() => setSaveMsg(''), 3000);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    chapter,
    content,
    currentDraft,
    documentState,
    effectiveContentState,
    emitContentSnapshot,
    novelId,
    onDraftSaved,
  ]);

  const handleSave = useCallback((): Promise<ChapterDraft | null> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const save = performSave();
    saveInFlightRef.current = save;
    void save.finally(() => {
      if (saveInFlightRef.current === save) saveInFlightRef.current = null;
    });
    return save;
  }, [performSave]);

  const restoreRecovery = useCallback(
    (recoveryContent: string, selectionStart = 0, selectionEnd = selectionStart): boolean => {
      if (!chapter || effectiveContentState?.status === 'unavailable') return false;
      setContent(recoveryContent);
      setIsDirty(true);
      setSaveMsg('未保存（已恢复）');
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
    if (documentState !== 'ready') return;
    handleContentChange(content.replace(/\n{3,}/g, '\n\n').trim());
    setSaveMsg('已排版');
    setTimeout(() => setSaveMsg(''), 2000);
  }, [content, documentState, handleContentChange]);

  const handleAdoptCurrent = useCallback(async () => {
    if (!chapter || !novelId || documentState !== 'ready') return;
    if (adopting || saving) return;
    if (effectiveContentState?.status === 'unavailable') {
      setSaveMsg('正文不可用，已阻止采用');
      return;
    }
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    let draftToAdopt = currentDraft;

    if (!draftToAdopt || draftToAdopt.content !== content || isDirty) {
      const confirmed = await confirmInfo({
        title: '保存并采用',
        message: '当前正文存在未保存修改。需要先保存为草稿，再将该草稿确认为正式正文。是否继续？',
        testId: 'apply-confirm',
      });
      if (!confirmed) return;
      draftToAdopt = await handleSave();
    } else {
      const existingDraft = draftToAdopt;
      if (
        !existingDraft.isAdopted &&
        !(await confirmInfo({
          title: '采用草稿',
          message: `确认采用草稿 v${existingDraft.versionNo} 作为正式正文？`,
          testId: 'apply-confirm',
        }))
      )
        return;
    }

    if (!draftToAdopt) {
      setSaveMsg('采用失败');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    const draftForAdoption = draftToAdopt;
    setAdopting(true);
    try {
      const activeAuthId = reviewCandidate?.authorizationId || reviewAuthorizationId;
      let adopted: ChapterDraft;
      if (activeAuthId) {
        const expectedContentHash = await computeContentSha256(draftForAdoption.content);
        const adoptResult = await runWithLoading(
          {
            title: '正在确认采用',
            initialMessage: '正在原子校验授权并更新正文……',
            successMessage: '已采用为正式正文',
            errorMessage: '采用失败',
            successAutoCloseMs: 800,
          },
          async () =>
            await artifactDecisionService.adoptReviewAuthorizedDraft({
              authorizationId: activeAuthId,
              draftId: draftForAdoption.id,
              expectedDraftVersion: draftForAdoption.versionNo,
              expectedContentHash,
            }),
        );
        adopted = adoptResult.adoptedDraft;
      } else {
        if (onBeforeAdopt) await onBeforeAdopt(draftForAdoption.id);
        adopted = await runWithLoading(
          {
            title: '正在确认采用',
            initialMessage: '正在更新正式正文版本……',
            successMessage: '已采用为正式正文',
            errorMessage: '采用失败',
            successAutoCloseMs: 800,
          },
          async () => await draftVersionService.adopt(draftForAdoption.id, requestChapterId),
        );
      }
      if (
        adopted.id !== draftForAdoption.id ||
        adopted.novelId !== requestNovelId ||
        adopted.chapterId !== requestChapterId ||
        !adopted.isAdopted
      ) {
        throw new Error('正文采用结果与当前章节不一致');
      }
      const liveDocument = liveDocumentRef.current;
      if (
        liveDocument.novelId !== requestNovelId ||
        liveDocument.chapterId !== requestChapterId ||
        liveContentRef.current !== draftForAdoption.content
      ) {
        return;
      }
      setSaveMsg('已采用');
      void onDraftSaved?.(adopted);
      emitContentSnapshot(adopted.content, false, adopted);
      onChapterUpdated?.(requestChapterId);
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (error) {
      const liveDocument = liveDocumentRef.current;
      if (liveDocument.novelId === requestNovelId && liveDocument.chapterId === requestChapterId) {
        const appError = normalizeAppError(error, '采用失败。');
        setSaveMsg(`❌ ${getAppErrorUserMessage(appError)}`);
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } finally {
      setAdopting(false);
    }
  }, [
    adopting,
    chapter,
    content,
    currentDraft,
    documentState,
    effectiveContentState,
    emitContentSnapshot,
    handleSave,
    isDirty,
    novelId,
    onBeforeAdopt,
    onChapterUpdated,
    onDraftSaved,
    reviewAuthorizationId,
    reviewCandidate?.authorizationId,
    saving,
  ]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
    isDirty,
    lastSaved,
    loadedChapterIdRef,
    restoreRecovery,
    saveMsg,
    saving,
    textareaRef,
  };
}

export type EditorDocumentController = ReturnType<typeof useEditorDocumentController>;
