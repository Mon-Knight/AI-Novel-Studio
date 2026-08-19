import type { ContentTransaction } from '../../types/contentTransaction';

interface TransactionReviewProps {
  transaction: ContentTransaction;
  approved: ReadonlySet<string>;
  busy: boolean;
  onToggle(identity: string): void;
  onApply(): void;
  onCancel(): void;
}

function identity(target: ContentTransaction['targets'][number]): string {
  return `${target.targetType}\u0000${target.targetId}`;
}

function payloadSummary(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

export default function TransactionReview({
  transaction,
  approved,
  busy,
  onToggle,
  onApply,
  onCancel,
}: TransactionReviewProps) {
  const partial = transaction.strategy === 'reviewed_partial';
  return (
    <section className="story-assets-review" aria-label="多目标事务候选审阅">
      <header className="story-assets-section-header">
        <div>
          <h3>审阅候选事务</h3>
          <p>
            {partial ? '仅应用明确勾选的目标' : '全部目标在同一事务中成功或整体回滚'} ·{' '}
            {transaction.targets.length} 个目标
          </p>
        </div>
        <code title={transaction.transactionHash}>{transaction.transactionHash.slice(0, 12)}</code>
      </header>
      <div className="story-assets-review-list">
        {transaction.targets.map((target) => {
          const key = identity(target);
          return (
            <label key={key} className="story-assets-review-row">
              <input
                type="checkbox"
                checked={!partial || approved.has(key)}
                disabled={!partial || busy}
                onChange={() => onToggle(key)}
              />
              <span className="story-assets-review-main">
                <strong>
                  {target.effectType} · {target.targetType}
                </strong>
                <span>{payloadSummary(target.candidatePayload)}</span>
              </span>
              <span className="story-assets-review-revision">base r{target.baseRevision}</span>
            </label>
          );
        })}
      </div>
      <footer className="story-assets-review-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (partial && approved.size === 0)}
          onClick={onApply}
        >
          {busy ? '正在原子应用…' : '确认应用事务'}
        </button>
      </footer>
    </section>
  );
}
