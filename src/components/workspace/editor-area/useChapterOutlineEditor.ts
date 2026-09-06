import { useCallback, useEffect, useRef, useState } from 'react';
import { chapterRepository } from '../../../services/database/chapterRepository';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { DraftContentState } from '../../../types/draftContentState';
import type { DocumentSaveState, EditorDocumentState } from './editorAreaTypes';
import { useEditorOperationScope } from './useEditorOperationScope';
import { isComposingKeyboardEvent } from '../../../utils/keyboardEvent';
import { hasActiveModal } from '../../common/useModalAccessibility';

interface UseChapterOutlineEditorOptions {
  chapter?: Chapter;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
  documentState: EditorDocumentState;
  effectiveContentState?: DraftContentState;
  onChapterUpdated?: (chapterId: string) => void;
}

export function useChapterOutlineEditor({
  chapter,
  novelId,
  documentState,
  effectiveContentState,
  onChapterUpdated,
}: UseChapterOutlineEditorOptions) {
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState('');
  const [outlineSaveMsg, setOutlineSaveMsg] = useState('');
  const [outlineSaveState, setOutlineSaveState] = useState<DocumentSaveState>('idle');
  const saveInFlightRef = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  const scopeKey = JSON.stringify([novelId, chapter?.id]);
  const { scope, isCurrent } = useEditorOperationScope(scopeKey);
  const liveChapterIdRef = useRef(chapter?.id);
  const liveOutlineDraftRef = useRef(outlineDraft);
  liveChapterIdRef.current = chapter?.id;
  liveOutlineDraftRef.current = outlineDraft;

  useEffect(() => {
    setIsEditingOutline(false);
    setOutlineDraft('');
    setOutlineSaveMsg('');
    setOutlineSaveState('idle');
    saveInFlightRef.current = null;
  }, [scopeKey]);

  const handleStartEditOutline = useCallback(() => {
    setOutlineDraft(chapter?.outline || '');
    setIsEditingOutline(true);
    setOutlineSaveMsg('');
    setOutlineSaveState('editing');
  }, [chapter?.outline]);

  const handleCancelEditOutline = useCallback(() => {
    setIsEditingOutline(false);
    setOutlineDraft('');
    setOutlineSaveMsg('');
    setOutlineSaveState('idle');
  }, []);

  const performSaveOutline = useCallback(async () => {
    if (
      !chapter ||
      !novelId ||
      documentState !== 'ready' ||
      effectiveContentState?.status === 'unavailable'
    )
      return;
    const epoch = scope.current.epoch;
    const requestChapterId = chapter.id;
    const requestOutline = outlineDraft;
    setOutlineSaveState('saving');
    setOutlineSaveMsg('保存中');
    try {
      const savedChapter = await chapterRepository.update(requestChapterId, {
        outline: requestOutline,
      });
      if (!savedChapter || savedChapter.id !== requestChapterId) {
        throw new Error('章节大纲保存结果与目标章节不一致');
      }
      if (!isCurrent(epoch)) return;
      await onChapterUpdated?.(requestChapterId);
      if (!isCurrent(epoch) || liveChapterIdRef.current !== requestChapterId) return;
      if (liveOutlineDraftRef.current !== requestOutline) {
        setOutlineSaveState('editing');
        setOutlineSaveMsg('大纲已变化，请再次保存');
        return;
      }
      setIsEditingOutline(false);
      setOutlineSaveState('saved');
      setOutlineSaveMsg('已保存');
    } catch {
      if (!isCurrent(epoch) || liveChapterIdRef.current !== requestChapterId) return;
      setOutlineSaveState('error');
      setOutlineSaveMsg('章节大纲保存失败');
    }
  }, [
    chapter,
    documentState,
    effectiveContentState?.status,
    isCurrent,
    novelId,
    onChapterUpdated,
    outlineDraft,
    scope,
  ]);

  const handleSaveOutline = useCallback((): Promise<void> => {
    const epoch = scope.current.epoch;
    if (saveInFlightRef.current?.epoch === epoch) return saveInFlightRef.current.promise;
    const save = performSaveOutline();
    saveInFlightRef.current = { epoch, promise: save };
    void save.finally(() => {
      if (saveInFlightRef.current?.promise === save) saveInFlightRef.current = null;
    });
    return save;
  }, [performSaveOutline, scope]);

  const handleOutlineDraftChange = useCallback((value: string) => {
    setOutlineDraft(value);
    liveOutlineDraftRef.current = value;
    setOutlineSaveState((state) => (state === 'error' ? 'error' : 'editing'));
    setOutlineSaveMsg((message) => (message === '章节大纲保存失败' ? message : ''));
  }, []);

  useEffect(() => {
    if (!isEditingOutline) return;
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasActiveModal() || isComposingKeyboardEvent(event)) return;
      if (!(event.target instanceof Element) || !event.target.closest('[data-editor-outline]'))
        return;
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void handleSaveOutline();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSaveOutline, isEditingOutline]);

  return {
    handleCancelEditOutline,
    handleSaveOutline,
    handleStartEditOutline,
    isEditingOutline,
    outlineDraft,
    outlineSaveMsg,
    outlineSaveState,
    saving: outlineSaveState === 'saving',
    setOutlineDraft: handleOutlineDraftChange,
  };
}

export type ChapterOutlineEditor = ReturnType<typeof useChapterOutlineEditor>;
