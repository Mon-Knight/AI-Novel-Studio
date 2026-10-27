import { Bot, CircleCheck, CircleX, Clock3, FileText, LoaderCircle } from 'lucide-react';
import type { TaskConversationBundle, TaskRun, ToolCallEvent } from '../../types/conversation';
import { formatWorkbenchTime, statusLabel } from './workbenchHelpers';
import {
  ARTIFACT_STATUS_LABELS,
  artifactTypeLabel,
  revealArtifactCard,
} from './workbenchSidePanelModel';

export function WorkbenchArtifactIndex({
  bundle,
  onReveal = revealArtifactCard,
}: {
  bundle: TaskConversationBundle;
  onReveal?: (cardId: string, artifactId?: string) => boolean;
}) {
  const artifacts = [...bundle.artifacts].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  if (artifacts.length === 0) {
    return <p className="workbench-side-empty">本任务还没有产物。生成候选后会在这里列出。</p>;
  }
  return (
    <ul className="workbench-side-list" data-testid="workbench-side-artifacts">
      {artifacts.map((artifact) => (
        <li key={artifact.cardId}>
          <button
            type="button"
            className="workbench-side-row"
            data-testid="workbench-side-artifact"
            data-card-id={artifact.cardId}
            data-status={artifact.status}
            title="在对话中定位这张产物卡"
            onClick={() => onReveal(artifact.cardId, artifact.artifactId)}
          >
            <FileText aria-hidden="true" size={15} strokeWidth={1.8} />
            <span className="workbench-side-row-copy">
              <span className="workbench-side-row-title">{artifact.title}</span>
              <span className="workbench-side-row-meta">
                {artifactTypeLabel(artifact.artifactType)} ·{' '}
                {formatWorkbenchTime(artifact.createdAt)}
              </span>
            </span>
            <span className={`workbench-side-badge is-${artifact.status}`}>
              {ARTIFACT_STATUS_LABELS[artifact.status]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ToolEventStatusIcon({ status }: { status: ToolCallEvent['status'] }) {
  if (status === 'succeeded') {
    return <CircleCheck aria-hidden="true" size={13} strokeWidth={1.8} />;
  }
  if (status === 'failed') return <CircleX aria-hidden="true" size={13} strokeWidth={1.8} />;
  if (status === 'running') {
    return (
      <LoaderCircle
        className="workbench-readiness-icon is-spinning"
        aria-hidden="true"
        size={13}
        strokeWidth={1.8}
      />
    );
  }
  return <Clock3 aria-hidden="true" size={13} strokeWidth={1.8} />;
}

function runDuration(run: TaskRun): string {
  if (!run.startedAt || !run.finishedAt) return '';
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function WorkbenchRunLog({ bundle }: { bundle: TaskConversationBundle }) {
  const runs = [...bundle.runs].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  if (runs.length === 0) {
    return <p className="workbench-side-empty">本任务还没有运行记录。</p>;
  }
  return (
    <div className="workbench-side-runs" data-testid="workbench-side-events">
      {runs.map((run) => {
        const events = bundle.toolEvents
          .filter((event) => event.runId === run.runId)
          .sort((left, right) => left.sequence - right.sequence);
        const duration = runDuration(run);
        return (
          <section className="workbench-side-run" key={run.runId} data-run-id={run.runId}>
            <header className="workbench-side-run-heading">
              <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
              <span className="workbench-side-row-title">
                {run.modelSnapshot.providerId} · {run.modelSnapshot.modelId}
              </span>
              <span className={`workbench-side-badge is-${run.status}`}>
                {statusLabel(run.status)}
              </span>
            </header>
            <div className="workbench-side-row-meta">
              {formatWorkbenchTime(run.createdAt)}
              {duration ? ` · ${duration}` : ''}
              {events.length > 0 ? ` · ${events.length} 项工具调用` : ' · 无工具调用'}
            </div>
            {events.length > 0 && (
              <ol className="workbench-side-events">
                {events.map((event) => (
                  <li
                    key={event.eventId}
                    className={`workbench-side-event is-${event.status}`}
                    title={event.error || undefined}
                  >
                    <ToolEventStatusIcon status={event.status} />
                    <span className="workbench-side-event-name">{event.toolName}</span>
                    <span className="workbench-side-row-meta">
                      {event.durationMs !== undefined
                        ? `${event.durationMs} ms`
                        : statusLabel(event.status)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {run.error && <p className="workbench-side-error">{run.error}</p>}
          </section>
        );
      })}
    </div>
  );
}
