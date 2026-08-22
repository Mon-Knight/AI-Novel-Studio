/**
 * AI Novel Studio - 通用错误状态组件
 */
interface ErrorStateProps {
  message?: string;
  detail?: string;
  onRetry?: () => void;
  onBack?: () => void;
}

function ErrorState({ message = '发生错误', detail, onRetry, onBack }: ErrorStateProps) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-error)', marginBottom: 4 }}>
        {message}
      </div>
      {detail && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            marginBottom: 12,
            maxWidth: 400,
            margin: '0 auto 12px',
          }}
        >
          {detail}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {onRetry && (
          <button className="btn btn-primary btn-sm" onClick={onRetry}>
            🔄 重试
          </button>
        )}
        {onBack && (
          <button className="btn btn-secondary btn-sm" onClick={onBack}>
            ← 返回
          </button>
        )}
      </div>
    </div>
  );
}

export default ErrorState;
