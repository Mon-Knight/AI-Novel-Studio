import { Bot, RotateCcw } from 'lucide-react';
import type {
  ArtifactDecisionKind,
  ConversationArtifactCard,
  ConversationTurn,
  TaskRun,
  ToolCallEvent,
} from '../../types/conversation';
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
  turn: ConversationTurn;
  runs: TaskRun[];
  latestTurnId?: string;
  conversationId: string;
  eventsByRunId: ReadonlyMap<string, ToolCallEvent[]>;
  artifactsByRunId: ReadonlyMap<string, ConversationArtifactCard[]>;
  newlyArrivedArtifacts: {
    conversationId: string;
    cardIds: ReadonlySet<string>;
  };
  decisionBusyCardId: string;
  chapterSummaryOrchestration: ChapterSummaryOrchestrationState;
  retryRunBlockedReason: string;
  onReloadArtifacts?: () => void;
  onDecideArtifact: (artifact: ConversationArtifactCard, decision: ArtifactDecisionKind) => void;
  onRetry: (runId: string) => void;
  onRetryChapterSummaryStart?: () => void;
}

function resolveWorkbenchRetryDisabledReason(run: TaskRun, taskBlockedReason: string): string {
  if (taskBlockedReason) return taskBlockedReason;
  return hasUsableDshTaskCredential(run.modelSnapshot)
    ? ''
    : '冻结模型的本次会话凭据不可用，请先重新配置模型。';
}

export function WorkbenchTurn({
  turn,
  runs,
  latestTurnId,
  conversationId,
  eventsByRunId,
  artifactsByRunId,
  newlyArrivedArtifacts,
  decisionBusyCardId,
  chapterSummaryOrchestration,
  retryRunBlockedReason,
  onReloadArtifacts,
  onDecideArtifact,
  onRetry,
  onRetryChapterSummaryStart,
}: WorkbenchTurnProps) {
  const turnPresentation = decodeWorkbenchTurnContent(turn.content);
  const automaticPresentation = describeWorkbenchAutomaticTurn(turnPresentation);
  const turnOrigin = turnPresentation.origin ?? turn.role;
  const presentationRole = automaticPresentation ? 'system' : turn.role;

  return (
    <div
      className={`workbench-turn is-${turnOrigin} ${turn.turnId === latestTurnId ? 'is-latest' : 'is-history'}`}
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
        {!automaticPresentation && turn.role === 'user' && (
          <span className="workbench-turn-origin">原始输入</span>
        )}
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
                  <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
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
                newlyArrived={
                  newlyArrivedArtifacts.conversationId === conversationId &&
                  newlyArrivedArtifacts.cardIds.has(artifact.cardId)
                }
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
}
