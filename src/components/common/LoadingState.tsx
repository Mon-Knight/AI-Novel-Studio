/**
 * AI Novel Studio - 通用加载状态组件
 */
import { LoaderCircle } from 'lucide-react';

function LoadingState({ text = '加载中...' }: { text?: string }) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '24px 16px',
        color: 'var(--color-text-muted)',
        fontSize: 13,
      }}
    >
      <LoaderCircle aria-hidden="true" size={20} strokeWidth={1.8} style={{ marginBottom: 8 }} />
      {text}
    </div>
  );
}

export default LoadingState;
