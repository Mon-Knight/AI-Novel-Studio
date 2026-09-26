import { Bot, RotateCcw } from 'lucide-react';
import type {
  ArtifactDecisionKind,
  ConversationArtifactCard,
  ConversationTurn,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';
import type {
  WorkbenchPresentationContext,
  WorkbenchPublicEvent,
} from '../../features/workbench/workbenchPresentation';
import {
  chapterSummaryOrchestrationLabel,
  type ChapterSummaryOrchestrationState,
} from '../../services/conversation/chapterSummaryOrchestration';
import {
  decodeWorkbenchTurnContent,
  describeWorkbenchAutomaticTurn,
} from '../../services/conversation/workbenchTurnOrigin';
import { hasUsableDshTaskCredential } from '../../services/dsh/taskRuntimeService';
import { ArtifactCard, ToolEventRow } from './WorkbenchComponents';
import { WorkbenchRunProgressMeter } from './WorkbenchRunProgressMeter';
import { formatWorkbenchTime, statusLabel } from './workbenchHelpers';

interface WorkbenchTurnProps {
  entry: WorkbenchPublicEvent;
  latestTurnId?: string;
  eventsByRunId: ReadonlyMap<string, ToolCallEvent[]>;
  newlyArrivedArtifacts: ReadonlySet<string>;
  decisionBusyCardId: string;
  chapterSummaryOrchestration: ChapterSummaryOrchestrationState;
  retryRunBlockedReason: string;
  candidateNumber?: number;
  sourceRun?: TaskRun;
  presentationContext?: WorkbenchPresentationContext;
  parentCandidateNumber?: number;
  hasRevisionSource?: boolean;
  onReloadArtifacts?: () => void;
  onDecideArtifact: (
    artifact: ConversationArtifactCard,
    decision: ArtifactDecisionKind,
    revisionNotes?: string,
  ) => void;
  onRetry: (runId: string) => void;
  onRetryChapterSummaryStart?: () => void;
  onLocateTurn: (turnId: string) => void;
}

function resolveWorkbenchRetryDisabledReason(run: TaskRun, taskBlockedReason: string): string {
  if (taskBlockedReason) return taskBlockedReason;
  return hasUsableDshTaskCredential(run.modelSnapshot)
    ? ''
    : '冻结模型的本次会话凭据不可用，请先重新配置模型。';
}

function WorkbenchConversationMessage({
  turn,
  latestTurnId,
}: {
  turn: ConversationTurn;
  latestTurnId?: string;
}) {
  const presentation = decodeWorkbenchTurnContent(turn.content);
  const automatic = describeWorkbenchAutomaticTurn(presentation);
  const origin = presentation.origin ?? turn.role;
  return (
    <div
      className={`workbench-turn is-${origin} ${turn.turnId === latestTurnId ? 'is-latest' : 'is-history'}`}
      data-testid="workbench-turn"
      data-turn-id={turn.turnId}
      data-run-id={turn.runId}
      data-role={automatic ? 'system' : turn.role}
      data-stored-role={automatic ? turn.role : undefined}
      data-origin={origin}
    >
      <div className="workbench-turn-meta">
        <span>
          {automatic
            ? '系统步骤'
            : turn.role === 'user'
              ? '你'
              : turn.role === 'assistant'
                ? 'AI Agent'
                : '系统'}
        </span>
        {!automatic && turn.role === 'user' && (
          <span className="workbench-turn-origin">原始输入</span>
        )}
        {automatic && <span className="workbench-turn-origin">{automatic.badge}</span>}
        <time>{formatWorkbenchTime(turn.createdAt)}</time>
      </div>
      <div
        className="workbench-turn-content"
        data-testid={automatic ? 'workbench-system-step' : undefined}
      >
        {automatic?.label ?? presentation.content}
      </div>
    </div>
  );
}

/** One stable public fact per node. Retries and late arrivals never reparent candidate cards. */
export function WorkbenchTurn({
  entry,
  latestTurnId,
  eventsByRunId,
  newlyArrivedArtifacts,
  decisionBusyCardId,
  chapterSummaryOrchestration,
  retryRunBlockedReason,
  candidateNumber,
  sourceRun,
  presentationContext,
  parentCandidateNumber,
  hasRevisionSource,
  onReloadArtifacts,
  onDecideArtifact,
  onRetry,
  onRetryChapterSummaryStart,
  onLocateTurn,
}: WorkbenchTurnProps) {
  if (entry.kind === 'turn')
    return (
      <>
        <WorkbenchConversationMessage turn={entry.turn} latestTurnId={latestTurnId} />
        {chapterSummaryOrchestration.turnId === entry.turn.turnId &&
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
                    <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
                    重试章节总结
                  </button>
                )}
            </div>
          )}
      </>
    );
  if (entry.kind === 'run') {
    const { run } = entry;
    const events = eventsByRunId.get(run.runId) ?? [];
    const terminalRun = ['completed', 'failed', 'cancelled'].includes(run.status);
    const modelSource = `${run.modelSnapshot.providerId} · ${run.modelSnapshot.modelId}`;
    return (
      <div
        className="workbench-run-block"
        data-testid="workbench-run"
        data-run-id={run.runId}
        data-turn-id={run.turnId}
        data-status={run.status}
        data-worker-id={run.workerId}
        data-run-attempt={entry.attempt}
      >
        <div className="workbench-run-heading">
          <span className="workbench-run-model">
            <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
            {entry.attemptCount > 1 && (
              <span className="workbench-run-attempt">第 {entry.attempt} 次运行 · </span>
            )}
            {terminalRun ? (
              <span className="workbench-run-model-source" title={modelSource}>
                来源模型
              </span>
            ) : (
              <span>{modelSource}</span>
            )}
            {events.length > 0 && (
              <span className="workbench-run-step-count">{events.length} 项步骤</span>
            )}
          </span>
          <span className={`workbench-run-state is-${run.status}`}>{statusLabel(run.status)}</span>
        </div>
        {(entry.attempt ?? 1) > 1 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            data-testid="workbench-locate-run-turn"
            onClick={() => onLocateTurn(run.turnId)}
          >
            查看本次重试的原始要求
          </button>
        )}
        <WorkbenchRunProgressMeter run={run} events={events} />
      </div>
    );
  }
  if (entry.kind === 'tool')
    return (
      <ToolEventRow
        event={entry.event.error ? { ...entry.event, error: undefined } : entry.event}
        runEvents={eventsByRunId.get(entry.event.runId) ?? []}
      />
    );
  if (entry.kind === 'error')
    return (
      <div
        className="workbench-inline-error"
        data-testid={entry.eventId ? 'workbench-tool-public-error' : 'workbench-run-error'}
        data-event-id={entry.eventId}
        data-run-id={entry.runId}
        role="alert"
      >
        {entry.error}
      </div>
    );
  if (entry.kind === 'artifact')
    return (
      <ArtifactCard
        artifact={entry.artifact}
        candidateNumber={candidateNumber}
        sourceRun={sourceRun}
        presentationContext={presentationContext}
        parentCandidateNumber={parentCandidateNumber}
        hasRevisionSource={hasRevisionSource}
        busy={Boolean(decisionBusyCardId)}
        newlyArrived={newlyArrivedArtifacts.has(entry.artifact.cardId)}
        onReload={onReloadArtifacts}
        onDecide={(decision, notes) => onDecideArtifact(entry.artifact, decision, notes)}
      />
    );
  if (
    entry.kind === 'run_end' &&
    entry.latestAttempt &&
    ['failed', 'cancelled'].includes(entry.run.status)
  ) {
    const reason = resolveWorkbenchRetryDisabledReason(entry.run, retryRunBlockedReason);
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm workbench-retry-button"
        data-testid="workbench-retry-turn"
        data-run-id={entry.run.runId}
        disabled={Boolean(reason)}
        title={reason || '使用原回合与冻结模型重新运行'}
        onClick={() => onRetry(entry.run.runId)}
      >
        重试此回合
      </button>
    );
  }
  return null;
}
