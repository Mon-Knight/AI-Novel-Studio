import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, History, MessageSquareText } from 'lucide-react';
import type { NovelContextCompressionCandidate } from '../../services/context/novelContextCompressionProvider';
import type {
  ChapterAssetRecovery,
  ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';
import type {
  ArtifactDecisionKind,
  ConversationArtifactCard,
  TaskConversationBundle,
  ToolCallEvent,
} from '../../types/conversation';
import type { ChapterSummaryOrchestrationState } from '../../services/conversation/chapterSummaryOrchestration';
import {
  completedReadDisclosureKey,
  groupWorkbenchDisplaySegments,
  presentationArtifactsNeedingAttention,
  projectWorkbenchEvents,
  resolvePreparationCandidate,
  workbenchCandidateNumbers,
  WORKBENCH_HISTORY_PAGE_SIZE,
  type WorkbenchArtifactFocusRequest,
  type WorkbenchCompressionPresentation,
  type WorkbenchDisplaySegment,
  type WorkbenchPresentationContext,
  type WorkbenchPublicEvent,
} from '../../features/workbench/workbenchPresentation';
import { workbenchReadingKey } from '../../features/workbench/workbenchPresentationReading';
import { useWorkbenchPresentationScroll } from './hooks/useWorkbenchPresentationScroll';
import { WorkbenchAssetReadinessCard } from './WorkbenchAssetReadinessCard';
import { WorkbenchCompressionCard } from './WorkbenchCompressionCard';
import { WorkbenchTurn } from './WorkbenchTurn';
import { resolveWorkbenchRevisionLineage, TOOL_LABELS } from './workbenchHelpers';

export type { WorkbenchPresentationContext };

export const WORKBENCH_EMPTY_TASK_EXAMPLES = [
  '生成下一章，延续当前悬念',
  '审计本章人物一致性',
  '完善后续大纲',
] as const;

const ARTIFACT_ARRIVAL_CLASS_DURATION_MS = 220;
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const NO_ARRIVALS: ReadonlySet<string> = new Set();

export interface WorkbenchMessageStreamProps {
  bundle: TaskConversationBundle;
  compressionCandidate: NovelContextCompressionCandidate | null;
  compressionBusy: boolean;
  compressionPresentation?: WorkbenchCompressionPresentation | null;
  artifactFocusRequest?: WorkbenchArtifactFocusRequest | null;
  presentationContext?: WorkbenchPresentationContext;
  onInsertExample?: (text: string) => void;
  decisionBusyCardId: string;
  assetRecovery: ChapterAssetRecovery | null;
  assetReadinessBusy: boolean;
  selectedConversationRunning: boolean;
  chapterSummaryOrchestration: ChapterSummaryOrchestrationState;
  onDismissCompression: () => void;
  onReloadArtifacts?: () => void;
  onDecideArtifact: (
    artifact: ConversationArtifactCard,
    decision: ArtifactDecisionKind,
    revisionNotes?: string,
  ) => void;
  onRetry: (runId: string) => void;
  retryRunBlockedReason?: string;
  onRetryChapterSummaryStart?: () => void;
  onGenerateMissingAsset: (asset: ChapterCoreAsset) => void;
  onEditMissingAsset: (asset: ChapterCoreAsset) => void;
  onRefreshAssetReadiness: () => void;
  onResumeChapterGoal: () => void;
  onDismissAssetReadiness: () => void;
}

export function WorkbenchMessageStream(props: WorkbenchMessageStreamProps) {
  const { novelId, conversationId } = props.bundle.conversation;
  return (
    <WorkbenchConversationStream key={workbenchReadingKey(novelId, conversationId)} {...props} />
  );
}

function WorkbenchConversationStream({
  bundle,
  compressionCandidate,
  compressionBusy,
  compressionPresentation,
  artifactFocusRequest,
  presentationContext,
  onInsertExample,
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
  const { conversationId, novelId } = bundle.conversation;
  const artifactConversationIdRef = useRef<string | null>(null);
  const seenArtifactCardIdsRef = useRef(new Map<string, Set<string>>());
  const artifactArrivalTimersRef = useRef(new Map<string, number>());
  const [newlyArrivedArtifacts, setNewlyArrivedArtifacts] = useState<{
    conversationId: string;
    cardIds: Set<string>;
  }>(() => ({ conversationId: '', cardIds: new Set() }));
  const events = useMemo(
    () =>
      projectWorkbenchEvents(bundle, {
        compression:
          compressionCandidate?.novelId === novelId
            ? (compressionPresentation ?? {
                // Compatibility for read-only callers without action metadata: an unscoped preview,
                // never pretend it belongs to the first or a historical run.
                conversationId,
                actionId: 'preview:' + compressionCandidate.sourceRevision,
                createdAt: bundle.conversation.updatedAt,
              })
            : null,
        recovery: assetRecovery,
      }),
    [bundle, novelId, conversationId, compressionCandidate, compressionPresentation, assetRecovery],
  );
  const {
    scrollRef,
    rounds,
    hiddenRoundCount,
    visibleRounds,
    visibleEvents,
    showLatest,
    locatedId,
    locationNotice,
    followLatest,
    locateEvent,
    jumpToLatest,
    loadEarlierTurns,
    collapseEarlierTurns,
    onScroll,
    onUserScrollIntent,
  } = useWorkbenchPresentationScroll({ events, novelId, conversationId, artifactFocusRequest });
  const displaySegments = useMemo(
    () => groupWorkbenchDisplaySegments(visibleEvents),
    [visibleEvents],
  );
  const visibleTurnCount = visibleEvents.filter((entry) => entry.kind === 'turn').length;
  const totalTurnCount = events.filter((entry) => entry.kind === 'turn').length;
  const projectedTurns = events.filter((entry) => entry.kind === 'turn');
  const latestTurnId = projectedTurns[projectedTurns.length - 1]?.turnId;
  const pendingArtifacts = useMemo(() => presentationArtifactsNeedingAttention(events), [events]);
  const preparationCandidate = resolvePreparationCandidate(bundle, assetRecovery);
  const eventsByRunId = useMemo(() => {
    const grouped = new Map<string, ToolCallEvent[]>();
    for (const entry of events) {
      if (entry.kind !== 'tool') continue;
      const runEvents = grouped.get(entry.event.runId) ?? [];
      runEvents.push(entry.event);
      grouped.set(entry.event.runId, runEvents);
    }
    return grouped;
  }, [events]);

  useClientLayoutEffect(() => {
    const conversationId = bundle.conversation.conversationId;
    const cardIds = bundle.artifacts.map((artifact) => artifact.cardId);
    const conversationChanged = artifactConversationIdRef.current !== conversationId;
    artifactConversationIdRef.current = conversationId;

    let seenCardIds = seenArtifactCardIdsRef.current.get(conversationId);
    if (!seenCardIds) {
      seenCardIds = new Set(cardIds);
      seenArtifactCardIdsRef.current.set(conversationId, seenCardIds);
      setNewlyArrivedArtifacts({ conversationId: '', cardIds: new Set() });
      return;
    }

    if (conversationChanged) {
      cardIds.forEach((cardId) => seenCardIds.add(cardId));
      for (const timerId of artifactArrivalTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      artifactArrivalTimersRef.current.clear();
      setNewlyArrivedArtifacts({ conversationId: '', cardIds: new Set() });
      return;
    }

    const arrivedCardIds = cardIds.filter((cardId) => !seenCardIds.has(cardId));
    cardIds.forEach((cardId) => seenCardIds.add(cardId));
    if (arrivedCardIds.length === 0) return;

    setNewlyArrivedArtifacts((current) => {
      const nextCardIds =
        current.conversationId === conversationId ? new Set(current.cardIds) : new Set<string>();
      arrivedCardIds.forEach((cardId) => nextCardIds.add(cardId));
      return { conversationId, cardIds: nextCardIds };
    });
    arrivedCardIds.forEach((cardId) => {
      const timerKey = JSON.stringify([conversationId, cardId]);
      const timerId = window.setTimeout(() => {
        artifactArrivalTimersRef.current.delete(timerKey);
        setNewlyArrivedArtifacts((current) => {
          if (current.conversationId !== conversationId || !current.cardIds.has(cardId)) {
            return current;
          }
          const nextCardIds = new Set(current.cardIds);
          nextCardIds.delete(cardId);
          return {
            conversationId: nextCardIds.size > 0 ? conversationId : '',
            cardIds: nextCardIds,
          };
        });
      }, ARTIFACT_ARRIVAL_CLASS_DURATION_MS);
      artifactArrivalTimersRef.current.set(timerKey, timerId);
    });
  }, [bundle.artifacts, bundle.conversation.conversationId]);

  useEffect(
    () => () => {
      for (const timerId of artifactArrivalTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      artifactArrivalTimersRef.current.clear();
    },
    [],
  );

  const locateNextPending = () => {
    const previous = pendingArtifacts.findIndex((card) => 'artifact:' + card.cardId === locatedId);
    const card = pendingArtifacts[(previous + 1) % pendingArtifacts.length];
    if (card) locateEvent('artifact:' + card.cardId);
  };

  const candidateNumbers = useMemo(() => workbenchCandidateNumbers(events), [events]);

  const publicEventAttributes = (entry: WorkbenchPublicEvent) => ({
    className: 'workbench-public-event',
    tabIndex: -1,
    'data-testid': 'workbench-public-event',
    'data-presentation-id': entry.id,
    'data-event-kind': entry.kind,
    'data-conversation-id': entry.conversationId,
    'data-turn-id': entry.turnId,
    'data-run-id': entry.runId,
    'data-run-attempt': entry.attempt,
    'data-located': locatedId === entry.id ? 'true' : undefined,
  });

  const renderEventContent = (entry: WorkbenchPublicEvent) => {
    if (entry.kind === 'compression' && compressionCandidate)
      return (
        <WorkbenchCompressionCard
          candidate={compressionCandidate}
          busy={compressionBusy}
          onDismiss={onDismissCompression}
        />
      );
    if (entry.kind === 'asset_recovery' && assetRecovery)
      return (
        <WorkbenchAssetReadinessCard
          recovery={assetRecovery}
          busy={assetReadinessBusy}
          running={selectedConversationRunning}
          candidateCardId={preparationCandidate?.cardId}
          onViewCandidate={(cardId) => locateEvent('artifact:' + cardId)}
          onGenerate={onGenerateMissingAsset}
          onEdit={onEditMissingAsset}
          onRefresh={onRefreshAssetReadiness}
          onResume={onResumeChapterGoal}
          onDismiss={onDismissAssetReadiness}
        />
      );
    const candidateNumber =
      entry.kind === 'artifact' ? candidateNumbers.get(entry.artifact.cardId) : undefined;
    const sourceRun =
      entry.kind === 'artifact' && entry.artifact.runId
        ? bundle.runs.find((run) => run.runId === entry.artifact.runId)
        : undefined;
    const lineage =
      entry.kind === 'artifact'
        ? resolveWorkbenchRevisionLineage({
            sourceRun,
            turns: bundle.turns,
            artifacts: bundle.artifacts,
            candidateNumbers,
          })
        : undefined;
    return (
      <WorkbenchTurn
        entry={entry}
        latestTurnId={latestTurnId}
        eventsByRunId={eventsByRunId}
        newlyArrivedArtifacts={
          newlyArrivedArtifacts.conversationId === conversationId
            ? newlyArrivedArtifacts.cardIds
            : NO_ARRIVALS
        }
        decisionBusyCardId={decisionBusyCardId}
        chapterSummaryOrchestration={chapterSummaryOrchestration}
        retryRunBlockedReason={retryRunBlockedReason}
        candidateNumber={candidateNumber}
        sourceRun={sourceRun}
        presentationContext={presentationContext}
        parentCandidateNumber={lineage?.parentCandidateNumber}
        hasRevisionSource={lineage?.hasRevisionSource}
        onReloadArtifacts={onReloadArtifacts}
        onDecideArtifact={onDecideArtifact}
        onRetry={onRetry}
        onRetryChapterSummaryStart={onRetryChapterSummaryStart}
        onLocateTurn={(turnId) => locateEvent('turn:' + turnId)}
      />
    );
  };

  const renderPublicEvent = (entry: WorkbenchPublicEvent) => (
    <div key={entry.id} {...publicEventAttributes(entry)}>
      {renderEventContent(entry)}
    </div>
  );

  const renderDisplaySegment = (segment: WorkbenchDisplaySegment) => {
    if (segment.kind === 'event') return renderPublicEvent(segment.event);
    const [first, ...rest] = segment.events;
    const labels = [
      ...new Set(
        segment.events.map((entry) => TOOL_LABELS[entry.event.toolName] ?? entry.event.toolName),
      ),
    ];
    const disclosureKey = completedReadDisclosureKey(segment.events.map((entry) => entry.id));
    return (
      <div
        key={first.id}
        {...publicEventAttributes(first)}
        className="workbench-public-event workbench-completed-read"
        data-testid="workbench-completed-read"
        data-read-event-ids={segment.events.map((entry) => entry.id).join(',')}
        data-disclosure-key={disclosureKey}
      >
        <details className="workbench-completed-read__details" data-disclosure-key={disclosureKey}>
          <summary>
            <span className="workbench-completed-read__title">
              已读取创作材料 · {segment.events.length} 项
            </span>
            <span className="workbench-completed-read__tools">{labels.join('、')}</span>
          </summary>
          <div className="workbench-completed-read__events">
            {renderEventContent(first)}
            {rest.map((entry) => renderPublicEvent(entry))}
          </div>
        </details>
      </div>
    );
  };

  return (
    <div className="workbench-message-region">
      <section
        ref={scrollRef}
        className="workbench-message-scroll"
        data-testid="workbench-message-list"
        data-total-turn-count={totalTurnCount}
        data-visible-turn-count={visibleTurnCount}
        data-hidden-turn-count={totalTurnCount - visibleTurnCount}
        data-total-round-count={rounds.length}
        data-visible-round-count={visibleRounds.length}
        data-hidden-round-count={hiddenRoundCount}
        data-latest-event-id={events[events.length - 1]?.id}
        data-follow-latest={followLatest ? 'true' : 'false'}
        aria-label="任务对话记录"
        onScroll={onScroll}
        onWheel={onUserScrollIntent}
        onPointerDown={onUserScrollIntent}
        onKeyDown={onUserScrollIntent}
      >
        {(hiddenRoundCount > 0 || visibleRounds.length > WORKBENCH_HISTORY_PAGE_SIZE) && (
          <div className="workbench-history-controls" data-testid="workbench-history-controls">
            {hiddenRoundCount > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-load-earlier"
                onClick={loadEarlierTurns}
              >
                <History aria-hidden="true" size={14} strokeWidth={1.8} />
                加载更早记录（{Math.min(hiddenRoundCount, WORKBENCH_HISTORY_PAGE_SIZE)} 个完整回合）
              </button>
            )}
            {visibleRounds.length > WORKBENCH_HISTORY_PAGE_SIZE && (
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
        {events.length === 0 && (
          <div className="workbench-intro">
            <div className="workbench-intro-icon">
              <MessageSquareText aria-hidden="true" size={18} strokeWidth={1.8} />
            </div>
            <h3>开始你的创作任务</h3>
            <p>描述方向 → 审阅必要候选 → 逐章采用。你始终保留最终决定权。</p>
            <div className="workbench-intro-examples" aria-label="创作目标示例">
              {WORKBENCH_EMPTY_TASK_EXAMPLES.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="workbench-intro-example"
                  data-testid="workbench-intro-example"
                  onClick={() => onInsertExample?.(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {displaySegments.map(renderDisplaySegment)}
      </section>
      {(showLatest || pendingArtifacts.length > 0 || locationNotice) && (
        <div
          className="workbench-latest-dock workbench-pending-navigation"
          data-testid="workbench-latest-dock"
        >
          {pendingArtifacts.length > 0 && (
            <button
              type="button"
              className="workbench-latest-button"
              data-testid="workbench-locate-pending"
              onClick={locateNextPending}
            >
              查看待处理候选（{pendingArtifacts.length}）
            </button>
          )}
          {showLatest && (
            <button type="button" className="workbench-latest-button" onClick={jumpToLatest}>
              <span>查看最新进展</span>
              <ArrowDown aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          )}
          {locationNotice && <span role="status">{locationNotice}</span>}
          {locationNotice && onReloadArtifacts && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReloadArtifacts}>
              重新读取
            </button>
          )}
        </div>
      )}
    </div>
  );
}
