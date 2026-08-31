import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { Novel } from '../../../types/novel';
import type {
  TaskConversation,
  TaskConversationBundle,
  InitializedTaskConversation,
  TaskModelSnapshot,
} from '../../../types/conversation';
import { novelRepository } from '../../../services/database/novelRepository';
import { novelService } from '../../../services/novels/novelService';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { volumeRepository } from '../../../services/database/volumeRepository';
import { taskConversationService } from '../../../services/conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../../../services/conversation/taskModelSnapshot';
import { orderPlannedChapters } from '../../../services/conversation/workbenchChapterTarget';
import { startupCoordinator } from '../../../services/startup/startupCoordinator';
import {
  load as loadWorkbenchSelection,
  resolve as resolveWorkbenchSelection,
  save as saveWorkbenchSelection,
} from '../../../services/conversation/workbenchSelectionStore';
import { resolveConversationTargetChapter } from '../workbenchHelpers';

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isArchivedConversation(conversation: TaskConversation): boolean {
  return Boolean(conversation.archivedAt || conversation.status === 'archived');
}

export function useWorkbenchConversations() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [conversations, setConversations] = useState<TaskConversation[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [bundle, setBundle] = useState<TaskConversationBundle | null>(null);
  const [chapterId, setChapterId] = useState<string | undefined>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedModel, setSelectedModel] = useState<TaskModelSnapshot>(() =>
    captureTaskModelSnapshot(),
  );
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [conversationsError, setConversationsError] = useState('');
  const [chaptersError, setChaptersError] = useState('');

  const selectedNovelRef = useRef('');
  const selectedConversationRef = useRef('');
  const novelsRef = useRef<Novel[]>([]);
  const conversationsRef = useRef<TaskConversation[]>([]);
  const bundleRef = useRef<TaskConversationBundle | null>(null);
  const chaptersNovelRef = useRef('');
  const initialRequestRef = useRef(0);
  const chapterRequestRef = useRef(0);
  const bundleRequestRef = useRef(0);
  const selectionRevisionRef = useRef(0);
  const taskChapterSelectionRef = useRef(new Map<string, string>());

  const selectedNovel = novels.find((novel) => novel.id === selectedNovelId);
  const selectedChapter = chapters.find((chapter) => chapter.id === chapterId);

  useEffect(() => {
    novelsRef.current = novels;
  }, [novels]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const applyNovelSelection = useCallback((novelId: string) => {
    selectedNovelRef.current = novelId;
    setSelectedNovelId(novelId);
  }, []);

  const applyConversationSelection = useCallback((conversationId: string) => {
    selectedConversationRef.current = conversationId;
    setSelectedConversationId(conversationId);
  }, []);

  const clearBundle = useCallback(() => {
    bundleRequestRef.current += 1;
    bundleRef.current = null;
    setBundle(null);
    setBundleLoading(false);
  }, []);

  const refreshBundle = useCallback(async (conversationId: string) => {
    const requestId = ++bundleRequestRef.current;
    const replacingConversation = bundleRef.current?.conversation.conversationId !== conversationId;
    if (replacingConversation) setBundleLoading(true);
    setConversationsError('');

    try {
      await startupCoordinator.waitForConversationRecovery();
      const next = await taskConversationService.get(conversationId);
      if (!next) throw new Error('创作任务内容不存在或已移除。');
      if (
        requestId !== bundleRequestRef.current ||
        selectedConversationRef.current !== conversationId
      ) {
        return;
      }
      bundleRef.current = next;
      setBundle(next);
      setSelectedModel(next.conversation.defaultModel ?? captureTaskModelSnapshot());
      const targetChapterId =
        taskChapterSelectionRef.current.get(conversationId) ??
        resolveConversationTargetChapter(next);
      if (targetChapterId) {
        taskChapterSelectionRef.current.set(conversationId, targetChapterId);
        setChapterId(targetChapterId);
      }
    } catch (error) {
      if (
        requestId === bundleRequestRef.current &&
        selectedConversationRef.current === conversationId
      ) {
        bundleRef.current = null;
        setBundle(null);
        setConversationsError(readableError(error, '创作任务读取失败，请重试。'));
      }
    } finally {
      if (requestId === bundleRequestRef.current && replacingConversation) {
        setBundleLoading(false);
      }
    }
  }, []);

  const loadChaptersForNovel = useCallback(async (novelId: string) => {
    const requestId = ++chapterRequestRef.current;
    chaptersNovelRef.current = '';
    setChapters([]);
    setChapterId(undefined);
    setChaptersLoading(true);
    setChaptersError('');

    try {
      const [chapterItems, volumes] = await Promise.all([
        chapterRepository.getByNovelId(novelId),
        volumeRepository.getByNovelId(novelId),
      ]);
      const novelChapters = orderPlannedChapters(chapterItems, volumes);
      if (requestId !== chapterRequestRef.current || selectedNovelRef.current !== novelId) {
        return null;
      }
      const current = novelsRef.current.find((novel) => novel.id === novelId);
      const rememberedChapterId = taskChapterSelectionRef.current.get(
        selectedConversationRef.current,
      );
      const nextChapterId = novelChapters.some((chapter) => chapter.id === rememberedChapterId)
        ? rememberedChapterId
        : novelChapters.some((chapter) => chapter.id === current?.currentChapterId)
          ? current?.currentChapterId
          : novelChapters[0]?.id;
      chaptersNovelRef.current = novelId;
      setChapters(novelChapters);
      setChapterId(nextChapterId);
      return { chapters: novelChapters, chapterId: nextChapterId };
    } catch (error) {
      if (requestId === chapterRequestRef.current && selectedNovelRef.current === novelId) {
        setChaptersError(readableError(error, '章节列表读取失败，请稍后重试。'));
      }
      return null;
    } finally {
      if (requestId === chapterRequestRef.current) setChaptersLoading(false);
    }
  }, []);

  const loadConversations = useCallback(
    async (novelId?: string) => {
      setConversationsLoading(true);
      setConversationsError('');
      try {
        await startupCoordinator.waitForConversationRecovery();
        const items = await taskConversationService.list(novelId, { includeArchived: true });
        const next = novelId
          ? [...conversationsRef.current.filter((item) => item.novelId !== novelId), ...items].sort(
              (left, right) => right.updatedAt.localeCompare(left.updatedAt),
            )
          : items;
        conversationsRef.current = next;
        setConversations(next);

        const activeNovelId = selectedNovelRef.current;
        const activeConversationId = selectedConversationRef.current;
        const selectedStillVisible = next.some(
          (item) => item.conversationId === activeConversationId,
        );
        if (activeNovelId && (!activeConversationId || !selectedStillVisible)) {
          const firstConversation = next.find(
            (item) => item.novelId === activeNovelId && !isArchivedConversation(item),
          );
          applyConversationSelection(firstConversation?.conversationId ?? '');
          setSelectedModel(firstConversation?.defaultModel ?? captureTaskModelSnapshot());
          clearBundle();
          if (firstConversation) void refreshBundle(firstConversation.conversationId);
        }
      } catch (error) {
        setConversationsError(readableError(error, '创作任务列表读取失败，请重试。'));
      } finally {
        setConversationsLoading(false);
      }
    },
    [applyConversationSelection, clearBundle, refreshBundle],
  );

  const loadInitialData = useCallback(async () => {
    const requestId = ++initialRequestRef.current;
    const selectionRevision = selectionRevisionRef.current;
    setProjectsLoading(true);
    setConversationsLoading(true);
    setProjectsError('');
    setConversationsError('');
    setChaptersError('');
    clearBundle();

    const conversationsResultPromise = startupCoordinator
      .waitForConversationRecovery()
      .then(() => taskConversationService.list(undefined, { includeArchived: true }))
      .then(
        (value) => ({ value }) as const,
        (error: unknown) => ({ error }) as const,
      );

    try {
      const items = await novelRepository.getAll();
      if (requestId !== initialRequestRef.current) return;
      novelsRef.current = items;
      setNovels(items);
      setProjectsLoading(false);

      if (items.length === 0) {
        applyNovelSelection('');
        applyConversationSelection('');
        setConversations([]);
        setConversationsLoading(false);
        setChapters([]);
        setChapterId(undefined);
        return;
      }

      const conversationResult = await conversationsResultPromise;
      if (requestId !== initialRequestRef.current) return;

      const conversationItems = 'value' in conversationResult ? conversationResult.value : [];
      conversationsRef.current = conversationItems;
      setConversations(conversationItems);
      setConversationsLoading(false);
      if ('error' in conversationResult) {
        setConversationsError(
          readableError(conversationResult.error, '创作任务恢复失败，请重试。'),
        );
      }

      const selectionChanged = selectionRevisionRef.current !== selectionRevision;
      const resolvedSelection = resolveWorkbenchSelection(
        items,
        conversationItems,
        loadWorkbenchSelection(),
      );
      const selectedDuringLoad = selectionChanged
        ? {
            novelId: selectedNovelRef.current,
            conversationId: selectedConversationRef.current || undefined,
          }
        : null;
      const targetSelection = selectedDuringLoad?.novelId ? selectedDuringLoad : resolvedSelection;
      const initialNovel = items.find((novel) => novel.id === targetSelection?.novelId) ?? items[0];
      const selectedConversation = conversationItems.find(
        (conversation) =>
          conversation.conversationId === targetSelection?.conversationId &&
          conversation.novelId === initialNovel.id &&
          !isArchivedConversation(conversation),
      );
      const initialConversation =
        selectedConversation ??
        (selectionChanged
          ? conversationItems.find(
              (conversation) =>
                conversation.novelId === initialNovel.id && !isArchivedConversation(conversation),
            )
          : undefined);
      applyNovelSelection(initialNovel.id);
      applyConversationSelection(initialConversation?.conversationId ?? '');
      setSelectedModel(initialConversation?.defaultModel ?? captureTaskModelSnapshot());
      saveWorkbenchSelection({
        novelId: initialNovel.id,
        conversationId: initialConversation?.conversationId,
      });

      if (initialConversation) void refreshBundle(initialConversation.conversationId);
      await loadChaptersForNovel(initialNovel.id);
    } catch (error) {
      if (requestId !== initialRequestRef.current) return;
      setProjectsError(readableError(error, '小说项目读取失败，请重试。'));
      setProjectsLoading(false);
      setConversationsLoading(false);
      setChaptersLoading(false);
    }
  }, [
    applyConversationSelection,
    applyNovelSelection,
    clearBundle,
    loadChaptersForNovel,
    refreshBundle,
  ]);

  useEffect(() => {
    void loadInitialData();
    return () => {
      initialRequestRef.current += 1;
      chapterRequestRef.current += 1;
      bundleRequestRef.current += 1;
    };
  }, [loadInitialData]);

  const selectProject = useCallback(
    (novelId: string) => {
      if (!novelId) return;
      selectionRevisionRef.current += 1;
      const nextConversation = conversationsRef.current.find(
        (conversation) => conversation.novelId === novelId && !isArchivedConversation(conversation),
      );
      applyNovelSelection(novelId);
      applyConversationSelection(nextConversation?.conversationId ?? '');
      setSelectedModel(nextConversation?.defaultModel ?? captureTaskModelSnapshot());
      saveWorkbenchSelection({
        novelId,
        conversationId: nextConversation?.conversationId,
      });
      clearBundle();
      if (chaptersNovelRef.current !== novelId) void loadChaptersForNovel(novelId);
      if (nextConversation) void refreshBundle(nextConversation.conversationId);
    },
    [
      applyConversationSelection,
      applyNovelSelection,
      clearBundle,
      loadChaptersForNovel,
      refreshBundle,
    ],
  );

  const selectTask = useCallback(
    (novelId: string, conversationId: string) => {
      if (!novelId || !conversationId) return;
      selectionRevisionRef.current += 1;
      const novelChanged = selectedNovelRef.current !== novelId;
      const conversationChanged = selectedConversationRef.current !== conversationId;
      applyNovelSelection(novelId);
      applyConversationSelection(conversationId);
      const selected = conversationsRef.current.find(
        (conversation) => conversation.conversationId === conversationId,
      );
      setSelectedModel(selected?.defaultModel ?? captureTaskModelSnapshot());
      if (selected && !isArchivedConversation(selected)) {
        saveWorkbenchSelection({ novelId, conversationId });
      }
      const rememberedChapterId = taskChapterSelectionRef.current.get(conversationId);
      if (!novelChanged && rememberedChapterId) setChapterId(rememberedChapterId);
      if (conversationChanged) {
        clearBundle();
        void refreshBundle(conversationId);
      }
      if (novelChanged || chaptersNovelRef.current !== novelId) {
        void loadChaptersForNovel(novelId);
      }
    },
    [
      applyConversationSelection,
      applyNovelSelection,
      clearBundle,
      loadChaptersForNovel,
      refreshBundle,
    ],
  );

  const selectChapter = useCallback(
    async (nextChapterId: string) => {
      const value = nextChapterId.trim();
      setChapterId(value || undefined);
      const conversationId = selectedConversationRef.current;
      if (conversationId) {
        if (value) taskChapterSelectionRef.current.set(conversationId, value);
        else taskChapterSelectionRef.current.delete(conversationId);
      }
      if (!selectedNovelId || !value) return;
      try {
        const updated = await novelService.updateNovel(selectedNovelId, {
          currentChapterId: value,
        });
        if (updated) {
          setNovels((current) =>
            current.map((novel) => (novel.id === updated.id ? updated : novel)),
          );
        }
      } catch {
        // Keep the in-session chapter selection when persistence is temporarily unavailable.
      }
    },
    [selectedNovelId],
  );

  async function createTask(
    goal: string,
    initialModel: TaskModelSnapshot = selectedModel,
  ): Promise<InitializedTaskConversation | null> {
    const normalizedGoal = goal.trim();
    if (!selectedNovelId || !normalizedGoal || creatingTask) return null;
    setCreatingTask(true);
    setConversationsError('');
    try {
      await startupCoordinator.waitForConversationRecovery();
      const initialized = await taskConversationService.createInitialized(
        selectedNovelId,
        normalizedGoal,
        initialModel,
      );
      const created = initialized.conversation;
      setConversations((current) => {
        const next = [
          created,
          ...current.filter((item) => item.conversationId !== created.conversationId),
        ];
        conversationsRef.current = next;
        return next;
      });
      selectTask(created.novelId, created.conversationId);
      return initialized;
    } catch (error) {
      setConversationsError(readableError(error, '新建创作任务失败，请重试。'));
      throw error;
    } finally {
      setCreatingTask(false);
    }
  }

  async function renameTask(conversationId: string, title: string) {
    setConversationsError('');
    try {
      const updated = await taskConversationService.rename(conversationId, title);
      setConversations((current) => {
        const next = current
          .map((item) => (item.conversationId === conversationId ? updated : item))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        conversationsRef.current = next;
        return next;
      });
      if (selectedConversationRef.current === conversationId) {
        await refreshBundle(conversationId);
      }
    } catch (error) {
      setConversationsError(readableError(error, '任务重命名失败，请重试。'));
      throw error;
    }
  }

  async function setTaskArchived(conversationId: string, archived: boolean) {
    setConversationsError('');
    try {
      const updated = await taskConversationService.setArchived(conversationId, archived);
      const next = conversationsRef.current
        .map((item) => (item.conversationId === conversationId ? updated : item))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      conversationsRef.current = next;
      setConversations(next);

      if (archived && selectedConversationRef.current === conversationId) {
        const fallback = next.find(
          (item) => item.novelId === updated.novelId && !isArchivedConversation(item),
        );
        applyConversationSelection(fallback?.conversationId ?? '');
        saveWorkbenchSelection({
          novelId: updated.novelId,
          conversationId: fallback?.conversationId,
        });
        clearBundle();
        if (fallback) void refreshBundle(fallback.conversationId);
      }
    } catch (error) {
      setConversationsError(
        readableError(error, archived ? '任务归档失败，请重试。' : '任务恢复失败，请重试。'),
      );
      throw error;
    }
  }

  return {
    novels,
    conversations,
    setConversations,
    selectedNovelId,
    selectedConversationId,
    bundle,
    chapterId,
    selectChapter,
    chapters,
    selectedModel,
    setSelectedModel,
    projectsLoading,
    conversationsLoading,
    bundleLoading,
    chaptersLoading,
    creatingTask,
    projectsError,
    conversationsError,
    chaptersError,
    selectedNovel,
    selectedChapter,
    selectedNovelRef,
    selectProject,
    selectTask,
    loadConversations,
    reloadChapters: loadChaptersForNovel,
    loadInitialData,
    refreshBundle,
    createTask,
    renameTask,
    setTaskArchived,
  };
}
