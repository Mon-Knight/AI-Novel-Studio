import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { ModalFrame } from './ModalFrame';
import { usePausableDismiss } from '../../hooks/usePausableDismiss';
import './LoadingModal.css';

export type LoadingModalState = 'loading' | 'success' | 'error';

export interface LoadingModalProps {
  open: boolean;
  state?: LoadingModalState;
  title?: string;
  message?: string;
  stage?: string;
  percent?: number;
  cancelable?: boolean;
  errorMessage?: string;
  /** 0 keeps the result visible. This component is the only dismissal timer owner. */
  autoCloseMs?: number;
  operationId?: string;
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
  operationId = '',
  onCancel,
  onClose,
  onRetry,
}: LoadingModalProps) {
  const readingEvents = usePausableDismiss({
    active: open && state === 'success',
    durationMs: autoCloseMs,
    identity: operationId,
    onDismiss: () => onClose?.(),
  });
  if (!open) return null;
  const showProgress = state === 'loading' && percent >= 0;
  const isIndeterminate = state === 'loading' && percent < 0;
  const resolvedTitle =
    title || (state === 'error' ? '操作未完成' : state === 'success' ? '操作完成' : '正在处理');
  return (
    <ModalFrame
      title={resolvedTitle}
      role={state === 'error' ? 'alertdialog' : 'dialog'}
      maxWidth={440}
      busy={state === 'loading'}
      onDismiss={onClose}
      showCloseButton={false}
      className="loading-modal-card"
      dialogProps={{
        onMouseEnter: readingEvents.onMouseEnter,
        onMouseLeave: readingEvents.onMouseLeave,
        onKeyDownCapture: () => readingEvents.onFocusCapture(),
        onBlurCapture: readingEvents.onBlurCapture,
      }}
      footer={
        <>
          {state === 'loading' && cancelable && (
            <button className="btn btn-secondary" onClick={onCancel}>
              取消
            </button>
          )}
          {state === 'error' && onRetry && (
            <button className="btn btn-primary" onClick={onRetry}>
              重试
            </button>
          )}
          {state !== 'loading' && (
            <button className="btn btn-secondary" onClick={onClose}>
              {state === 'success' ? '完成' : '关闭'}
            </button>
          )}
        </>
      }
    >
      <div className="loading-modal-icon">
        {isIndeterminate && (
          <LoaderCircle
            className="loading-modal-spinner"
            aria-hidden="true"
            size={40}
            strokeWidth={1.8}
          />
        )}
        {state === 'success' && (
          <CircleCheck
            aria-hidden="true"
            size={40}
            strokeWidth={1.8}
            style={{ color: 'var(--color-success-text)' }}
          />
        )}
        {state === 'error' && (
          <CircleX
            aria-hidden="true"
            size={40}
            strokeWidth={1.8}
            style={{ color: 'var(--color-error-text)' }}
          />
        )}
      </div>
      {stage && <div className="loading-modal-stage">{stage}</div>}
      {message && (
        <div className="loading-modal-message" role="status">
          {message}
        </div>
      )}
      {showProgress && (
        <div
          className="loading-modal-progress"
          role="progressbar"
          aria-label="处理进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.max(0, percent))}
        >
          <div
            className="loading-modal-progress-bar"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      )}
      {state === 'error' && errorMessage && (
        <div className="loading-modal-error">{errorMessage}</div>
      )}
    </ModalFrame>
  );
}

export default LoadingModal;
