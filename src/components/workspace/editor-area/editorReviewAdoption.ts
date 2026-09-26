import { useCallback, type MutableRefObject } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import type { DraftContentState } from '../../../types/draftContentState';
import { logWorkspaceWarning } from '../../../services/workspace/workspaceErrorService';
import { getAppErrorUserMessage, normalizeAppError } from '../../../types/appError';
import type { DocumentAdoptState, EditorAreaProps, EditorDocumentState } from './editorAreaTypes';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { computeContentSha256 } from '../../../utils/contentIntegrity';
import { confirmInfo } from '../../../utils/nativeDialog';

export function confirmEditorAdoption(
  reviewLocked: boolean,
  needsSave: boolean,
  version?: number,
): Promise<boolean> {
  return confirmInfo({
    title: reviewLocked ? '采用未修改候选' : needsSave ? '保存并采用' : '采用草稿',
    message: reviewLocked
      ? '确认将当前审阅的未修改候选采用为正式正文？确认后才会保存所需草稿，并复验、消费审阅授权；取消不会保存或采用。'
      : needsSave
        ? '当前正文存在未保存修改。需要先保存为草稿，再将该草稿确认为正式正文。是否继续？'
        : '确认采用草稿 v' + version + ' 作为正式正文？',
    testId: 'apply-confirm',
  });
}

export async function persistEditorAdoption(input: {
  draft: ChapterDraft;
  chapterId: string;
  authorizationId?: string;
  onBeforeAdopt?: (draftId: string) => unknown | Promise<unknown>;
  assertCurrent: () => void;
}): Promise<ChapterDraft> {
  if (input.authorizationId) {
    const expectedContentHash = await computeContentSha256(input.draft.content);
    input.assertCurrent();
    const result = await artifactDecisionService.adoptReviewAuthorizedDraft({
      authorizationId: input.authorizationId,
      draftId: input.draft.id,
      expectedDraftVersion: input.draft.versionNo,
      expectedContentHash,
    });
    return result.adoptedDraft;
  }
  await input.onBeforeAdopt?.(input.draft.id);
  input.assertCurrent();
  return draftVersionService.adopt(input.draft.id, input.chapterId);
}

export interface EditorCandidateAdoptionOptions {
  chapterId?: string;
  novelId?: string;
  documentState: EditorDocumentState;
  reviewLocked: boolean;
  canAdoptReadOnlyCandidate: boolean;
  scope: { current: { epoch: number } };
  isCurrent: (epoch: number) => boolean;
  adoptInFlightRef: MutableRefObject<number | null>;
  saveInFlightRef: MutableRefObject<{ epoch: number } | null>;
  liveContentRef: MutableRefObject<string>;
  liveAccessRef: MutableRefObject<{
    documentState: EditorDocumentState;
    reviewLocked: boolean;
    unavailable: boolean;
  }>;
  liveDraftIdRef: MutableRefObject<string | undefined>;
  liveDocumentRef: MutableRefObject<{ novelId?: string; chapterId?: string }>;
  effectiveContentState?: DraftContentState;
  currentDraft?: ChapterDraft | null;
  content: string;
  isDirty: boolean;
  handleSave: (forAdoption?: boolean) => Promise<ChapterDraft | null>;
  authorizationId?: string;
  onBeforeAdopt?: EditorAreaProps['onBeforeAdopt'];
  onChapterUpdated?: EditorAreaProps['onChapterUpdated'];
  onDraftSaved?: EditorAreaProps['onDraftSaved'];
  emitContentSnapshot: (value: string, dirty: boolean, draft?: ChapterDraft | null) => void;
  setFeedbackEpoch: (epoch: number) => void;
  setAdopting: (value: boolean) => void;
  setAdoptState: (value: DocumentAdoptState) => void;
  setAdoptMsg: (value: string) => void;
}

/**
 * Explicit adoption of the current editor draft. Read-only review keeps its own
 * authorization/version/hash boundary; opening review never saves or adopts.
 */
