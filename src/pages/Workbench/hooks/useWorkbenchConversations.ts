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
import { useWorkbenchConversationDirectory } from '../../../features/workbench/useWorkbenchConversationDirectory';
import { useWorkbenchConversationBundle } from './useWorkbenchConversationBundle';
import {
  findConversationById,
  findFirstActiveConversation,
  isArchivedConversation,
  mergeConversationDirectoryItems,
  resolveChapterSelection,
  resolveInitialConversationSelection,
  resolvePreferredTaskRecovery,
  resolveProjectSelection,
  updateConversationInDirectory,
} from '../workbenchConversationSelection';

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function useWorkbenchConversations() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [conversations, setConversations] = useState<TaskConversation[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [chapterId, setChapterId] = useState<string | undefined>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedModel, setSelectedModel] = useState<TaskModelSnapshot>(() =>
    captureTaskModelSnapshot(),
  );
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [initialDirectoryLoading, setInitialDirectoryLoading] = useState(true);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [conversationsError, setConversationsError] = useState('');
  const [selectionRecoveryError, setSelectionRecoveryError] = useState('');
  const [chaptersError, setChaptersError] = useState('');

  const selectedNovelRef = useRef('');
  const selectedConversationRef = useRef('');
  const novelsRef = useRef<Novel[]>([]);
  const conversationsRef = useRef<TaskConversation[]>([]);
  const chaptersNovelRef = useRef('');
  const initialRequestRef = useRef(0);
  const chapterRequestRef = useRef(0);
  const selectionRevisionRef = useRef(0);
  const taskChapterSelectionRef = useRef(new Map<string, string>());
  const recentTaskByProjectRef = useRef(new Map<string, string>());

  const mergeDirectoryItems = useCallback((items: TaskConversation[]) => {
    const next = mergeConversationDirectoryItems(conversationsRef.current, items);
    conversationsRef.current = next;
    setConversations(next);
  }, []);
  const directory = useWorkbenchConversationDirectory(mergeDirectoryItems);
  const refreshDirectory = directory.refresh;

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
    if (conversationId && selectedNovelRef.current) {
      recentTaskByProjectRef.current.set(selectedNovelRef.current, conversationId);
    }
    setSelectedConversationId(conversationId);
  }, []);

  const onBundleLoaded = useCallback(
    (next: TaskConversationBundle, page: { hasNewer: boolean }) => {
      setSelectedModel(next.conversation.defaultModel ?? captureTaskModelSnapshot());
      if (page.hasNewer) return;
      const conversationId = next.conversation.conversationId;
      const remembered = taskChapterSelectionRef.current.get(conversationId);
      const targetChapterId = remembered ?? resolveConversationTargetChapter(next);
      if (!targetChapterId) return;
      taskChapterSelectionRef.current.set(conversationId, targetChapterId);
      setChapterId(targetChapterId);
    },
    [],
  );
  const {
    bundle,
    bundleLoading,
    bundleStaleError,
    historyHasOlder,
    historyHasNewer,
    historyExpandToken,
    refreshBundle,
    loadOlderHistory,
    loadLatestHistory,
    ensureArtifactLoaded,
    clearBundle,
    invalidate: invalidateBundleRequests,
    applyConversationUpdate: applyBundleConversationUpdate,
  } = useWorkbenchConversationBundle({
    selectedConversationRef,
    selectedNovelRef,
    setConversationsError,
    onLoaded: onBundleLoaded,
  });

  const applyConversationUpdate = useCallback(
    (updated: TaskConversation) => {
      const next = updateConversationInDirectory(
        conversationsRef.current,
        updated.conversationId,
        updated,
      );
      conversationsRef.current = next;
      setConversations(next);
      if (selectedConversationRef.current === updated.conversationId) {
        setSelectedModel(updated.defaultModel ?? captureTaskModelSnapshot());
        applyBundleConversationUpdate(updated);
      }
    },
    [applyBundleConversationUpdate],
  );

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
      const nextChapterId = resolveChapterSelection(
        novelChapters,
        taskChapterSelectionRef.current.get(selectedConversationRef.current),
        novelsRef.current.find((novel) => novel.id === novelId)?.currentChapterId,
      );
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
        if ((await refreshDirectory()) === null) return;
        const next = conversationsRef.current;

        const activeNovelId = selectedNovelRef.current;
        const activeConversationId = selectedConversationRef.current;
        if (activeNovelId && !activeConversationId && (!novelId || novelId === activeNovelId)) {
          const firstConversation = findFirstActiveConversation(next, activeNovelId);
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
    [applyConversationSelection, clearBundle, refreshBundle, refreshDirectory],
  );

  const loadInitialData = useCallback(async () => {
    const requestId = ++initialRequestRef.current;
    const selectionRevision = selectionRevisionRef.current;
    setProjectsLoading(true);
    setInitialDirectoryLoading(true);
    setConversationsLoading(true);
    setProjectsError('');
    setSelectionRecoveryError('');
    setConversationsError('');
    setChaptersError('');
    clearBundle();

    const conversationsResultPromise = startupCoordinator
      .waitForConversationRecovery()
      .then(() => refreshDirectory())
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
      if ('value' in conversationResult && conversationResult.value === null) {
        setConversationsLoading(false);
        return;
      }

      const conversationItems =
        'value' in conversationResult ? [...(conversationResult.value ?? [])] : [];
      const preference = loadWorkbenchSelection();
      let preferredReadError = '';
      const recovery = resolvePreferredTaskRecovery(items, conversationItems, preference);
      if (recovery) {
        let preferred: TaskConversationBundle | null = null;
        try {
          preferred = await taskConversationService.get(recovery.conversationId, {
            hydrateArtifacts: false,
          });
        } catch (error) {
          preferredReadError = readableError(error, '最近任务暂时读取失败，请重试任务恢复。');
        }
        if (requestId !== initialRequestRef.current) return;
        if (
          preferred?.conversation.novelId === recovery.novelId &&
          !isArchivedConversation(preferred.conversation)
        ) {
          conversationItems.push(preferred.conversation);
        }
      }
      conversationsRef.current = conversationItems;
      setConversations(conversationItems);
      setConversationsLoading(false);
      if ('error' in conversationResult) {
        setConversationsError(
          readableError(conversationResult.error, '创作任务恢复失败，请重试。'),
        );
      } else if (preferredReadError) {
        setSelectionRecoveryError(`最近任务恢复失败：${preferredReadError}`);
      }

      const selectionChanged = selectionRevisionRef.current !== selectionRevision;
      const initialSelection = resolveInitialConversationSelection({
        novels: items,
        conversations: conversationItems,
        resolvedSelection: resolveWorkbenchSelection(items, conversationItems, preference),
        selectedDuringLoad: selectionChanged
          ? {
              novelId: selectedNovelRef.current,
              conversationId: selectedConversationRef.current || undefined,
            }
          : null,
        selectionChanged,
      });
      const { novel: initialNovel, conversation: initialConversation } = initialSelection;
      applyNovelSelection(initialNovel.id);
      applyConversationSelection(initialConversation?.conversationId ?? '');
      setSelectedModel(initialConversation?.defaultModel ?? captureTaskModelSnapshot());
      if (!preferredReadError)
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
    } finally {
      if (requestId === initialRequestRef.current) setInitialDirectoryLoading(false);
    }
  }, [
    applyConversationSelection,
    applyNovelSelection,
    clearBundle,
    loadChaptersForNovel,
    refreshBundle,
    refreshDirectory,
  ]);

  useEffect(() => {
    void loadInitialData();
    return () => {
      initialRequestRef.current += 1;
      chapterRequestRef.current += 1;
      invalidateBundleRequests();
    };
  }, [invalidateBundleRequests, loadInitialData]);

  const selectProject = useCallback(
    (novelId: string) => {
      const selection = resolveProjectSelection(
        novelId,
        selectedNovelRef.current,
        selectedConversationRef.current,
        conversationsRef.current,
        recentTaskByProjectRef.current,
      );
      if (!selection) return;
      const { conversation: nextConversation, preference } = selection;
      setSelectionRecoveryError('');
      selectionRevisionRef.current += 1;
      applyNovelSelection(novelId);
      applyConversationSelection(nextConversation?.conversationId ?? '');
      setSelectedModel(nextConversation?.defaultModel ?? captureTaskModelSnapshot());
      saveWorkbenchSelection(preference);
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
      setSelectionRecoveryError('');
      selectionRevisionRef.current += 1;
      const novelChanged = selectedNovelRef.current !== novelId;
      const conversationChanged = selectedConversationRef.current !== conversationId;
      applyNovelSelection(novelId);
      applyConversationSelection(conversationId);
      const selected = findConversationById(conversationsRef.current, conversationId);
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
      void refreshDirectory().catch(() => undefined);
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
        const next = updateConversationInDirectory(current, conversationId, updated);
        conversationsRef.current = next;
        return next;
      });
      if (selectedConversationRef.current === conversationId) {
        await refreshBundle(conversationId);
      }
      await refreshDirectory();
    } catch (error) {
      setConversationsError(readableError(error, '任务重命名失败，请重试。'));
      throw error;
    }
  }

  async function setTaskArchived(conversationId: string, archived: boolean) {
    setConversationsError('');
    try {
      const updated = await taskConversationService.setArchived(conversationId, archived);
      const next = updateConversationInDirectory(conversationsRef.current, conversationId, updated);
      conversationsRef.current = next;
      setConversations(next);

      if (archived && selectedConversationRef.current === conversationId) {
        const fallback = findFirstActiveConversation(next, updated.novelId);
        applyConversationSelection(fallback?.conversationId ?? '');
        saveWorkbenchSelection({
          novelId: updated.novelId,
          conversationId: fallback?.conversationId,
        });
        clearBundle();
        if (fallback) void refreshBundle(fallback.conversationId);
      }
      await refreshDirectory();
    } catch (error) {
      setConversationsError(
        readableError(error, archived ? '任务归档失败，请重试。' : '任务恢复失败，请重试。'),
      );
      throw error;
    }
  }

  return {
    novels,
    directory: { ...directory, initializing: initialDirectoryLoading },
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
    applyConversationUpdate,
    projectsLoading,
    conversationsLoading,
    bundleLoading,
    chaptersLoading,
    creatingTask,
    projectsError,
    conversationsError: selectionRecoveryError || conversationsError,
    chaptersError,
    selectedNovel,
    selectedChapter,
    selectedNovelRef,
    selectedConversationRef,
    selectProject,
    selectTask,
    loadConversations,
    reloadChapters: loadChaptersForNovel,
    loadInitialData,
    refreshBundle,
    bundleStaleError,
    historyHasOlder,
    historyHasNewer,
    historyExpandToken,
    loadOlderHistory,
    loadLatestHistory,
    ensureArtifactLoaded,
    createTask,
    renameTask,
    setTaskArchived,
  };
}
