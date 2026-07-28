import { useCallback, useEffect, useState } from 'react';
import { runWithLoading } from '../../../lib/runWithLoading';
import { chapterRepository } from '../../../services/database/chapterRepository';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { DraftContentState } from '../../../types/draftContentState';
import type { EditorDocumentState } from './editorAreaTypes';

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
  currentDraft,
  documentState,
  effectiveContentState,
  onChapterUpdated,
}: UseChapterOutlineEditorOptions) {
  const [isEditingOutline, setIsEditingOutline] = useState(false);
  const [outlineDraft, setOutlineDraft] = useState('');
  const [outlineSaveMsg, setOutlineSaveMsg] = useState('');

  useEffect(() => {
    setIsEditingOutline(false);
    setOutlineDraft('');
    setOutlineSaveMsg('');
  }, [chapter?.id, currentDraft, documentState, effectiveContentState, novelId]);

  const handleStartEditOutline = useCallback(() => {
    setOutlineDraft(chapter?.outline || '');
    setIsEditingOutline(true);
    setOutlineSaveMsg('');
  }, [chapter?.outline]);

  const handleCancelEditOutline = useCallback(() => {
    setIsEditingOutline(false);
    setOutlineDraft('');
    setOutlineSaveMsg('');
  }, []);

  const handleSaveOutline = useCallback(async () => {
    if (!chapter || !novelId || documentState !== 'ready') return;
    try {
      await runWithLoading(
        {
          title: '正在保存章节大纲',
          initialMessage: '正在写入数据库……',
          successMessage: '章节大纲已保存',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async () => {
          await chapterRepository.update(chapter.id, { outline: outlineDraft });
          onChapterUpdated?.(chapter.id);
        },
      );
      setIsEditingOutline(false);
      setOutlineSaveMsg('✅ 已保存');
      setTimeout(() => setOutlineSaveMsg(''), 3000);
    } catch {
      setOutlineSaveMsg('❌ 保存失败');
      setTimeout(() => setOutlineSaveMsg(''), 3000);
    }
  }, [chapter, documentState, novelId, onChapterUpdated, outlineDraft]);

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
    setOutlineDraft,
  };
}

export type ChapterOutlineEditor = ReturnType<typeof useChapterOutlineEditor>;