export function useEditorCandidateAdoption(options: EditorCandidateAdoptionOptions) {
  const {
    chapterId,
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
    authorizationId,
    onBeforeAdopt,
    onChapterUpdated,
    onDraftSaved,
    emitContentSnapshot,
    setFeedbackEpoch,
    setAdopting,
    setAdoptState,
    setAdoptMsg,
  } = options;

  const handleAdoptCurrent = useCallback(async () => {
    if (
      !chapterId ||
      !novelId ||
      documentState !== 'ready' ||
      (reviewLocked && !canAdoptReadOnlyCandidate)
    )
      return;
    const requestEpoch = scope.current.epoch;
    if (
      adoptInFlightRef.current === requestEpoch ||
      saveInFlightRef.current?.epoch === requestEpoch
    )
      return;
    setFeedbackEpoch(requestEpoch);
    if (effectiveContentState?.status === 'unavailable') {
      setAdoptMsg('正文不可用，已阻止采用');
      setAdoptState('error');
      return;
    }
    if (currentDraft?.isAdopted && !isDirty && currentDraft.content === content) {
      setAdoptMsg('当前正文已采用');
      setAdoptState('adopted');
      return;
    }
    const requestNovelId = novelId;
    const requestChapterId = chapterId;
    const requestContent = content;
    const requestDraftId = currentDraft?.id;
    let draftToAdopt = currentDraft;
    adoptInFlightRef.current = requestEpoch;
    setAdopting(true);
    setAdoptState('confirming');
    setAdoptMsg('等待确认采用');
    const hasSameContentAndAccess = () =>
      isCurrent(requestEpoch) &&
      liveContentRef.current === requestContent &&
      liveAccessRef.current.documentState === 'ready' &&
      liveAccessRef.current.reviewLocked === reviewLocked &&
      !liveAccessRef.current.unavailable;
    try {
      const needsSave = !draftToAdopt || draftToAdopt.content !== content || isDirty;
      const confirmed = await confirmEditorAdoption(
        reviewLocked,
        needsSave,
        draftToAdopt?.versionNo,
      );
      if (!isCurrent(requestEpoch)) return;
      if (!confirmed) {
        setAdoptState('idle');
        setAdoptMsg('已取消采用，正文未改变');
        return;
      }
      if (!hasSameContentAndAccess() || liveDraftIdRef.current !== requestDraftId) {
        throw new Error('正文或审阅状态已变化，已阻止采用。请检查后重新确认。');
      }
      if (needsSave) draftToAdopt = await handleSave(true);
      if (!isCurrent(requestEpoch)) return;
      if (!draftToAdopt) {
        setAdoptState('error');
        setAdoptMsg('尚未采用：草稿保存未完成，请先处理保存反馈。');
        return;
      }
      if (!hasSameContentAndAccess()) {
        throw new Error('正文或审阅状态已变化，已阻止采用。请检查后重新确认。');
      }
      const draftForAdoption = draftToAdopt;
      const adoptionEditorDraftId = liveDraftIdRef.current;
      setAdoptState('adopting');
      setAdoptMsg('正在校验并采用草稿');
      const adopted = await persistEditorAdoption({
        draft: draftForAdoption,
        chapterId: requestChapterId,
        authorizationId,
        onBeforeAdopt,
        assertCurrent: () => {
          if (!hasSameContentAndAccess() || liveDraftIdRef.current !== adoptionEditorDraftId) {
            throw new Error('正文或审阅状态已变化，已阻止采用。请检查后重新确认。');
          }
        },
      });
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
        !isCurrent(requestEpoch) ||
        liveDocument.novelId !== requestNovelId ||
        liveDocument.chapterId !== requestChapterId
      ) {
        return;
      }
      if (liveContentRef.current !== draftForAdoption.content) {
        setAdoptState('idle');
        setAdoptMsg('先前草稿已采用；当前修改尚未采用。');
        return;
      }
      setAdoptMsg('已采用为正式正文');
      setAdoptState('adopted');
      try {
        await onDraftSaved?.(adopted);
      } catch {
        logWorkspaceWarning('post_adopt_callback_failed', {
          novelId: requestNovelId,
          chapterId: requestChapterId,
          draftId: adopted.id,
        });
      }
      if (isCurrent(requestEpoch) && liveContentRef.current === adopted.content) {
        emitContentSnapshot(adopted.content, false, adopted);
        onChapterUpdated?.(requestChapterId);
      }
    } catch (error) {
      const liveDocument = liveDocumentRef.current;
      if (
        isCurrent(requestEpoch) &&
        liveDocument.novelId === requestNovelId &&
        liveDocument.chapterId === requestChapterId
      ) {
        const appError = normalizeAppError(error, '采用失败。');
        setAdoptMsg(`采用失败：${getAppErrorUserMessage(appError)}`);
        setAdoptState('error');
      }
    } finally {
      if (adoptInFlightRef.current === requestEpoch) adoptInFlightRef.current = null;
      if (isCurrent(requestEpoch)) setAdopting(false);
    }
  }, [
    adoptInFlightRef,
    authorizationId,
    canAdoptReadOnlyCandidate,
    chapterId,
    content,
    currentDraft,
    documentState,
    effectiveContentState,
    emitContentSnapshot,
    handleSave,
    isCurrent,
    isDirty,
    liveAccessRef,
    liveContentRef,
    liveDocumentRef,
    liveDraftIdRef,
    novelId,
    onBeforeAdopt,
    onChapterUpdated,
    onDraftSaved,
    reviewLocked,
    saveInFlightRef,
    scope,
    setAdoptMsg,
    setAdoptState,
    setAdopting,
    setFeedbackEpoch,
  ]);

  return { handleAdoptCurrent };
}
