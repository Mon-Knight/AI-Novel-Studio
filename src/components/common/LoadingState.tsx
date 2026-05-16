/**
 * AI Novel Studio - 通用加载状态组件
 */
function LoadingState({ text = '加载中...' }: { text?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--color-text-muted)', fontSize: 13 }}>
      <div style={{ marginBottom: 8 }}>⏳</div>
      {text}
    </div>
  );
}

export default LoadingState;
