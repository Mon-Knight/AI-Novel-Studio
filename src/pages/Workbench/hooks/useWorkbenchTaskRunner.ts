import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chapter } from '../../../types/chapter';
import type {
  TaskConversation,
  TaskConversationBundle,
  TaskModelSnapshot,
} from '../../../types/conversation';
import { taskConversationService } from '../../../services/conversation/taskConversationService';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';
import { taskSessionAdapter } from '../../../services/dsh/taskSessionAdapter';
import { hasUsableDshTaskCredential } from '../../../services/dsh/taskRuntimeService';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import {
  classifyTaskIntent,
  findTaskTargetConflict,
  isConversationalGoal,
} from '../../../services/conversation/taskGoalRouting';
import {
  buildCoreAssetGenerationGoal,
  chapterAssetRecoveryStore,
  resolveCoreAssetGenerationChapterId,
  type ChapterAssetRecovery,
  type ChapterCoreAsset,
} from '../../../services/conversation/chapterAssetReadiness';
import { ensurePersistedChapterGoalTurn } from '../../../services/conversation/chapterAssetRecoveryPersistence';
import { formatWorkbenchFailure } from '../../../services/conversation/workbenchFailure';
import type { CurrentPluginProjection } from '../../../services/conversation/currentPluginService';
import {
  assertWorkbenchModelAvailable,
  WorkbenchModelUnavailableError,
} from '../../../services/conversation/workbenchModelAvailability';
import {
  resolveWorkbenchChapterTarget,
  shouldResolveWorkbenchChapterTarget,
} from '../../../services/conversation/workbenchChapterTarget';
import {
  decodeWorkbenchTurnContent,
  encodeWorkbenchTurnContent,
} from '../../../services/conversation/workbenchTurnOrigin';
import { resolveRetryRunChapterTarget } from '../../../services/conversation/workbenchRetryTarget';
import {
  resolveChapterSummaryOrchestration,
  type ChapterSummaryOrchestrationState,
} from '../../../services/conversation/chapterSummaryOrchestration';
import { executeWorkbenchTurnAfterContextReady } from '../workbenchExecutionGate';
import { useConversationScopedState } from './useConversationScopedState';
import { useWorkbenchChapterAssetRecovery } from './useWorkbenchChapterAssetRecovery';

const STORY_PLAN_COMPLETE_MESSAGE =
  '全书规划中的最后一章已经采用，当前故事已写到规划终点。请先扩展全书规划，再继续生成新章节。';

const CORE_ASSET_ARTIFACT_TYPE: Record<ChapterCoreAsset, string> = {
  story_plan: 'outline',
  world_setting: 'setting_candidates',
  rule_system: 'setting_candidates',
  protagonist: 'character_candidates',
  chapter_outline: 'outline',
};

