import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Chapter } from '../../types/chapter';
import {
  chapterWorkflowDraft,
  loadChapterWorkflow,
  type ChapterWorkflowState,
} from '../../services/conversation/chapterWorkflowService';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { chapterRepository } from '../../services/database/chapterRepository';

export function useChapterSummaryWorkflow(
  novelId?: string,
  chapter?: Chapter,
  authorizationId?: string,
) {
  const navigate = useNavigate();
  const [state, setState] = useState<ChapterWorkflowState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    if (!novelId || !chapter?.id) {
      setState(null);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await loadChapterWorkflow({ novelId, chapterId: chapter.id, authorizationId });
      if (request === epoch.current) setState(next);
    } catch (cause) {
      if (request === epoch.current) {
        setState(null);
        setError(cause instanceof Error ? cause.message : '章节流程读取失败，请重试。');
      }
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, [authorizationId, chapter?.id, novelId]);
  useEffect(() => {
    setState(null);
    void refresh();
    return () => {
      epoch.current += 1;
    };
  }, [chapter?.adoptedDraftId, chapter?.updatedAt, refresh]);
  const open = useCallback(
    (redo = false, returnToSource = false) => {
      if (!state || !novelId || loading) return;
      navigate('/', {
        state: {
          chapterWorkflow: {
            novelId,
            chapterId: state.chapter.id,
            adoptedDraftId: state.chapter.adoptedDraftId,
            destination: returnToSource ? 'source' : 'summary',
            conversationId: returnToSource ? state.sourceConversationId : state.conversationId,
            authorizationId,
            cardId: redo || returnToSource ? undefined : state.cardId,
            summaryCardId: returnToSource ? undefined : state.cardId,
            draft:
              !returnToSource && (redo || (!state.conversationId && state.phase !== 'unadopted'))
                ? chapterWorkflowDraft(state)
                : undefined,
          },
        },
      });
    },
    [authorizationId, loading, navigate, novelId, state],
  );
  const toggleSummary = useCallback(async () => {
    if (!state?.summary || loading) return;
    const summary = state.summary;
    const scope = epoch.current;
    setLoading(true);
    try {
      const [latest, currentChapter] = await Promise.all([
        chapterSummaryService.getByChapterId(state.chapter.id),
        chapterRepository.getById(state.chapter.id),
      ]);
      if (scope !== epoch.current) return;
      if (
        !latest ||
        latest.id !== summary.id ||
        latest.adoptedDraftId !== summary.adoptedDraftId ||
        latest.enabled !== summary.enabled ||
        latest.novelId !== state.chapter.novelId ||
        latest.chapterId !== state.chapter.id ||
        !currentChapter ||
        currentChapter.novelId !== state.chapter.novelId
      )
        throw new Error('章节总结已变化，请重新读取。');
      if (
        !latest.enabled &&
        (latest.isExpired || latest.adoptedDraftId !== currentChapter.adoptedDraftId)
      )
        throw new Error('此总结已过期，不能启用为当前采用稿的上下文。');
      await chapterSummaryService.setEnabled(summary.id, !summary.enabled);
      if (scope === epoch.current) await refresh();
    } catch (cause) {
      if (scope === epoch.current)
        setError(cause instanceof Error ? cause.message : '总结状态保存失败。');
    } finally {
      if (scope === epoch.current) setLoading(false);
    }
  }, [loading, refresh, state]);
  return { state, loading, error, refresh, open, toggleSummary };
}
