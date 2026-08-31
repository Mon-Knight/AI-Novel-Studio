import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chapterAssetReadinessService,
  chapterAssetRecoveryStore,
  reconcileChapterAssetOrchestration,
  type ChapterAssetOrchestration,
  type ChapterAssetRecovery,
} from '../../../services/conversation/chapterAssetReadiness';
import { recoverPersistedChapterAssetRecovery } from '../../../services/conversation/chapterAssetRecoveryPersistence';
import type { TaskConversationBundle, TaskModelSnapshot } from '../../../types/conversation';
import { useConversationScopedState } from './useConversationScopedState';

interface ReadinessRequest {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  goal: string;
  sourceTurnId?: string;
  modelSnapshot?: TaskModelSnapshot;
}

function currentTime(): string {
  return new Date().toISOString();
}

export function useWorkbenchChapterAssetRecovery(
  selectedConversationId: string,
  preferredChapterId?: string,
  persistedBundle?: TaskConversationBundle | null,
) {
  const { value: recovery, updateValue: updateRecovery } =
    useConversationScopedState<ChapterAssetRecovery | null>(selectedConversationId, null);
  const recoveriesRef = useRef(new Map<string, ChapterAssetRecovery>());
  const mutationRevisionsRef = useRef(new Map<string, number>());
  const hydratedPersistedConversationsRef = useRef(new Set<string>());
  const persistenceLoadRef = useRef(0);
  const checkingCountsRef = useRef(new Map<string, number>());
  const [checkingConversationIds, setCheckingConversationIds] = useState<Set<string>>(
    () => new Set(),
  );

  const setChecking = useCallback((conversationId: string, checking: boolean) => {
    const currentCount = checkingCountsRef.current.get(conversationId) ?? 0;
    const nextCount = checking ? currentCount + 1 : Math.max(0, currentCount - 1);
    if (nextCount > 0) checkingCountsRef.current.set(conversationId, nextCount);
    else checkingCountsRef.current.delete(conversationId);
    if (currentCount > 0 === nextCount > 0) return;
    setCheckingConversationIds((current) => {
      const next = new Set(current);
      if (nextCount > 0) next.add(conversationId);
      else next.delete(conversationId);
      if (next.size === current.size && [...next].every((item) => current.has(item)))
        return current;
      return next;
    });
  }, []);

  const readMutationRevision = useCallback(
    (conversationId: string) => mutationRevisionsRef.current.get(conversationId) ?? 0,
    [],
  );

  const advanceMutationRevision = useCallback((conversationId: string) => {
    const revision = (mutationRevisionsRef.current.get(conversationId) ?? 0) + 1;
    mutationRevisionsRef.current.set(conversationId, revision);
    return revision;
  }, []);

  const persistRecovery = useCallback(
    (next: ChapterAssetRecovery) => {
      advanceMutationRevision(next.conversationId);
      recoveriesRef.current.set(next.conversationId, next);
      chapterAssetRecoveryStore.set(next);
      updateRecovery(next.conversationId, next);
    },
    [advanceMutationRevision, updateRecovery],
  );

  const clearRecovery = useCallback(
    (conversationId: string) => {
      advanceMutationRevision(conversationId);
      recoveriesRef.current.delete(conversationId);
      chapterAssetRecoveryStore.remove(conversationId);
      updateRecovery(conversationId, null);
    },
    [advanceMutationRevision, updateRecovery],
  );

  const updateOrchestration = useCallback(
    (
      conversationId: string,
      update: (orchestration: ChapterAssetOrchestration) => ChapterAssetOrchestration,
    ): ChapterAssetRecovery | null => {
      const current =
        recoveriesRef.current.get(conversationId) ?? chapterAssetRecoveryStore.get(conversationId);
      if (!current) return null;
      const next = { ...current, orchestration: update(current.orchestration) };
      persistRecovery(next);
      return next;
    },
    [persistRecovery],
  );

  useEffect(() => {
    if (!selectedConversationId) return;
    const current = recoveriesRef.current.get(selectedConversationId);
    if (current) {
      hydratedPersistedConversationsRef.current.add(selectedConversationId);
      updateRecovery(selectedConversationId, current);
      return;
    }
    const loadId = persistenceLoadRef.current + 1;
    persistenceLoadRef.current = loadId;
    const stored = chapterAssetRecoveryStore.get(selectedConversationId);
    if (stored) {
      hydratedPersistedConversationsRef.current.add(selectedConversationId);
      advanceMutationRevision(selectedConversationId);
      recoveriesRef.current.set(selectedConversationId, stored);
      updateRecovery(selectedConversationId, stored);
      return;
    }
    if (
      !persistedBundle ||
      persistedBundle.conversation.conversationId !== selectedConversationId
    ) {
      advanceMutationRevision(selectedConversationId);
      recoveriesRef.current.delete(selectedConversationId);
      updateRecovery(selectedConversationId, null);
      return;
    }
    if (hydratedPersistedConversationsRef.current.has(selectedConversationId)) {
      updateRecovery(selectedConversationId, null);
      return;
    }
    hydratedPersistedConversationsRef.current.add(selectedConversationId);
    const mutationRevision = advanceMutationRevision(selectedConversationId);
    recoveriesRef.current.delete(selectedConversationId);
    updateRecovery(selectedConversationId, null);
    void recoverPersistedChapterAssetRecovery(
      {
        conversationId: selectedConversationId,
        preferredChapterId,
      },
      {
        getConversation: async () => persistedBundle,
      },
    )
      .then((rebuilt) => {
        if (
          persistenceLoadRef.current !== loadId ||
          readMutationRevision(selectedConversationId) !== mutationRevision ||
          !rebuilt
        ) {
          return;
        }
        const newer =
          recoveriesRef.current.get(selectedConversationId) ??
          chapterAssetRecoveryStore.get(selectedConversationId);
        if (newer) {
          updateRecovery(selectedConversationId, newer);
          return;
        }
        persistRecovery(rebuilt);
      })
      .catch(() => {
        // Recovery is best-effort; a later explicit send can recreate the state.
      });
  }, [
    advanceMutationRevision,
    persistRecovery,
    persistedBundle,
    preferredChapterId,
    readMutationRevision,
    selectedConversationId,
    updateRecovery,
  ]);

  const ensureReady = useCallback(
    async (request: ReadinessRequest): Promise<boolean> => {
      setChecking(request.conversationId, true);
      try {
        const result = await chapterAssetReadinessService.inspect({
          novelId: request.novelId,
          chapterId: request.chapterId,
          userInstruction: request.goal,
        });
        if (result.ready) {
          clearRecovery(request.conversationId);
          return true;
        }
        const previous =
          recoveriesRef.current.get(request.conversationId) ??
          chapterAssetRecoveryStore.get(request.conversationId);
        const checkedAt = currentTime();
        const sameRecovery =
          previous?.novelId === request.novelId &&
          previous.chapterId === (result.chapterId ?? request.chapterId) &&
          previous.originalGoal === request.goal;
        persistRecovery({
          conversationId: request.conversationId,
          novelId: request.novelId,
          chapterId: result.chapterId ?? request.chapterId,
          originalGoal: request.goal,
          missingAssets: result.missingAssets,
          sourceTurnId: request.sourceTurnId,
          modelSnapshot: request.modelSnapshot,
          orchestration: reconcileChapterAssetOrchestration(
            sameRecovery ? previous?.orchestration : undefined,
            result.missingAssets,
            checkedAt,
          ),
          createdAt: sameRecovery && previous ? previous.createdAt : checkedAt,
          checkedAt,
        });
        return false;
      } finally {
        setChecking(request.conversationId, false);
      }
    },
    [clearRecovery, persistRecovery, setChecking],
  );

  const refreshRecovery = useCallback(
    async (conversationId = selectedConversationId): Promise<ChapterAssetRecovery | null> => {
      if (!conversationId) return null;
      const current =
        recoveriesRef.current.get(conversationId) ?? chapterAssetRecoveryStore.get(conversationId);
      if (!current) return null;
      const mutationRevision = readMutationRevision(conversationId);
      setChecking(conversationId, true);
      try {
        const result = await chapterAssetReadinessService.inspect({
          novelId: current.novelId,
          chapterId: current.chapterId,
          userInstruction: current.originalGoal,
        });
        if (readMutationRevision(conversationId) !== mutationRevision) {
          return (
            recoveriesRef.current.get(conversationId) ??
            chapterAssetRecoveryStore.get(conversationId)
          );
        }
        const checkedAt = currentTime();
        const next: ChapterAssetRecovery = {
          ...current,
          chapterId: result.chapterId ?? current.chapterId,
          missingAssets: result.missingAssets,
          orchestration: reconcileChapterAssetOrchestration(
            current.orchestration,
            result.missingAssets,
            checkedAt,
          ),
          checkedAt,
        };
        persistRecovery(next);
        return next;
      } finally {
        setChecking(conversationId, false);
      }
    },
    [persistRecovery, readMutationRevision, selectedConversationId, setChecking],
  );

  return {
    recovery,
    checking: selectedConversationId ? checkingConversationIds.has(selectedConversationId) : false,
    ensureReady,
    refreshRecovery,
    updateOrchestration,
    clearRecovery,
  };
}
