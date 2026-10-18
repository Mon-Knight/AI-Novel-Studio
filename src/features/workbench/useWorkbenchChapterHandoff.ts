import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Chapter } from '../../types/chapter';
import type { TaskConversationBundle } from '../../types/conversation';
import {
  loadChapterWorkflow,
  type ChapterWorkflowHandoff,
} from '../../services/conversation/chapterWorkflowService';

interface Input {
  loading: boolean;
  selectedNovelId: string;
  selectedConversationId: string;
  chapters: Chapter[];
  bundle: TaskConversationBundle | null;
  draft: string;
  hasRevisionSource?: boolean;
  selectProject(novelId: string): void;
  selectTask(novelId: string, conversationId: string): void;
  selectChapter(chapterId: string): Promise<void>;
  openTaskCreator(goal?: string, chapterId?: string): void;
  setDraft(value: string): void;
  setError(value: string): void;
  locateArtifact(cardId: string): void;
}

/** Validates a one-shot editor handoff before selecting its exact task and chapter. Never sends. */
export function useWorkbenchChapterHandoff(input: Input) {
  const location = useLocation();
  const navigate = useNavigate();
  const latest = useRef(input);
  latest.current = input;
  const [validated, setValidated] = useState<{ key: string; request: ChapterWorkflowHandoff }>();
  const consumed = useRef('');
  const locationKey = useRef(location.key);
  locationKey.current = location.key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const request = (location.state as { chapterWorkflow?: ChapterWorkflowHandoff } | null)
    ?.chapterWorkflow;
  useEffect(() => {
    if (!request || consumed.current === location.key) return;
    let cancelled = false;
    void loadChapterWorkflow(request)
      .then((state) => {
        if (cancelled) return;
        if (request.adoptedDraftId && state.chapter.adoptedDraftId !== request.adoptedDraftId) {
          throw new Error('本章采用稿已变化，请返回章节重新打开总结。');
        }
        const conversationId =
          request.destination === 'source' ? state.sourceConversationId : state.conversationId;
        if (request.destination === 'source' && !conversationId)
          throw new Error('本章来源任务无法核对，请重新从章节候选打开审阅。');
        if (request.conversationId && request.conversationId !== conversationId) {
          throw new Error('本章总结来源已变化，请重新读取章节流程。');
        }
        setValidated({
          key: location.key,
          request: {
            ...request,
            conversationId,
            cardId: request.cardId ? state.cardId : undefined,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        consumed.current = location.key;
        latest.current.setError(error instanceof Error ? error.message : '章节任务定位失败。');
        navigate(location.pathname, { replace: true, state: null });
      });
    return () => {
      cancelled = true;
    };
  }, [location.key, location.pathname, navigate, request]);

  useEffect(() => {
    if (
      !validated ||
      validated.key !== location.key ||
      consumed.current === location.key ||
      input.loading
    )
      return;
    const target = validated.request;
    if (input.selectedNovelId !== target.novelId) {
      input.selectProject(target.novelId);
      return;
    }
    if (target.conversationId && input.selectedConversationId !== target.conversationId) {
      input.selectTask(target.novelId, target.conversationId);
      return;
    }
    if (
      target.conversationId &&
      input.bundle?.conversation.conversationId !== target.conversationId
    )
      return;
    consumed.current = location.key;
    const chapter = input.chapters.find(
      (item) => item.id === target.chapterId && item.novelId === target.novelId,
    );
    if (!chapter) {
      input.setError('来源章节已不可用，请重新选择章节。');
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (target.adoptedDraftId && chapter.adoptedDraftId !== target.adoptedDraftId) {
      input.setError('本章采用稿已变化，请返回章节重新打开总结。');
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    const key = location.key;
    const isCurrent = () =>
      mounted.current &&
      locationKey.current === key &&
      latest.current.selectedNovelId === target.novelId &&
      (!target.conversationId || latest.current.selectedConversationId === target.conversationId);
    void input
      .selectChapter(target.chapterId)
      .then(() => {
        if (!isCurrent()) return;
        const current = latest.current;
        if (!target.conversationId) current.openTaskCreator(target.draft, target.chapterId);
        else {
          if (target.draft) {
            if (
              current.hasRevisionSource ||
              (current.draft.trim() && current.draft !== target.draft)
            )
              current.setError(
                `已定位本章总结。输入框保留了未发送内容及修订来源；处理后可发送：${target.draft}`,
              );
            else current.setDraft(target.draft);
          }
          if (target.cardId) current.locateArtifact(target.cardId);
        }
        navigate(location.pathname, { replace: true, state: null });
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        latest.current.setError(
          error instanceof Error ? error.message : '章节选择未保存，请重试。',
        );
        navigate(location.pathname, { replace: true, state: null });
      });
  }, [input, location.key, location.pathname, navigate, validated]);
}
