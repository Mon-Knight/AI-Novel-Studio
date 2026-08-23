import { useEffect, useMemo, useState } from 'react';
import type { TaskConversation, TaskModelSnapshot } from '../../../types/conversation';
import { taskConversationService } from '../../../services/conversation/taskConversationService';
import { taskSessionAdapter } from '../../../services/dsh/taskSessionAdapter';
import { findTaskTargetConflict } from '../../../services/conversation/taskGoalRouting';
import { formatWorkbenchFailure } from '../../../services/conversation/workbenchFailure';

export function useWorkbenchTaskRunner(input: {
  selectedNovelId: string;
  selectedConversationId: string;
  chapterId: string | undefined;
  conversations: TaskConversation[];
  setConversations: React.Dispatch<React.SetStateAction<TaskConversation[]>>;
  selectedModel: TaskModelSnapshot;
  selectedNovelRef: React.MutableRefObject<string>;
  refreshBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId?: string) => Promise<void>;
  refreshPlugins: (conversationId?: string) => Promise<void>;
}) {
  const {
    selectedNovelId,
    selectedConversationId,
    chapterId,
    conversations,
    setConversations,
    selectedModel,
    selectedNovelRef,
    refreshBundle,
    loadConversations,
    refreshPlugins,
  } = input;

  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState('');
  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(
    () => new Set(),
  );

  const targetConflict = useMemo(
    () =>
      findTaskTargetConflict({
        novelId: selectedNovelId,
        chapterId,
        conversationId: selectedConversationId,
        goal: draft,
        peers: conversations
          .filter((conversation) => runningConversationIds.has(conversation.conversationId))
          .map((conversation) => ({
            conversationId: conversation.conversationId,
            novelId: conversation.novelId,
            title: conversation.title,
            chapterId,
          })),
      }),
    [
      chapterId,
      conversations,
      draft,
      runningConversationIds,
      selectedConversationId,
      selectedNovelId,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const refreshRunning = async () => {
      try {
        const ids = await taskSessionAdapter.listRunningConversationIds();
        if (!cancelled) {
          setRunningConversationIds((current) => {
            const next = new Set(ids);
            current.forEach((id) => {
              if (taskSessionAdapter.isRunning(id)) next.add(id);
            });
            return next;
          });
        }
      } catch {
        if (!cancelled) return;
      }
    };
    void refreshRunning();
    const timer = window.setInterval(() => void refreshRunning(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function sendMessage(messageOverride?: string) {
    const message = (messageOverride ?? draft).trim();
    const conversationId = selectedConversationId;
    if (
      !message ||
      !selectedNovelId ||
      !conversationId ||
      runningConversationIds.has(conversationId)
    ) {
      return;
    }
    const novelId = selectedNovelId;
    setComposerError('');
    setRunningConversationIds((current) => new Set(current).add(conversationId));
    setDraft('');
    try {
      const turn = await taskConversationService.appendTurn(conversationId, 'user', message);
      await refreshBundle(conversationId);
      await taskSessionAdapter.startTurn(
        {
          conversationId,
          novelId,
          chapterId,
          turnId: turn.turnId,
          goal: message,
          modelSnapshot: selectedModel,
        },
        ({ run }) => {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.conversationId === conversationId
                ? {
                    ...conversation,
                    status:
                      run.status === 'completed'
                        ? 'completed'
                        : run.status === 'failed'
                          ? 'failed'
                          : run.status === 'cancelled'
                            ? 'idle'
                            : 'running',
                    updatedAt: run.updatedAt,
                  }
                : conversation,
            ),
          );
          void refreshBundle(conversationId);
        },
      );
      await refreshBundle(conversationId);
      if (selectedNovelRef.current === novelId) await loadConversations(novelId);
    } catch (error) {
      setComposerError(formatWorkbenchFailure(error));
      await refreshBundle(conversationId);
      if (selectedNovelRef.current === novelId) await loadConversations(novelId);
    } finally {
      void refreshPlugins(conversationId);
      setRunningConversationIds((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
    }
  }

  function cancelTask() {
    if (selectedConversationId) taskSessionAdapter.cancel(selectedConversationId);
  }

  const selectedConversationRunning = selectedConversationId
    ? runningConversationIds.has(selectedConversationId) ||
      taskSessionAdapter.isRunning(selectedConversationId)
    : false;

  return {
    draft,
    setDraft,
    composerError,
    setComposerError,
    runningConversationIds,
    targetConflict,
    selectedConversationRunning,
    sendMessage,
    cancelTask,
  };
}
