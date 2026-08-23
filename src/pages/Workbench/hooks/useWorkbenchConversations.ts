import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { Novel } from '../../../types/novel';
import type {
  TaskConversation,
  TaskConversationBundle,
  TaskModelSnapshot,
} from '../../../types/conversation';
import { novelRepository } from '../../../services/database/novelRepository';
import { novelService } from '../../../services/novels/novelService';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { taskConversationService } from '../../../services/conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../../../services/conversation/taskModelSnapshot';
import { getCurrentPluginProjection } from '../../../services/conversation/currentPluginService';

export function useWorkbenchConversations(input: {
  setPlugins: (
    plugins: import('../../../services/conversation/currentPluginService').CurrentPluginProjection[],
  ) => void;
}) {
  const { setPlugins } = input;
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
  const [loading, setLoading] = useState(true);
  const selectedNovelRef = useRef('');
  const selectedConversationRef = useRef('');

  const selectedNovel = novels.find((novel) => novel.id === selectedNovelId);
  const selectedChapter = chapters.find((chapter) => chapter.id === chapterId);

  const selectNovel = useCallback((novelId: string) => {
    selectedNovelRef.current = novelId;
    setSelectedNovelId(novelId);
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    selectedConversationRef.current = conversationId;
    setSelectedConversationId(conversationId);
  }, []);

  const loadConversations = useCallback(
    async (novelId?: string) => {
      const items = await taskConversationService.list(novelId);
      setConversations((current) => {
        if (!novelId) return items;
        return [...current.filter((item) => item.novelId !== novelId), ...items].sort(
          (left, right) => right.updatedAt.localeCompare(left.updatedAt),
        );
      });
      const selectedId = selectedConversationRef.current;
      const selectedStillVisible = items.some((item) => item.conversationId === selectedId);
      if (!selectedId || (!selectedStillVisible && !novelId)) {
        const next = items[0];
        if (next) {
          selectNovel(next.novelId);
          selectConversation(next.conversationId);
        } else {
          selectConversation('');
          setBundle(null);
        }
      }
    },
    [selectConversation, selectNovel],
  );

  const refreshBundle = useCallback(async (conversationId: string) => {
    const next = await taskConversationService.get(conversationId);
    if (selectedConversationRef.current !== conversationId) return;
    setBundle(next);
    if (next?.conversation.defaultModel) setSelectedModel(next.conversation.defaultModel);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      return Promise.all([novelRepository.getAll(), getCurrentPluginProjection()]);
    })()
      .then(async ([items, currentPlugins]) => {
        if (cancelled) return;
        setNovels(items);
        setPlugins(currentPlugins);
        const first = items[0];
        if (!first) {
          setLoading(false);
          return;
        }
        selectNovel(first.id);
        const novelChapters = await chapterRepository.getByNovelId(first.id);
        setChapters(novelChapters);
        setChapterId(first.currentChapterId ?? novelChapters[0]?.id);
        await loadConversations();
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [loadConversations, selectNovel, setPlugins]);

  useEffect(() => {
    if (!selectedConversationId) return;
    void refreshBundle(selectedConversationId);
  }, [refreshBundle, selectedConversationId]);

  useEffect(() => {
    if (!selectedNovelId) return;
    void chapterRepository.getByNovelId(selectedNovelId).then((novelChapters) => {
      const current = novels.find((novel) => novel.id === selectedNovelId);
      setChapters(novelChapters);
      setChapterId(current?.currentChapterId ?? novelChapters[0]?.id);
    });
  }, [novels, selectedNovelId]);

  async function selectChapter(nextChapterId: string) {
    const value = nextChapterId.trim();
    setChapterId(value || undefined);
    if (!selectedNovelId || !value) return;
    try {
      const updated = await novelService.updateNovel(selectedNovelId, { currentChapterId: value });
      if (updated) {
        setNovels((current) => current.map((novel) => (novel.id === updated.id ? updated : novel)));
      }
    } catch {
      // Binding is still applied in-session even if persistence fails.
    }
  }

  async function createTask() {
    if (!selectedNovelId) return;
    const created = await taskConversationService.create(
      selectedNovelId,
      '新的创作任务',
      selectedModel,
    );
    selectConversation(created.conversationId);
    await loadConversations(selectedNovelId);
    await refreshBundle(created.conversationId);
  }

  return {
    novels,
    conversations,
    setConversations,
    selectedNovelId,
    selectedConversationId,
    bundle,
    setBundle,
    chapterId,
    setChapterId,
    selectChapter,
    chapters,
    selectedModel,
    setSelectedModel,
    loading,
    selectedNovel,
    selectedChapter,
    selectedNovelRef,
    selectedConversationRef,
    selectNovel,
    selectConversation,
    loadConversations,
    refreshBundle,
    createTask,
  };
}