function isCurrentAssetPreparation(
  current: ChapterAssetRecovery | null,
  started: ChapterAssetRecovery,
  asset: ChapterCoreAsset,
): current is ChapterAssetRecovery {
  return Boolean(
    current &&
    current.conversationId === started.conversationId &&
    current.novelId === started.novelId &&
    current.chapterId === started.chapterId &&
    current.sourceTurnId === started.sourceTurnId &&
    current.originalGoal === started.originalGoal &&
    current.missingAssets[0] === asset &&
    current.orchestration.asset === asset &&
    current.orchestration.phase === 'generating',
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function formatModelDirectoryFailure(error: unknown): string {
  if (error instanceof WorkbenchModelUnavailableError) return error.message;
  return 'Runtime 模型目录刷新失败，草稿已保留，请稍后重试。';
}

export function useWorkbenchTaskRunner(input: {
  selectedNovelId: string;
  selectedConversationId: string;
  chapterId: string | undefined;
  chapters: Chapter[];
  bundle: TaskConversationBundle | null;
  conversations: TaskConversation[];
  setConversations: React.Dispatch<React.SetStateAction<TaskConversation[]>>;
  selectedModel: TaskModelSnapshot;
  selectedNovelRef: React.MutableRefObject<string>;
  selectChapter: (chapterId: string) => Promise<void>;
  refreshBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId?: string) => Promise<void>;
  refreshPlugins: (
    conversationId?: string,
    allowProbe?: boolean,
    modelSnapshot?: TaskModelSnapshot,
  ) => Promise<CurrentPluginProjection[]>;
}) {
  const {
    selectedNovelId,
    selectedConversationId,
    chapterId,
    chapters,
    bundle,
    conversations,
    setConversations,
    selectedModel,
    selectedNovelRef,
    selectChapter,
    refreshBundle,
    loadConversations,
    refreshPlugins,
  } = input;

  const {
    value: draft,
    setValue: setDraft,
    updateValue: updateDraft,
  } = useConversationScopedState(selectedConversationId, '');
  const {
    value: composerError,
    setValue: setComposerError,
    beginOperation: beginComposerErrorOperation,
    commitOperation: commitComposerErrorOperation,
  } = useConversationScopedState(selectedConversationId, '');
  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [runtimeStatusReady, setRuntimeStatusReady] = useState(false);
  const [chapterSummaryOrchestration, setChapterSummaryOrchestration] =
    useState<ChapterSummaryOrchestrationState>({ phase: 'none' });
  const {
    recovery: assetRecovery,
    checking: assetReadinessBusy,
    ensureReady: ensureAssetReadiness,
    refreshRecovery: refreshAssetRecovery,
    updateOrchestration: updateAssetOrchestration,
    clearRecovery: clearAssetRecovery,
  } = useWorkbenchChapterAssetRecovery(selectedConversationId, chapterId, bundle);
  const selectedConversationArchived =
    conversations.some(
      (conversation) =>
        conversation.conversationId === selectedConversationId &&
        Boolean(conversation.archivedAt || conversation.status === 'archived'),
    ) ||
    Boolean(
      bundle &&
      bundle.conversation.conversationId === selectedConversationId &&
      (bundle.conversation.archivedAt || bundle.conversation.status === 'archived'),
    );
  const persistedSelectedRunActive = Boolean(
    bundle &&
    bundle.conversation.conversationId === selectedConversationId &&
    bundle.runs.some((run) => ['queued', 'running', 'cancel_requested'].includes(run.status)),
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

  const runningCountRef = useRef(runningConversationIds.size);
  runningCountRef.current = runningConversationIds.size;
  const observedRuntimeIdsRef = useRef(new Set<string>());
  const pendingSendConversationIdsRef = useRef(new Set<string>());
  const [pendingReleaseEpoch, setPendingReleaseEpoch] = useState(0);
  const summaryOperationTurnIdsRef = useRef(new Set<string>());
  const summaryAutomaticStartFailuresRef = useRef(new Map<string, number>());
  const [summaryStartRetryEpoch, setSummaryStartRetryEpoch] = useState(0);
  const summaryRuntimeGuardRetryTurnIdsRef = useRef(new Set<string>());
  const summaryNextSelectionRef = useRef(new Set<string>());
  const selectedConversationIdRef = useRef(selectedConversationId);
  const selectedChapterIdRef = useRef(chapterId);
  selectedConversationIdRef.current = selectedConversationId;
  selectedChapterIdRef.current = chapterId;

  const releasePendingConversation = useCallback((conversationId: string) => {
    if (pendingSendConversationIdsRef.current.delete(conversationId)) {
      setPendingReleaseEpoch((current) => current + 1);
    }
  }, []);

  const reservePendingConversation = useCallback((conversationId: string): boolean => {
    if (pendingSendConversationIdsRef.current.has(conversationId)) return false;
    pendingSendConversationIdsRef.current.add(conversationId);
    setPendingReleaseEpoch((current) => current + 1);
    return true;
  }, []);

  const validateModelForSend = useCallback(
    async (modelSnapshot: TaskModelSnapshot) => {
      const currentPlugins = await refreshPlugins(undefined, true, modelSnapshot);
      assertWorkbenchModelAvailable(currentPlugins, modelSnapshot);
    },
    [refreshPlugins],
  );

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let unlisten: (() => void) | undefined;

    const handleProjection = (notice: {
      conversationId: string;
      kind: 'run' | 'tool' | 'assistant' | 'artifact' | 'terminal';
    }) => {
      if (disposed) return;
      setRuntimeStatusReady(true);
      const terminal = notice.kind === 'terminal';
      const observed = new Set(observedRuntimeIdsRef.current);
      if (terminal) observed.delete(notice.conversationId);
      else observed.add(notice.conversationId);
      observedRuntimeIdsRef.current = observed;
      setRunningConversationIds((current) => {
        const next = new Set(current);
        if (terminal) next.delete(notice.conversationId);
        else next.add(notice.conversationId);
        return setsEqual(current, next) ? current : next;
      });

      if (selectedConversationIdRef.current === notice.conversationId) {
        void refreshBundle(notice.conversationId);
      }
      if ((notice.kind === 'run' || terminal) && selectedNovelRef.current) {
        void loadConversations(selectedNovelRef.current);
      }
    };

    const subscribe = async () => {
      try {
        const release = await taskSessionAdapter.subscribeToRuntimeProjections(handleProjection);
        if (disposed) release();
        else unlisten = release;
      } catch {
        if (!disposed) retryTimer = window.setTimeout(() => void subscribe(), 1_000);
      }
    };

    void subscribe();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [loadConversations, refreshBundle, selectedNovelRef]);

  // Renderer reloads lose JS workers. Keep polling until Rust and persisted
  // conversation facts agree on a terminal state; projection events accelerate it.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let refreshInFlight = false;

    const refreshRunning = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const ids = await taskSessionAdapter.listRunningConversationIds();
        if (!cancelled) {
          setRuntimeStatusReady(true);
          const next = new Set(ids);
          const previous = observedRuntimeIdsRef.current;
          const changed = !setsEqual(previous, next);
          observedRuntimeIdsRef.current = next;
          setRunningConversationIds((current) => {
            current.forEach((id) => {
              if (taskSessionAdapter.isRunning(id)) next.add(id);
            });
            if (setsEqual(current, next)) return current;
            return next;
          });

          const selectedId = selectedConversationIdRef.current;
          if (selectedId && (next.has(selectedId) || previous.has(selectedId))) {
            await refreshBundle(selectedId);
          }
          if (changed && selectedNovelRef.current) {
            await loadConversations(selectedNovelRef.current);
          }
        }
      } catch {
        // A transient IPC failure must not permanently stop reload recovery.
      } finally {
        refreshInFlight = false;
      }
    };

    void refreshRunning();

    if (!runtimeStatusReady || runningConversationIds.size > 0 || persistedSelectedRunActive) {
      timer = window.setInterval(() => void refreshRunning(), 1500);
    }

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [
    loadConversations,
    persistedSelectedRunActive,
    refreshBundle,
    runningConversationIds.size,
    runtimeStatusReady,
    selectedConversationId,
    selectedNovelRef,
  ]);

  const executePersistedTurn = useCallback(
    async (request: {
      conversationId: string;
      novelId: string;
      chapterId?: string;
      turnId: string;
      goal: string;
      modelSnapshot: TaskModelSnapshot;
    }) => {
      if (runningConversationIds.has(request.conversationId)) {
        throw new Error('当前任务仍在运行，不能启动重复执行。');
      }
      const errorOperation = beginComposerErrorOperation(request.conversationId);
      commitComposerErrorOperation(errorOperation, '');
      setRunningConversationIds((current) => {
        const next = new Set(current).add(request.conversationId);
        if (setsEqual(current, next)) return current;
        return next;
      });
      let runtimeProjectionReleased = false;
      const releaseRuntimeProjection = () => {
        if (runtimeProjectionReleased) return;
        runtimeProjectionReleased = true;
        setRunningConversationIds((current) => {
          const next = new Set(current);
          next.delete(request.conversationId);
          if (setsEqual(current, next)) return current;
          return next;
        });
      };
      try {
        await refreshBundle(request.conversationId);
        const completedRun = await executeWorkbenchTurnAfterContextReady({
          goal: request.goal,
          execute: () =>
            taskSessionAdapter.startTurn(
              {
                conversationId: request.conversationId,
                novelId: request.novelId,
                chapterId: request.chapterId,
                turnId: request.turnId,
                goal: request.goal,
                modelSnapshot: request.modelSnapshot,
              },
              ({ run }) => {
                setConversations((current) =>
                  current.map((conversation) =>
                    conversation.conversationId === request.conversationId
                      ? {
                          ...conversation,
                          status: ['queued', 'running', 'cancel_requested'].includes(run.status)
                            ? 'running'
                            : conversation.status,
                          updatedAt: run.updatedAt,
                        }
                      : conversation,
                  ),
                );
                void refreshBundle(request.conversationId);
              },
            ),
        });
        // The persisted run is already terminal here. Release the runtime overlay
        // before hydrating an increasingly large artifact bundle.
        releaseRuntimeProjection();
        if (selectedNovelRef.current === request.novelId) {
          await loadConversations(request.novelId);
        }
        await refreshBundle(request.conversationId);
        return completedRun;
      } catch (error) {
        releaseRuntimeProjection();
        commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
        if (selectedNovelRef.current === request.novelId) {
          await loadConversations(request.novelId);
        }
        await refreshBundle(request.conversationId);
        return undefined;
      } finally {
        void refreshPlugins(request.conversationId, false, request.modelSnapshot);
        releaseRuntimeProjection();
      }
    },
    [
      loadConversations,
      beginComposerErrorOperation,
      commitComposerErrorOperation,
      refreshBundle,
      refreshPlugins,
      runningConversationIds,
      selectedNovelRef,
      setConversations,
    ],
  );

  const ensureChapterAssetsReady = useCallback(
    async (request: {
      conversationId: string;
      novelId: string;
      chapterId?: string;
      turnId?: string;
      goal: string;
      modelSnapshot: TaskModelSnapshot;
    }): Promise<boolean> => {
      if (classifyTaskIntent(request.goal) !== 'chapter_write') return true;
      return ensureAssetReadiness({
        conversationId: request.conversationId,
        novelId: request.novelId,
        chapterId: request.chapterId,
        goal: request.goal,
        sourceTurnId: request.turnId,
        modelSnapshot: request.modelSnapshot,
      });
    },
    [ensureAssetReadiness],
  );

  const resolveChapterTarget = useCallback(
    async (request: { novelId: string; chapterId?: string; goal: string }) => {
      if (!shouldResolveWorkbenchChapterTarget(request.goal)) {
        return { complete: false, chapterId: request.chapterId };
      }
      const resolution = await resolveWorkbenchChapterTarget({
        novelId: request.novelId,
        currentChapterId: request.chapterId,
        goal: request.goal,
      });
      if (resolution.status === 'complete') {
        return { complete: true, chapterId: request.chapterId };
      }
      const targetChapterId = resolution.chapterId ?? request.chapterId;
      if (targetChapterId && targetChapterId !== request.chapterId) {
        await selectChapter(targetChapterId);
      }
      return { complete: false, chapterId: targetChapterId };
    },
    [selectChapter],
  );

  const sendMessage = useCallback(
    async (messageOverride?: string) => {
      const message = (messageOverride ?? draft).trim();
      const conversationId = selectedConversationId;
      if (
        !message ||
        !selectedNovelId ||
        !conversationId ||
        selectedConversationArchived ||
        runningConversationIds.has(conversationId)
      ) {
        return;
      }
      if (!reservePendingConversation(conversationId)) return;
      const errorOperation = beginComposerErrorOperation(conversationId);
      commitComposerErrorOperation(errorOperation, '');
      try {
        let targetChapterId = chapterId;
        let persistedChapterTurnId: string | undefined;
        try {
          const target = await resolveChapterTarget({
            novelId: selectedNovelId,
            chapterId,
            goal: message,
          });
          if (target.complete) {
            commitComposerErrorOperation(errorOperation, STORY_PLAN_COMPLETE_MESSAGE);
            return;
          }
          targetChapterId = target.chapterId;
          if (!isConversationalGoal(message)) {
            try {
              await validateModelForSend(selectedModel);
            } catch (error) {
              commitComposerErrorOperation(errorOperation, formatModelDirectoryFailure(error));
              return;
            }
          }
          if (classifyTaskIntent(message) === 'chapter_write') {
            const sourceTurn = await ensurePersistedChapterGoalTurn({
              conversationId,
              goal: message,
            });
            persistedChapterTurnId = sourceTurn.turnId;
          }
          const ready = await ensureChapterAssetsReady({
            conversationId,
            novelId: selectedNovelId,
            chapterId: targetChapterId,
            turnId: persistedChapterTurnId,
            goal: message,
            modelSnapshot: selectedModel,
          });
          if (!ready) return;
        } catch (error) {
          commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
          return;
        }

        try {
          const turnId =
            persistedChapterTurnId ??
            (await taskConversationService.appendTurn(conversationId, 'user', message)).turnId;
          if (messageOverride === undefined) {
            updateDraft(conversationId, (current) => (current === draft ? '' : current));
          }
          await executePersistedTurn({
            conversationId,
            novelId: selectedNovelId,
            chapterId: targetChapterId,
            turnId,
            goal: message,
            modelSnapshot: selectedModel,
          });
        } catch (error) {
          commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
        }
      } finally {
        releasePendingConversation(conversationId);
      }
    },
    [
      chapterId,
      beginComposerErrorOperation,
      commitComposerErrorOperation,
      draft,
      executePersistedTurn,
      ensureChapterAssetsReady,
      resolveChapterTarget,
      runningConversationIds,
      selectedConversationArchived,
      selectedConversationId,
      selectedModel,
      selectedNovelId,
      updateDraft,
      validateModelForSend,
      releasePendingConversation,
      reservePendingConversation,
    ],
  );

  const selectedConversationRunning = selectedConversationId
    ? runningConversationIds.has(selectedConversationId) ||
      taskSessionAdapter.isRunning(selectedConversationId) ||
      (!runtimeStatusReady && persistedSelectedRunActive)
    : false;
  const retryRunBlockedReason = selectedConversationArchived
    ? '已归档任务不能重试。'
    : selectedConversationRunning || persistedSelectedRunActive
      ? '当前任务仍在运行，结束或取消后才能重试。'
      : selectedConversationId && pendingSendConversationIdsRef.current.has(selectedConversationId)
        ? '当前任务正在准备执行，请稍候。'
        : '';

  const retryRun = useCallback(
    async (sourceRunId: string) => {
      const conversationId = selectedConversationId;
      const novelId = selectedNovelId;
      if (!sourceRunId || !conversationId || !novelId) return;
      const errorOperation = beginComposerErrorOperation(conversationId);
      if (retryRunBlockedReason) {
        commitComposerErrorOperation(errorOperation, retryRunBlockedReason);
        return;
      }
      if (!reservePendingConversation(conversationId)) {
        commitComposerErrorOperation(errorOperation, '当前任务正在准备执行，请稍候。');
        return;
      }
      commitComposerErrorOperation(errorOperation, '');
      try {
        if (await taskSessionAdapter.isRunningAuthoritatively(conversationId)) {
          throw new Error('当前任务仍由 Runtime 执行，结束或取消后才能重试。');
        }
        const latestBundle = await taskConversationService.get(conversationId);
        if (!latestBundle || latestBundle.conversation.novelId !== novelId) {
          throw new Error('任务对话已变化，请刷新后再重试。');
        }
        if (
          latestBundle.conversation.archivedAt ||
          latestBundle.conversation.status === 'archived'
        ) {
          throw new Error('已归档任务不能重试。');
        }
        if (
          latestBundle.runs.some((run) =>
            ['queued', 'running', 'cancel_requested'].includes(run.status),
          )
        ) {
          throw new Error('当前任务已有运行中的执行。');
        }

        const sourceRun = latestBundle.runs.find((run) => run.runId === sourceRunId);
        if (!sourceRun || !['failed', 'cancelled'].includes(sourceRun.status)) {
          throw new Error('只能重试失败或已取消的运行。');
        }
        const turnRuns = latestBundle.runs.filter((run) => run.turnId === sourceRun.turnId);
        if (turnRuns[turnRuns.length - 1]?.runId !== sourceRun.runId) {
          throw new Error('该回合已有更新的运行，请从最新结果继续。');
        }
        const sourceTurn = latestBundle.turns.find((turn) => turn.turnId === sourceRun.turnId);
        const goal =
          sourceTurn?.role === 'user'
            ? decodeWorkbenchTurnContent(sourceTurn.content).content.trim()
            : '';
        if (!sourceTurn || !goal) {
          throw new Error('原回合内容缺失，无法安全重试。');
        }

        const retryTarget = await resolveRetryRunChapterTarget({
          bundle: latestBundle,
          sourceRun,
          sourceGoal: goal,
        });
        const retryChapterId = retryTarget.chapterId;
        if (retryChapterId && retryChapterId !== chapterId) {
          await selectChapter(retryChapterId);
        }

        const ready = await ensureChapterAssetsReady({
          conversationId,
          novelId,
          chapterId: retryChapterId,
          turnId: sourceTurn.turnId,
          goal,
          modelSnapshot: sourceRun.modelSnapshot,
        });
        if (!ready) return;

        if (!isConversationalGoal(goal)) {
          try {
            await validateModelForSend(sourceRun.modelSnapshot);
          } catch (error) {
            commitComposerErrorOperation(errorOperation, formatModelDirectoryFailure(error));
            return;
          }
        }

        await executePersistedTurn({
          conversationId,
          novelId,
          chapterId: retryChapterId,
          turnId: sourceTurn.turnId,
          goal,
          modelSnapshot: sourceRun.modelSnapshot,
        });
      } catch (error) {
        commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
      } finally {
        releasePendingConversation(conversationId);
      }
    },
    [
      beginComposerErrorOperation,
      chapterId,
      commitComposerErrorOperation,
      executePersistedTurn,
      ensureChapterAssetsReady,
      reservePendingConversation,
      retryRunBlockedReason,
      selectedConversationId,
      selectedNovelId,
      selectChapter,
      validateModelForSend,
      releasePendingConversation,
    ],
  );

  const generateMissingAsset = useCallback(
    async (asset: ChapterCoreAsset) => {
      const recovery = assetRecovery;
      if (
        !recovery ||
        recovery.missingAssets[0] !== asset ||
        recovery.orchestration.asset !== asset ||
        !['queued', 'failed'].includes(recovery.orchestration.phase) ||
        selectedConversationArchived ||
        runningConversationIds.has(recovery.conversationId) ||
        taskSessionAdapter.isRunning(recovery.conversationId)
      ) {
        return;
      }
      if (!reservePendingConversation(recovery.conversationId)) return;
      const errorOperation = beginComposerErrorOperation(recovery.conversationId);
      commitComposerErrorOperation(errorOperation, '');
      const startedAt = new Date().toISOString();
      const startedRecovery = updateAssetOrchestration(recovery.conversationId, (orchestration) =>
        orchestration.asset === asset
          ? { phase: 'generating', asset, updatedAt: startedAt }
          : orchestration,
      );
      if (!startedRecovery || startedRecovery.orchestration.phase !== 'generating') {
        releasePendingConversation(recovery.conversationId);
        return;
      }
      try {
        const modelSnapshot = recovery.modelSnapshot ?? selectedModel;
        await validateModelForSend(modelSnapshot);
        const refreshedRecovery = await refreshAssetRecovery(recovery.conversationId);
        if (!isCurrentAssetPreparation(refreshedRecovery, startedRecovery, asset)) return;
        const latestRecovery = chapterAssetRecoveryStore.get(recovery.conversationId);
        if (!isCurrentAssetPreparation(latestRecovery, startedRecovery, asset)) return;
        const goal = buildCoreAssetGenerationGoal(asset, latestRecovery.originalGoal);
        const turn = await taskConversationService.appendTurn(
          latestRecovery.conversationId,
          'user',
          encodeWorkbenchTurnContent(goal, 'workbench_asset_preparation'),
        );
        updateAssetOrchestration(latestRecovery.conversationId, (orchestration) =>
          orchestration.asset === asset && orchestration.phase === 'generating'
            ? {
                ...orchestration,
                preparationTurnId: turn.turnId,
                updatedAt: new Date().toISOString(),
              }
            : orchestration,
        );
        const completedRun = await executePersistedTurn({
          conversationId: latestRecovery.conversationId,
          novelId: latestRecovery.novelId,
          chapterId: resolveCoreAssetGenerationChapterId(asset, latestRecovery.chapterId),
          turnId: turn.turnId,
          goal,
          modelSnapshot,
        });
        if (completedRun?.status !== 'completed') {
          updateAssetOrchestration(recovery.conversationId, (orchestration) =>
            orchestration.asset === asset
              ? {
                  ...orchestration,
                  phase: 'failed',
                  preparationRunId: completedRun?.runId,
                  error: completedRun?.error ?? '候选生成未完成，请使用当前项的生成按钮重试。',
                  updatedAt: new Date().toISOString(),
                }
              : orchestration,
          );
          return;
        }
        const completedBundle = await taskConversationService.get(recovery.conversationId);
        const candidate = completedBundle?.artifacts.find(
          (artifact) =>
            artifact.runId === completedRun.runId &&
            artifact.artifactType === CORE_ASSET_ARTIFACT_TYPE[asset],
        );
        if (!candidate?.artifactId) {
          updateAssetOrchestration(recovery.conversationId, (orchestration) =>
            orchestration.asset === asset
              ? {
                  ...orchestration,
                  phase: 'failed',
                  preparationRunId: completedRun.runId,
                  error: '本次运行没有形成可应用的结构化候选，请重试当前项。',
                  updatedAt: new Date().toISOString(),
                }
              : orchestration,
          );
          return;
        }
        updateAssetOrchestration(recovery.conversationId, (orchestration) =>
          orchestration.asset === asset
            ? {
                ...orchestration,
                phase: 'awaiting_apply',
                preparationRunId: completedRun.runId,
                candidateArtifactId: candidate.artifactId,
                error: undefined,
                updatedAt: new Date().toISOString(),
              }
            : orchestration,
        );
      } catch (error) {
        updateAssetOrchestration(recovery.conversationId, (orchestration) =>
          orchestration.asset === asset
            ? {
                ...orchestration,
                phase: 'failed',
                error:
                  error instanceof Error
                    ? error.message
                    : '候选生成失败，请使用当前项的生成按钮重试。',
                updatedAt: new Date().toISOString(),
              }
            : orchestration,
        );
        commitComposerErrorOperation(
          errorOperation,
          error instanceof WorkbenchModelUnavailableError
            ? formatModelDirectoryFailure(error)
            : formatWorkbenchFailure(error),
        );
      } finally {
        releasePendingConversation(recovery.conversationId);
      }
    },
    [
      beginComposerErrorOperation,
      assetRecovery,
      commitComposerErrorOperation,
      executePersistedTurn,
      refreshAssetRecovery,
      runningConversationIds,
      selectedConversationArchived,
      selectedModel,
      updateAssetOrchestration,
      validateModelForSend,
      releasePendingConversation,
      reservePendingConversation,
    ],
  );

  const refreshChapterAssetReadiness = useCallback(
    async (selectedChapterId?: string, appliedArtifactId?: string) => {
      const conversationId = assetRecovery?.conversationId;
      if (!conversationId) return;
      const appliedAsset =
        appliedArtifactId && assetRecovery.orchestration.candidateArtifactId === appliedArtifactId
          ? assetRecovery.orchestration.asset
          : undefined;
      const errorOperation = beginComposerErrorOperation(conversationId);
      commitComposerErrorOperation(errorOperation, '');
      try {
        const refreshed = await refreshAssetRecovery(conversationId);
        if (appliedAsset && refreshed?.missingAssets[0] === appliedAsset) {
          updateAssetOrchestration(conversationId, (orchestration) =>
            orchestration.asset === appliedAsset
              ? {
                  ...orchestration,
                  phase: 'failed',
                  error: '候选已经应用，但仍未补齐当前创作资产，请重新生成并审阅。',
                  updatedAt: new Date().toISOString(),
                }
              : orchestration,
          );
        }
        if (refreshed?.chapterId && refreshed.chapterId !== (selectedChapterId ?? chapterId)) {
          await selectChapter(refreshed.chapterId);
        }
      } catch (error) {
        commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
      }
    },
    [
      beginComposerErrorOperation,
      assetRecovery?.conversationId,
      assetRecovery?.orchestration.asset,
      assetRecovery?.orchestration.candidateArtifactId,
      chapterId,
      refreshAssetRecovery,
      selectChapter,
      commitComposerErrorOperation,
      updateAssetOrchestration,
    ],
  );

  const settleAssetCandidateDecision = useCallback(
    async (input: {
      artifactId: string;
      decision: 'confirm' | 'reject' | 'request_revision' | 'request_apply';
      applied: boolean;
      selectedChapterId?: string;
    }) => {
      const current = assetRecovery;
      if (!current || current.orchestration.candidateArtifactId !== input.artifactId) {
        if (input.applied) await refreshChapterAssetReadiness(input.selectedChapterId);
        return;
      }
      if (input.applied) {
        await refreshChapterAssetReadiness(input.selectedChapterId, input.artifactId);
        return;
      }
      if (
        input.decision !== 'reject' &&
        input.decision !== 'request_revision' &&
        input.decision !== 'request_apply'
      ) {
        return;
      }
      updateAssetOrchestration(current.conversationId, (orchestration) =>
        orchestration.candidateArtifactId === input.artifactId
          ? {
              ...orchestration,
              phase: 'failed',
              error:
                input.decision === 'request_revision'
                  ? '候选已转为修改要求；调整方向后请显式重试当前项。'
                  : input.decision === 'reject'
                    ? '候选已拒绝；需要时请显式重试当前项。'
                    : '候选未能应用到作品，请处理冲突后显式重试当前项。',
              updatedAt: new Date().toISOString(),
            }
          : orchestration,
      );
    },
    [assetRecovery, refreshChapterAssetReadiness, updateAssetOrchestration],
  );

  const resumeChapterGoal = useCallback(async () => {
    const current = assetRecovery;
    if (
      !current ||
      selectedConversationArchived ||
      runningConversationIds.has(current.conversationId) ||
      taskSessionAdapter.isRunning(current.conversationId)
    ) {
      return;
    }
    if (!reservePendingConversation(current.conversationId)) return;
    const errorOperation = beginComposerErrorOperation(current.conversationId);
    commitComposerErrorOperation(errorOperation, '');
    try {
      const refreshed = await refreshAssetRecovery(current.conversationId);
      if (!refreshed || refreshed.missingAssets.length > 0) return;
      if (
        refreshed.conversationId !== selectedConversationId ||
        refreshed.novelId !== selectedNovelId
      ) {
        throw new Error('待恢复正文目标与当前任务不一致，请切回原任务后继续。');
      }
      const modelSnapshot = refreshed.modelSnapshot ?? selectedModel;
      await validateModelForSend(modelSnapshot);
      if (refreshed.chapterId && refreshed.chapterId !== chapterId) {
        await selectChapter(refreshed.chapterId);
      }
      let turnId = refreshed.sourceTurnId;
      if (!turnId) {
        const turn = await taskConversationService.appendTurn(
          refreshed.conversationId,
          'user',
          refreshed.originalGoal,
        );
        turnId = turn.turnId;
      }
      updateDraft(refreshed.conversationId, (value) =>
        value.trim() === refreshed.originalGoal ? '' : value,
      );
      const completedRun = await executePersistedTurn({
        conversationId: refreshed.conversationId,
        novelId: refreshed.novelId,
        chapterId: refreshed.chapterId,
        turnId,
        goal: refreshed.originalGoal,
        modelSnapshot,
      });
      if (completedRun) {
        clearAssetRecovery(refreshed.conversationId);
      } else {
        updateAssetOrchestration(refreshed.conversationId, (orchestration) => ({
          ...orchestration,
          phase: 'failed',
          error: '正文恢复尚未形成运行，请确认后重试。',
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch (error) {
      const message =
        error instanceof WorkbenchModelUnavailableError
          ? formatModelDirectoryFailure(error)
          : formatWorkbenchFailure(error);
      updateAssetOrchestration(current.conversationId, (orchestration) =>
        orchestration.phase === 'resuming'
          ? {
              ...orchestration,
              phase: 'failed',
              error: message,
              updatedAt: new Date().toISOString(),
            }
          : orchestration,
      );
      commitComposerErrorOperation(errorOperation, message);
    } finally {
      releasePendingConversation(current.conversationId);
    }
  }, [
    beginComposerErrorOperation,
    assetRecovery,
    chapterId,
    clearAssetRecovery,
    commitComposerErrorOperation,
    executePersistedTurn,
    refreshAssetRecovery,
    runningConversationIds,
    selectedConversationArchived,
    selectedConversationId,
    selectedModel,
    selectedNovelId,
    selectChapter,
    updateAssetOrchestration,
    updateDraft,
    validateModelForSend,
    releasePendingConversation,
    reservePendingConversation,
  ]);

  const reconcilePersistedAssetOrchestration = useCallback(async () => {
    const current = assetRecovery;
    if (
      !current ||
      !['generating', 'awaiting_apply'].includes(current.orchestration.phase) ||
      pendingSendConversationIdsRef.current.has(current.conversationId) ||
      runningConversationIds.has(current.conversationId) ||
      taskSessionAdapter.isRunning(current.conversationId)
    ) {
      return;
    }
    const persistedRecovery = chapterAssetRecoveryStore.get(current.conversationId);
    if (
      !persistedRecovery ||
      persistedRecovery.orchestration.phase !== current.orchestration.phase ||
      persistedRecovery.orchestration.updatedAt !== current.orchestration.updatedAt
    ) {
      return;
    }

    const asset = current.orchestration.asset;
    if (!asset) return;
    const failRecoveredPreparation = (error: string) => {
      updateAssetOrchestration(current.conversationId, (orchestration) =>
        orchestration.asset === asset &&
        ['generating', 'awaiting_apply'].includes(orchestration.phase)
          ? {
              ...orchestration,
              phase: 'failed',
              error,
              updatedAt: new Date().toISOString(),
            }
          : orchestration,
      );
    };

    if (current.orchestration.phase === 'generating') {
      let activeConversationIds: string[];
      try {
        activeConversationIds = await taskSessionAdapter.listRunningConversationIds();
      } catch {
        return;
      }
      if (
        activeConversationIds.includes(current.conversationId) ||
        taskSessionAdapter.isRunning(current.conversationId)
      ) {
        return;
      }
    }

    let latestBundle;
    try {
      latestBundle = await taskConversationService.get(current.conversationId);
    } catch {
      return;
    }
    if (!latestBundle) {
      failRecoveredPreparation('无法核对上次候选生成结果，请显式重试当前项。');
      return;
    }
    const matchingRuns = latestBundle.runs.filter(
      (run) =>
        run.runId === current.orchestration.preparationRunId ||
        run.turnId === current.orchestration.preparationTurnId,
    );
    const preparationRun = matchingRuns[matchingRuns.length - 1];
    const candidate = latestBundle.artifacts.find(
      (artifact) =>
        (artifact.artifactId === current.orchestration.candidateArtifactId ||
          artifact.runId === preparationRun?.runId) &&
        artifact.artifactType === CORE_ASSET_ARTIFACT_TYPE[asset],
    );

    if (current.orchestration.phase === 'generating') {
      if (preparationRun?.status === 'completed' && candidate?.artifactId) {
        updateAssetOrchestration(current.conversationId, (orchestration) =>
          orchestration.asset === asset && orchestration.phase === 'generating'
            ? {
                ...orchestration,
                phase: 'awaiting_apply',
                preparationRunId: preparationRun.runId,
                candidateArtifactId: candidate.artifactId,
                error: undefined,
                updatedAt: new Date().toISOString(),
              }
            : orchestration,
        );
        return;
      }
      failRecoveredPreparation(
        preparationRun?.status === 'failed' || preparationRun?.status === 'cancelled'
          ? preparationRun.error || '上次候选生成未完成，请显式重试当前项。'
          : '上次候选生成已中断，且当前没有活动运行，请显式重试当前项。',
      );
      return;
    }

    if (!candidate?.artifactId) {
      failRecoveredPreparation('上次候选已无法读取，请显式重试当前项。');
      return;
    }
    const decisions = (latestBundle.decisions ?? []).filter(
      (decision) => decision.artifactId === candidate.artifactId,
    );
    const latestDecision = decisions[decisions.length - 1] ?? candidate.latestDecision;
    if (!latestDecision) return;
    await settleAssetCandidateDecision({
      artifactId: candidate.artifactId,
      decision: latestDecision.decision,
      applied: Boolean(latestDecision.applyTransactionId && !latestDecision.conflictCode),
    });
  }, [
    assetRecovery,
    runningConversationIds,
    settleAssetCandidateDecision,
    updateAssetOrchestration,
  ]);

  useEffect(() => {
    void reconcilePersistedAssetOrchestration();
  }, [reconcilePersistedAssetOrchestration]);

  useEffect(() => {
    const current = assetRecovery;
    if (
      !current ||
      current.orchestration.phase !== 'queued' ||
      !current.orchestration.asset ||
      current.conversationId !== selectedConversationId ||
      current.novelId !== selectedNovelId ||
      selectedConversationArchived
    ) {
      return;
    }
    void generateMissingAsset(current.orchestration.asset);
  }, [
    assetRecovery,
    generateMissingAsset,
    selectedConversationArchived,
    selectedConversationId,
    selectedNovelId,
  ]);

  useEffect(() => {
    const current = assetRecovery;
    const pending = current
      ? pendingSendConversationIdsRef.current.has(current.conversationId)
      : false;
    if (
      !current ||
      current.orchestration.phase !== 'resuming' ||
      current.missingAssets.length > 0 ||
      current.conversationId !== selectedConversationId ||
      current.novelId !== selectedNovelId ||
      pending ||
      selectedConversationArchived
    ) {
      return;
    }
    void resumeChapterGoal();
  }, [
    assetRecovery,
    resumeChapterGoal,
    selectedConversationArchived,
    selectedConversationId,
    selectedNovelId,
    pendingReleaseEpoch,
  ]);

  useEffect(() => {
    const conversationId = selectedConversationId;
    const novelId = selectedNovelId;
    if (
      !conversationId ||
      !novelId ||
      !bundle ||
      bundle.conversation.conversationId !== conversationId ||
      bundle.conversation.novelId !== novelId ||
      selectedConversationArchived
    ) {
      setChapterSummaryOrchestration({ phase: 'none' });
      return;
    }

    const runtimeGuardRetryTurnIds = summaryRuntimeGuardRetryTurnIdsRef.current;
    let runtimeGuardRetryTimer: number | undefined;
    let runtimeGuardRetryTurnId = '';
    const retryAfterRuntimeGuard = (turnId: string) => {
      if (runtimeGuardRetryTimer !== undefined || runtimeGuardRetryTurnIds.has(turnId)) {
        return;
      }
      runtimeGuardRetryTurnId = turnId;
      runtimeGuardRetryTurnIds.add(turnId);
      runtimeGuardRetryTimer = window.setTimeout(() => {
        runtimeGuardRetryTimer = undefined;
        setSummaryStartRetryEpoch((current) => current + 1);
      }, 1_500);
    };
    const timer = window.setTimeout(() => {
      void (async () => {
        let freshBundle: TaskConversationBundle | null = null;
        try {
          freshBundle = await taskConversationService.get(conversationId);
          if (
            !freshBundle ||
            freshBundle.conversation.novelId !== novelId ||
            selectedConversationIdRef.current !== conversationId
          ) {
            return;
          }
          const summaries = await chapterSummaryService.getByNovelId(novelId);
          if (selectedConversationIdRef.current !== conversationId) return;

          const fixedModel = freshBundle.conversation.defaultModel;
          const credentialAvailable = fixedModel ? hasUsableDshTaskCredential(fixedModel) : false;
          let state = resolveChapterSummaryOrchestration({
            bundle: freshBundle,
            chapters,
            summaries,
            credentialAvailable,
          });

          if (
            state.phase === 'ready_to_start' &&
            state.turnId &&
            (summaryAutomaticStartFailuresRef.current.get(state.turnId) ?? 0) >= 2
          ) {
            state = { ...state, phase: 'failed' };
          }

          if (state.phase === 'resolving_next' && state.chapterId) {
            const resolution = await resolveWorkbenchChapterTarget({
              novelId,
              currentChapterId: state.chapterId,
              goal: '继续写下一章',
            });
            const nextTarget =
              resolution.status === 'complete'
                ? ({ status: 'complete' } as const)
                : resolution.status === 'advanced' && resolution.chapterId
                  ? ({ status: 'advanced', chapterId: resolution.chapterId } as const)
                  : undefined;
            state = resolveChapterSummaryOrchestration({
              bundle: freshBundle,
              chapters,
              summaries,
              credentialAvailable,
              nextTarget,
            });
            if (
              state.phase === 'next_ready' &&
              state.authorizationId &&
              state.nextChapterId &&
              selectedConversationIdRef.current === conversationId &&
              (selectedChapterIdRef.current === state.chapterId || !selectedChapterIdRef.current)
            ) {
              const selectionKey = `${state.authorizationId}:${state.nextChapterId}`;
              if (!summaryNextSelectionRef.current.has(selectionKey)) {
                summaryNextSelectionRef.current.add(selectionKey);
                await selectChapter(state.nextChapterId);
              }
            }
          }

          if (selectedConversationIdRef.current !== conversationId) return;
          setChapterSummaryOrchestration(state);

          if (state.phase === 'ensure_turn' && state.authorizationId && state.turnId) {
            if (!taskConversationService.isPersistent()) return;
            if (summaryOperationTurnIdsRef.current.has(state.turnId)) return;
            summaryOperationTurnIdsRef.current.add(state.turnId);
            let turnEnsured = false;
            try {
              await artifactDecisionService.ensureChapterSummaryFollowUp(state.authorizationId);
              turnEnsured = true;
              if (selectedConversationIdRef.current === conversationId) {
                await refreshBundle(conversationId);
              }
            } finally {
              if (summaryOperationTurnIdsRef.current.delete(state.turnId) && turnEnsured) {
                setSummaryStartRetryEpoch((current) => current + 1);
              }
            }
            return;
          }

          if (
            state.phase !== 'ready_to_start' ||
            !state.turnId ||
            !state.chapterId ||
            !fixedModel ||
            !taskConversationService.isPersistent()
          ) {
            return;
          }
          if (
            summaryOperationTurnIdsRef.current.has(state.turnId) ||
            pendingSendConversationIdsRef.current.has(conversationId) ||
            runningConversationIds.has(conversationId) ||
            freshBundle.runs.some((run) =>
              ['queued', 'running', 'cancel_requested'].includes(run.status),
            )
          ) {
            return;
          }
          if (taskSessionAdapter.isRunning(conversationId)) {
            retryAfterRuntimeGuard(state.turnId);
            return;
          }
          runtimeGuardRetryTurnIds.delete(state.turnId);

          summaryOperationTurnIdsRef.current.add(state.turnId);
          try {
            await validateModelForSend(fixedModel);
            const startBundle = await taskConversationService.get(conversationId);
            const startSummaries = await chapterSummaryService.getByNovelId(novelId);
            if (!startBundle || selectedConversationIdRef.current !== conversationId) return;
            const startState = resolveChapterSummaryOrchestration({
              bundle: startBundle,
              chapters,
              summaries: startSummaries,
              credentialAvailable: true,
            });
            if (
              startState.phase !== 'ready_to_start' ||
              startState.turnId !== state.turnId ||
              startBundle.runs.some((run) =>
                ['queued', 'running', 'cancel_requested'].includes(run.status),
              )
            ) {
              setChapterSummaryOrchestration(startState);
              return;
            }
            const completedRun = await executePersistedTurn({
              conversationId,
              novelId,
              chapterId: state.chapterId,
              turnId: state.turnId,
              goal: '总结本章',
              modelSnapshot: fixedModel,
            });
            if (completedRun) {
              summaryAutomaticStartFailuresRef.current.delete(state.turnId);
            } else {
              const afterStartBundle = await taskConversationService.get(conversationId);
              const hasPersistedRun = Boolean(
                afterStartBundle?.runs.some((run) => run.turnId === state.turnId),
              );
              if (hasPersistedRun) {
                summaryAutomaticStartFailuresRef.current.delete(state.turnId);
              } else {
                const failureCount =
                  (summaryAutomaticStartFailuresRef.current.get(state.turnId) ?? 0) + 1;
                summaryAutomaticStartFailuresRef.current.set(state.turnId, failureCount);
                setSummaryStartRetryEpoch((current) => current + 1);
                if (selectedConversationIdRef.current === conversationId && failureCount >= 2) {
                  setChapterSummaryOrchestration({ ...state, phase: 'failed' });
                }
              }
            }
          } catch (error) {
            const latestBundle = await taskConversationService
              .get(conversationId)
              .catch(() => null);
            const hasPersistedRun = Boolean(
              latestBundle?.runs.some((run) => run.turnId === state.turnId),
            );
            if (hasPersistedRun) {
              summaryAutomaticStartFailuresRef.current.delete(state.turnId);
            } else {
              const failureCount =
                (summaryAutomaticStartFailuresRef.current.get(state.turnId) ?? 0) + 1;
              summaryAutomaticStartFailuresRef.current.set(state.turnId, failureCount);
              setSummaryStartRetryEpoch((current) => current + 1);
            }
            if (selectedConversationIdRef.current === conversationId) {
              setChapterSummaryOrchestration({ ...state, phase: 'failed' });
              const operation = beginComposerErrorOperation(conversationId);
              commitComposerErrorOperation(operation, formatWorkbenchFailure(error));
            }
          } finally {
            summaryOperationTurnIdsRef.current.delete(state.turnId);
          }
        } catch (error) {
          if (selectedConversationIdRef.current === conversationId) {
            const operation = beginComposerErrorOperation(conversationId);
            commitComposerErrorOperation(operation, formatWorkbenchFailure(error));
          }
        }
      })();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      if (runtimeGuardRetryTimer !== undefined) {
        window.clearTimeout(runtimeGuardRetryTimer);
        runtimeGuardRetryTurnIds.delete(runtimeGuardRetryTurnId);
      }
    };
  }, [
    beginComposerErrorOperation,
    bundle,
    chapters,
    commitComposerErrorOperation,
    executePersistedTurn,
    refreshBundle,
    runningConversationIds,
    pendingReleaseEpoch,
    selectChapter,
    selectedConversationArchived,
    selectedConversationId,
    selectedNovelId,
    summaryStartRetryEpoch,
    validateModelForSend,
  ]);

  const retryChapterSummaryStart = useCallback(() => {
    const turnId = chapterSummaryOrchestration.turnId;
    if (
      chapterSummaryOrchestration.phase !== 'failed' ||
      chapterSummaryOrchestration.runId ||
      !turnId
    ) {
      return;
    }
    summaryAutomaticStartFailuresRef.current.delete(turnId);
    setSummaryStartRetryEpoch((current) => current + 1);
  }, [chapterSummaryOrchestration]);

  const startInitializedTask = useCallback(
    async (request: {
      conversationId: string;
      novelId: string;
      chapterId?: string;
      turnId: string;
      goal: string;
      modelSnapshot: TaskModelSnapshot;
    }) => {
      const errorOperation = beginComposerErrorOperation(request.conversationId);
      commitComposerErrorOperation(errorOperation, '');
      try {
        const target = await resolveChapterTarget(request);
        if (target.complete) {
          commitComposerErrorOperation(errorOperation, STORY_PLAN_COMPLETE_MESSAGE);
          await refreshBundle(request.conversationId);
          return;
        }
        const scopedRequest = { ...request, chapterId: target.chapterId };
        const ready = await ensureChapterAssetsReady(scopedRequest);
        if (!ready) {
          await refreshBundle(request.conversationId);
          return;
        }
        await executePersistedTurn(scopedRequest);
      } catch (error) {
        commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
      }
    },
    [
      beginComposerErrorOperation,
      commitComposerErrorOperation,
      ensureChapterAssetsReady,
      executePersistedTurn,
      refreshBundle,
      resolveChapterTarget,
    ],
  );

  const cancelTask = useCallback(async () => {
    const conversationId = selectedConversationId;
    if (!conversationId) return;
    const errorOperation = beginComposerErrorOperation(conversationId);
    commitComposerErrorOperation(errorOperation, '');
    try {
      const cancelled = await taskSessionAdapter.cancel(conversationId);
      if (!cancelled) throw new Error('当前任务没有可取消的活动运行。');
    } catch (error) {
      commitComposerErrorOperation(errorOperation, formatWorkbenchFailure(error));
    } finally {
      await refreshBundle(conversationId);
    }
  }, [
    beginComposerErrorOperation,
    commitComposerErrorOperation,
    refreshBundle,
    selectedConversationId,
  ]);

  return {
    draft,
    setDraft,
    composerError,
    setComposerError,
    beginComposerErrorOperation,
    commitComposerErrorOperation,
    runningConversationIds,
    targetConflict,
    selectedConversationRunning,
    selectedConversationArchived,
    chapterSummaryOrchestration,
    retryChapterSummaryStart,
    validateModelForSend,
    sendMessage,
    retryRun,
    retryRunBlockedReason,
    startInitializedTask,
    assetRecovery,
    assetReadinessBusy,
    generateMissingAsset,
    refreshChapterAssetReadiness,
    settleAssetCandidateDecision,
    resumeChapterGoal,
    dismissChapterAssetReadiness: () => {
      if (selectedConversationId) clearAssetRecovery(selectedConversationId);
    },
    cancelTask,
  };
}
