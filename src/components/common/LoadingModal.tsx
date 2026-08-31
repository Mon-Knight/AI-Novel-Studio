/**
 * AI Novel Studio - 统一加载弹窗组件
 *
 * 状态：loading / success / error / cancelable
 * - loading: 旋转动画 + 进度条（可选）+ 阶段文案
 * - success: 绿色图标 + 成功文案，自动关闭
 * - error: 红色图标 + 错误文案 + 关闭按钮
 */
import { useEffect, useRef } from 'react';
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import './LoadingModal.css';

export type LoadingModalState = 'loading' | 'success' | 'error';

export interface LoadingModalProps {
  open: boolean;
  state?: LoadingModalState;
  title?: string;
  message?: string;
  stage?: string;
  /** 0-100 进度（loading 时有效，-1 表示不确定进度） */
  percent?: number;
  /** 可取消时显示取消按钮 */
  cancelable?: boolean;
  /** 错误时是否显示详情 */
  errorMessage?: string;
  /** 成功时自动关闭的延迟（ms），默认 1200，设为 0 不自动关闭 */
  autoCloseMs?: number;
  onCancel?: () => void;
  onClose?: () => void;
  onRetry?: () => void;
}

function LoadingModal({
  open,
  state = 'loading',
  title,
  message,
  stage,
  percent = -1,
  cancelable = false,
  errorMessage,
  autoCloseMs = 1200,
  onCancel,
  onClose,
  onRetry,
}: LoadingModalProps) {
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open && state === 'success' && autoCloseMs > 0) {
      autoCloseTimer.current = setTimeout(() => {
        onClose?.();
      }, autoCloseMs);
    }
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    };
  }, [open, state, autoCloseMs, onClose]);

  if (!open) return null;

  const showProgress = state === 'loading' && percent >= 0;
  const isIndeterminate = state === 'loading' && percent < 0;

  return (
    <>
      <div className="loading-modal-overlay" onClick={state === 'error' ? onClose : undefined} />
      <div
        className="loading-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        {/* 图标区 */}
        <div className="loading-modal-icon">
          {state === 'loading' && (
            <LoaderCircle
              className="loading-modal-spinner"
              aria-hidden="true"
              size={40}
              strokeWidth={1.8}
            />
          )}
          {state === 'success' && (
            <CircleCheck
              className="loading-modal-check"
              aria-hidden="true"
              size={40}
              strokeWidth={1.8}
              style={{ color: 'var(--color-success)' }}
            />
          )}
          {state === 'error' && (
            <CircleX
              className="loading-modal-cross"
              aria-hidden="true"
              size={40}
              strokeWidth={1.8}
              style={{ color: 'var(--color-error)' }}
            />
          )}
        </div>

        {/* 标题 */}
        {title && <div className="loading-modal-title">{title}</div>}

        {/* 阶段文案 */}
        {stage && <div className="loading-modal-stage">{stage}</div>}

        {/* 消息 */}
        {message && <div className="loading-modal-message">{message}</div>}

        {/* 进度条 */}
        {showProgress && (
          <div className="loading-modal-progress">
            <div
              className="loading-modal-progress-bar"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
        )}

        {/* 不确定进度动画 */}
        {isIndeterminate && (
          <div className="loading-modal-progress">
            <div className="loading-modal-progress-indeterminate" />
          </div>
        )}

        {/* 错误详情 */}
        {state === 'error' && errorMessage && (
          <div className="loading-modal-error">{errorMessage}</div>
        )}

        {/* 操作按钮 */}
        <div className="loading-modal-actions">
          {state === 'loading' && cancelable && (
            <button className="loading-modal-btn loading-modal-btn-cancel" onClick={onCancel}>
              取消
            </button>
          )}
          {state === 'error' && (
            <>
              {onRetry && (
                <button className="loading-modal-btn loading-modal-btn-retry" onClick={onRetry}>
                  重试
                </button>
              )}
              <button className="loading-modal-btn loading-modal-btn-close" onClick={onClose}>
                关闭
              </button>
            </>
          )}
          {state === 'success' && autoCloseMs === 0 && (
            <button className="loading-modal-btn loading-modal-btn-close" onClick={onClose}>
              完成
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default LoadingModal;
