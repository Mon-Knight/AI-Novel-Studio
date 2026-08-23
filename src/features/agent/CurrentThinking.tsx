import { memo, useEffect, useRef, useState } from 'react';

export interface CurrentThinkingProps {
  thought?: string;
  thoughtListenerRef?: React.MutableRefObject<((chunk: string) => void) | null>;
}

export const CurrentThinking = memo(function CurrentThinking({
  thought = '',
  thoughtListenerRef,
}: CurrentThinkingProps) {
  const [localThought, setLocalThought] = useState(thought);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalThought(thought);
  }, [thought]);

  useEffect(() => {
    if (thoughtListenerRef) {
      thoughtListenerRef.current = (chunk: string) => {
        setLocalThought(chunk);
      };
      return () => {
        thoughtListenerRef.current = null;
      };
    }
    return undefined;
  }, [thoughtListenerRef]);

  if (!localThought) return null;

  return (
    <div
      ref={containerRef}
      className="agent-thinking-card"
      data-testid="agent-thinking-card"
      style={{
        padding: '10px 12px',
        borderRadius: 6,
        background: '#f8fafc',
        border: '1px dashed #cbd5e1',
        fontSize: 12,
        color: '#475569',
        margin: '6px 0',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: '#334155' }}>🧠 思考与规划中:</div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{localThought}</div>
    </div>
  );
});
