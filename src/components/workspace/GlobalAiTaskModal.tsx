/**
 * AI Novel Studio - 全局 AI 任务弹窗
 * v1.7.19: 居中 overlay，显示 loading/spinner/阶段/进度条
 */
import { useState, useEffect } from 'react';
import type { AiTaskModalState } from '../../types/workspaceSafety';
export type { AiTaskModalState } from '../../types/workspaceSafety';

interface GlobalAiTaskModalProps {
  state: AiTaskModalState;
}

/** 简单的旋转 spinner 字符帧 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function GlobalAiTaskModal({ state }: GlobalAiTaskModalProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [state.running]);

  if (!state.running) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'var(--color-overlay)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-card)',
          borderRadius: 12,
          padding: '32px 40px',
          minWidth: 360,
          maxWidth: 440,
          boxShadow: 'var(--shadow-lg)',
          textAlign: 'center',
        }}
      >
        {/* Spinner */}
        <div
          style={{
            fontSize: 40,
            color: 'var(--color-secondary-accent)',
            marginBottom: 16,
            lineHeight: 1,
          }}
        >
          {SPINNER_FRAMES[frame]}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 6,
          }}
        >
          {state.title}
        </div>

        {/* Subtitle */}
        {state.subtitle && (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            {state.subtitle}
          </div>
        )}

        {/* Stage */}
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-secondary-accent)',
            marginBottom: 16,
            fontWeight: 500,
          }}
        >
          {state.stage}
        </div>

        {/* Progress bar */}
        <div
          style={{
            background: 'var(--color-border)',
            borderRadius: 6,
            height: 6,
            overflow: 'hidden',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, Math.max(0, state.progress))}%`,
              background:
                'linear-gradient(90deg, var(--color-secondary-accent), var(--color-secondary-accent))',
              borderRadius: 6,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{state.progress}%</div>
      </div>
    </div>
  );
}

export default GlobalAiTaskModal;
