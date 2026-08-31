import { useCallback, useEffect, useRef, useState } from 'react';
import { chapterRepository } from '../../../services/database/chapterRepository';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { DraftContentState } from '../../../types/draftContentState';
import type { DocumentSaveState, EditorDocumentState } from './editorAreaTypes';

interface UseChapterOutlineEditorOptions {
  chapter?: Chapter;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
  documentState: EditorDocumentState;
  effectiveContentState?: DraftContentState;
  onChapterUpdated?: (chapterId: string) => void;
}

function waitForInlineSaveFeedback(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

export function useChapterOutlineEditor({
  chapter,
  novelId,
  currentDraft,
  documentState,
  effectiveContentState,
  onChapterUpdated,
}: UseChapterOutlineEditorOptions) {
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState('');
  const [outlineSaveMsg, setOutlineSaveMsg] = useState('');
  const [outlineSaveState, setOutlineSaveState] = useState<DocumentSaveState>('idle');
  const saveInFlightRef = useRef<Promise<void> | null>(null);
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
  }, [chapter?.id, currentDraft, documentState, effectiveContentState, novelId]);

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
    if (!chapter || !novelId || documentState !== 'ready') return;
    const requestChapterId = chapter.id;
    const requestOutline = outlineDraft;
    setOutlineSaveState('saving');
    setOutlineSaveMsg('保存中');
    try {
      await waitForInlineSaveFeedback();
      await chapterRepository.update(requestChapterId, { outline: requestOutline });
      await onChapterUpdated?.(requestChapterId);
      if (liveChapterIdRef.current !== requestChapterId) return;
      if (liveOutlineDraftRef.current !== requestOutline) {
        setOutlineSaveState('editing');
        setOutlineSaveMsg('大纲已变化，请再次保存');
        return;
      }
      setIsEditingOutline(false);
      setOutlineSaveState('saved');
      setOutlineSaveMsg('已保存');
    } catch {
      if (liveChapterIdRef.current !== requestChapterId) return;
      setOutlineSaveState('error');
      setOutlineSaveMsg('章节大纲保存失败');
    }
  }, [chapter, documentState, novelId, onChapterUpdated, outlineDraft]);

  const handleSaveOutline = useCallback((): Promise<void> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const save = performSaveOutline();
    saveInFlightRef.current = save;
    void save.finally(() => {
      if (saveInFlightRef.current === save) saveInFlightRef.current = null;
    });
    return save;
  }, [performSaveOutline]);

  const handleOutlineDraftChange = useCallback((value: string) => {
    setOutlineDraft(value);
    setOutlineSaveState('editing');
    setOutlineSaveMsg('');
  }, []);

  useEffect(() => {
    if (!isEditingOutline) return;
    const handler = (event: KeyboardEvent) => {
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
