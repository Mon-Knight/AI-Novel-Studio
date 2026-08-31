import type { NovelContextCompressionCandidate } from '../../services/context/novelContextCompressionProvider';

export function WorkbenchCompressionCard({
  candidate,
  busy,
  onDismiss,
}: {
  candidate: NovelContextCompressionCandidate;
  busy: boolean;
  onDismiss: () => void;
}) {
  return (
    <article
      className="workbench-artifact-card is-compression"
      data-testid="workbench-compression-card"
      data-valid={candidate.valid ? 'true' : 'false'}
    >
      <div className="workbench-artifact-heading">
        <div>
          <div className="workbench-eyebrow">小说上下文压缩候选</div>
          <h3>
            {candidate.providerId}@{candidate.version}
          </h3>
        </div>
        <span className="workbench-artifact-status">
          {candidate.valid ? '校验通过' : '覆盖率不足'}
        </span>
      </div>
      <p>
        revision {candidate.sourceRevision} · token {candidate.coverage.tokens.used}/
        {candidate.coverage.tokens.budget}
      </p>
      <pre>{candidate.compressedText}</pre>
      <div className="workbench-artifact-actions">
        <button
          className="btn btn-secondary btn-sm"
          data-testid="workbench-compression-dismiss"
          disabled={busy}
          onClick={onDismiss}
        >
          放弃
        </button>
      </div>
    </article>
  );
}
