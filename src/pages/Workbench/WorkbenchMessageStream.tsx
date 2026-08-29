import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Bot, History, MessageSquareText, RotateCcw } from 'lucide-react';
import type { NovelContextCompressionCandidate } from '../../services/context/novelContextCompressionProvider';
import type {
  ChapterAssetRecovery,
  ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';
import type {
  ArtifactDecisionKind,
  ConversationArtifactCard,
  TaskConversationBundle,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';
import {
  decodeWorkbenchTurnContent,
  describeWorkbenchAutomaticTurn,
} from '../../services/conversation/workbenchTurnOrigin';
import {
  chapterSummaryOrchestrationLabel,
  type ChapterSummaryOrchestrationState,
} from '../../services/conversation/chapterSummaryOrchestration';
import { ArtifactCard, ToolEventRow } from './WorkbenchComponents';
import { WorkbenchAssetReadinessCard } from './WorkbenchAssetReadinessCard';
import { WorkbenchCompressionCard } from './WorkbenchCompressionCard';
import { WorkbenchRunProgressMeter } from './WorkbenchRunProgressMeter';
import { formatWorkbenchTime, statusLabel } from './workbenchHelpers';
import { hasUsableDshTaskCredential } from '../../services/dsh/taskRuntimeService';

const WORKBENCH_HISTORY_PAGE_SIZE = 8;
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function preferredUserScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function scrollToLatest(node: HTMLElement, behavior: ScrollBehavior): void {
  if (typeof node.scrollTo === 'function') {
    node.scrollTo({ top: node.scrollHeight, behavior });
  } else {
    node.scrollTop = node.scrollHeight;
  }
}

function resolveWorkbenchRetryDisabledReason(run: TaskRun, taskBlockedReason: string): string {
  if (taskBlockedReason) return taskBlockedReason;
  return hasUsableDshTaskCredential(run.modelSnapshot)
    ? ''
    : '冻结模型的本次会话凭据不可用，请先重新配置模型。';
}

interface WorkbenchMessageStreamProps {
  bundle: TaskConversationBundle;
  compressionCandidate: NovelContextCompressionCandidate | null;
  compressionBusy: boolean;
  decisionBusyCardId: string;
  assetRecovery: ChapterAssetRecovery | null;
  assetReadinessBusy: boolean;
  selectedConversationRunning: boolean;
  chapterSummaryOrchestration: ChapterSummaryOrchestrationState;
  onDismissCompression: () => void;
  onReloadArtifacts?: () => void;
  onDecideArtifact: (artifact: ConversationArtifactCard, decision: ArtifactDecisionKind) => void;
  onRetry: (runId: string) => void;
  retryRunBlockedReason?: string;
  onRetryChapterSummaryStart?: () => void;
  onGenerateMissingAsset: (asset: ChapterCoreAsset) => void;
  onEditMissingAsset: (asset: ChapterCoreAsset) => void;
  onRefreshAssetReadiness: () => void;
  onResumeChapterGoal: () => void;
  onDismissAssetReadiness: () => void;
}

export function WorkbenchMessageStream({
  bundle,
  compressionCandidate,
  compressionBusy,
  decisionBusyCardId,
  assetRecovery,
  assetReadinessBusy,
  selectedConversationRunning,
  chapterSummaryOrchestration,
  onDismissCompression,
  onReloadArtifacts,
  onDecideArtifact,
  onRetry,
  retryRunBlockedReason = '',
  onRetryChapterSummaryStart,
  onGenerateMissingAsset,
  onEditMissingAsset,
  onRefreshAssetReadiness,
  onResumeChapterGoal,
  onDismissAssetReadiness,
}: WorkbenchMessageStreamProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const followLatestRef = useRef(true);
  const followFrameRef = useRef<number | null>(null);
  const historyRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const collapseToLatestRef = useRef(false);
  const [showLatest, setShowLatest] = useState(false);
  const [historyWindow, setHistoryWindow] = useState(() => ({
    conversationId: bundle.conversation.conversationId,
    visibleTurnCount: WORKBENCH_HISTORY_PAGE_SIZE,
  }));
  const latestTurn = bundle.turns[bundle.turns.length - 1];
  const latestRun = bundle.runs[bundle.runs.length - 1];
  const latestEvent = bundle.toolEvents[bundle.toolEvents.length - 1];
  const requestedVisibleTurnCount =
    historyWindow.conversationId === bundle.conversation.conversationId
      ? historyWindow.visibleTurnCount
      : WORKBENCH_HISTORY_PAGE_SIZE;
  const visibleTurnCount = Math.min(bundle.turns.length, requestedVisibleTurnCount);
  const hiddenTurnCount = Math.max(0, bundle.turns.length - visibleTurnCount);
  const visibleTurns = useMemo(
    () => bundle.turns.slice(hiddenTurnCount),
    [bundle.turns, hiddenTurnCount],
  );
  const runsByTurnId = useMemo(() => {
    const grouped = new Map<string, TaskRun[]>();
    for (const run of bundle.runs) {
      const runs = grouped.get(run.turnId);
      if (runs) runs.push(run);
      else grouped.set(run.turnId, [run]);
    }
    return grouped;
  }, [bundle.runs]);
  const eventsByRunId = useMemo(() => {
    const grouped = new Map<string, ToolCallEvent[]>();
    for (const event of bundle.toolEvents) {
      const events = grouped.get(event.runId);
      if (events) events.push(event);
      else grouped.set(event.runId, [event]);
    }
    return grouped;
  }, [bundle.toolEvents]);
  const artifactsByRunId = useMemo(() => {
    const grouped = new Map<string, ConversationArtifactCard[]>();
    for (const artifact of bundle.artifacts) {
      if (!artifact.runId) continue;
      const artifacts = grouped.get(artifact.runId);
      if (artifacts) artifacts.push(artifact);
      else grouped.set(artifact.runId, [artifact]);
    }
    return grouped;
  }, [bundle.artifacts]);
  const unscopedArtifacts = useMemo(
    () => bundle.artifacts.filter((artifact) => !artifact.runId),
    [bundle.artifacts],
  );
  const activityKey = [
    bundle.turns.length,
    latestTurn?.turnId,
    latestTurn?.content?.length ?? 0,
    bundle.runs.length,
    latestRun?.status,
    bundle.toolEvents.length,
    latestEvent?.status,
    bundle.artifacts.length,
    compressionCandidate?.compressedText.length ?? 0,
    assetRecovery?.checkedAt ?? '',
    assetRecovery?.missingAssets.join(',') ?? '',
  ].join(':');

  useEffect(() => {
    if (!followLatestRef.current) {
      setShowLatest(true);
      return;
    }
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame?.(followFrameRef.current);
      window.clearTimeout(followFrameRef.current);
    }
    const flushFollow = () => {
      followFrameRef.current = null;
      const node = scrollRef.current;
      if (!node || !followLatestRef.current) return;
      scrollToLatest(node, 'auto');
      setShowLatest(false);
    };
    followFrameRef.current = window.requestAnimationFrame
      ? window.requestAnimationFrame(flushFollow)
      : window.setTimeout(flushFollow, 0);
    return () => {
      if (followFrameRef.current === null) return;
      window.cancelAnimationFrame?.(followFrameRef.current);
      window.clearTimeout(followFrameRef.current);
      followFrameRef.current = null;
    };
  }, [activityKey]);

  useClientLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (collapseToLatestRef.current) {
      collapseToLatestRef.current = false;
      scrollToLatest(node, 'auto');
      followLatestRef.current = true;
      setShowLatest(false);
      return;
    }
    const restore = historyRestoreRef.current;
    if (!restore) return;
    historyRestoreRef.current = null;
    node.scrollTop = restore.scrollTop + Math.max(0, node.scrollHeight - restore.scrollHeight);
  }, [bundle.conversation.conversationId, visibleTurnCount]);

  useEffect(() => {
    followLatestRef.current = true;
    historyRestoreRef.current = null;
    collapseToLatestRef.current = false;
    setShowLatest(false);
  }, [bundle.conversation.conversationId]);

  const jumpToLatest = () => {
    const node = scrollRef.current;
    if (!node) return;
    followLatestRef.current = true;
    scrollToLatest(node, preferredUserScrollBehavior());
    setShowLatest(false);
  };

  const loadEarlierTurns = () => {
    const node = scrollRef.current;
    if (node) {
      historyRestoreRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      };
    }
    followLatestRef.current = false;
    setShowLatest(true);
    setHistoryWindow({
      conversationId: bundle.conversation.conversationId,
      visibleTurnCount: Math.min(
        bundle.turns.length,
        visibleTurnCount + WORKBENCH_HISTORY_PAGE_SIZE,
      ),
    });
  };

  const collapseEarlierTurns = () => {
    collapseToLatestRef.current = true;
    setHistoryWindow({
      conversationId: bundle.conversation.conversationId,
      visibleTurnCount: WORKBENCH_HISTORY_PAGE_SIZE,
    });
  };

  return (
    <div className="workbench-message-region">
      <section
        ref={scrollRef}
        className="workbench-message-scroll"
        data-testid="workbench-message-list"
        data-total-turn-count={bundle.turns.length}
        data-visible-turn-count={visibleTurnCount}
        data-hidden-turn-count={hiddenTurnCount}
        aria-label="任务对话记录"
        onScroll={(event) => {
          const node = event.currentTarget;
          const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          followLatestRef.current = nearBottom;
          if (nearBottom) setShowLatest(false);
        }}
      >
        {(hiddenTurnCount > 0 || visibleTurnCount > WORKBENCH_HISTORY_PAGE_SIZE) && (
          <div className="workbench-history-controls" data-testid="workbench-history-controls">
            {hiddenTurnCount > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-load-earlier"
                onClick={loadEarlierTurns}
              >
                <History aria-hidden="true" size={14} strokeWidth={1.8} />
                加载更早记录（{Math.min(hiddenTurnCount, WORKBENCH_HISTORY_PAGE_SIZE)}）
              </button>
            )}
            {visibleTurnCount > WORKBENCH_HISTORY_PAGE_SIZE && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-collapse-history"
                onClick={collapseEarlierTurns}
              >
                <ArrowDown aria-hidden="true" size={14} strokeWidth={1.8} />
                回到最近记录
              </button>
            )}
          </div>
        )}
        {bundle.turns.length === 0 && !compressionCandidate && !assetRecovery && (
          <div className="workbench-intro">
            <div className="workbench-intro-icon">
              <MessageSquareText aria-hidden="true" size={18} strokeWidth={1.7} />
            </div>
            <h3>当前任务尚无对话记录</h3>
          </div>
        )}

        {compressionCandidate && (
          <WorkbenchCompressionCard
            candidate={compressionCandidate}
            busy={compressionBusy}
            onDismiss={onDismissCompression}
          />
        )}

        {visibleTurns.map((turn) => {
          const runs = runsByTurnId.get(turn.turnId) ?? [];
          const turnPresentation = decodeWorkbenchTurnContent(turn.content);
          const automaticPresentation = describeWorkbenchAutomaticTurn(turnPresentation);
          const turnOrigin = turnPresentation.origin ?? turn.role;
          const presentationRole = automaticPresentation ? 'system' : turn.role;
          return (
            <div
              className={`workbench-turn is-${turnOrigin} ${turn.turnId === latestTurn?.turnId ? 'is-latest' : 'is-history'}`}
              key={turn.turnId}
              data-testid="workbench-turn"
              data-turn-id={turn.turnId}
              data-role={presentationRole}
              data-stored-role={automaticPresentation ? turn.role : undefined}
              data-origin={turnOrigin}
            >
              <div className="workbench-turn-meta">
                <span>
                  {automaticPresentation
                    ? '系统步骤'
                    : turn.role === 'user'
                      ? '你'
                      : turn.role === 'assistant'
                        ? 'AI Agent'
                        : '系统'}
                </span>
                {automaticPresentation && (
                  <span className="workbench-turn-origin">{automaticPresentation.badge}</span>
                )}
                <time>{formatWorkbenchTime(turn.createdAt)}</time>
              </div>
              <div
                className="workbench-turn-content"
                data-testid={automaticPresentation ? 'workbench-system-step' : undefined}
              >
                {automaticPresentation?.label ?? turnPresentation.content}
              </div>
              {chapterSummaryOrchestration.turnId === turn.turnId &&
                chapterSummaryOrchestration.phase !== 'none' && (
                  <div
                    className={`workbench-summary-orchestration is-${chapterSummaryOrchestration.phase}`}
                    data-testid="workbench-summary-orchestration"
                    data-phase={chapterSummaryOrchestration.phase}
                    role="status"
                  >
                    <span>{chapterSummaryOrchestrationLabel(chapterSummaryOrchestration)}</span>
                    {chapterSummaryOrchestration.phase === 'failed' &&
                      !chapterSummaryOrchestration.runId &&
                      onRetryChapterSummaryStart && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm workbench-retry-button"
                          data-testid="workbench-retry-summary-start"
                          onClick={onRetryChapterSummaryStart}
                        >
                          <RotateCcw aria-hidden="true" size={14} />
                          重试章节总结
                        </button>
                      )}
                  </div>
                )}
              {runs.map((run, runIndex) => {
                const events = eventsByRunId.get(run.runId) ?? [];
                const isLatestRunForTurn = runIndex === runs.length - 1;
                const artifacts = artifactsByRunId.get(run.runId) ?? [];
                return (
                  <div
                    className="workbench-run-block"
                    data-testid="workbench-run"
                    data-run-id={run.runId}
                    data-status={run.status}
                    data-worker-id={run.workerId}
                    data-run-attempt={runIndex + 1}
                    key={run.runId}
                  >
                    <div className="workbench-run-heading">
                      <span className="workbench-run-model">
                        <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
                        {runs.length > 1 && (
                          <span className="workbench-run-attempt">第 {runIndex + 1} 次运行 · </span>
                        )}
                        <span>
                          {run.modelSnapshot.providerId} · {run.modelSnapshot.modelId}
                        </span>
                        {events.length > 0 && (
                          <span className="workbench-run-step-count">{events.length} 项步骤</span>
                        )}
                      </span>
                      <span className={`workbench-run-state is-${run.status}`}>
                        {statusLabel(run.status)}
                      </span>
                    </div>
                    <WorkbenchRunProgressMeter run={run} events={events} />
                    <div className="workbench-tool-summaries">
                      {events.map((event) => (
                        <ToolEventRow event={event} runEvents={events} key={event.eventId} />
                      ))}
                    </div>
                    {artifacts.map((artifact) => (
                      <ArtifactCard
                        artifact={artifact}
                        key={artifact.cardId}
                        busy={decisionBusyCardId === artifact.cardId}
                        onReload={onReloadArtifacts}
                        onDecide={(decision) => onDecideArtifact(artifact, decision)}
                      />
                    ))}
                    {run.error && (
                      <div className="workbench-inline-error" data-testid="workbench-run-error">
                        {run.error}
                      </div>
                    )}
                    {isLatestRunForTurn &&
                      ['failed', 'cancelled'].includes(run.status) &&
                      (() => {
                        const disabledReason = resolveWorkbenchRetryDisabledReason(
                          run,
                          retryRunBlockedReason,
                        );
                        return (
                          <button
                            className="btn btn-secondary btn-sm workbench-retry-button"
                            data-testid="workbench-retry-turn"
                            onClick={() => onRetry(run.runId)}
                            disabled={Boolean(disabledReason)}
                            title={disabledReason || '使用原回合与冻结模型重新运行'}
                          >
                            重试此回合
                          </button>
                        );
                      })()}
                  </div>
                );
              })}
            </div>
          );
        })}

        {unscopedArtifacts.map((artifact) => (
          <ArtifactCard
            artifact={artifact}
            key={artifact.cardId}
            busy={decisionBusyCardId === artifact.cardId}
            onReload={onReloadArtifacts}
            onDecide={(decision) => onDecideArtifact(artifact, decision)}
          />
        ))}

        {assetRecovery && (
          <WorkbenchAssetReadinessCard
            recovery={assetRecovery}
            busy={assetReadinessBusy}
            running={selectedConversationRunning}
            onGenerate={onGenerateMissingAsset}
            onEdit={onEditMissingAsset}
            onRefresh={onRefreshAssetReadiness}
            onResume={onResumeChapterGoal}
            onDismiss={onDismissAssetReadiness}
          />
        )}
      </section>
      {showLatest && (
        <div className="workbench-latest-dock" data-testid="workbench-latest-dock">
          <button type="button" className="workbench-latest-button" onClick={jumpToLatest}>
            <span>查看最新进展</span>
            <ArrowDown aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  );
}
