import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { registerToastListener, type ToastItem } from '../utils/toast';
import { usePausableDismiss } from '../hooks/usePausableDismiss';
import './Toast.css';

const MAX_TOASTS = 3;

function ToastNotification({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const readingEvents = usePausableDismiss({
    active: true,
    durationMs: toast.durationMs ?? (toast.kind === 'error' || toast.kind === 'warning' ? 0 : 4000),
    identity: toast.id,
    onDismiss: () => onDismiss(toast.id),
  });
  return (
    <div
      className={`toast-item toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      tabIndex={0}
      {...readingEvents}
      data-toast-id={toast.id}
      data-testid={
        toast.kind === 'error'
          ? 'error-notice'
          : toast.kind === 'success'
            ? 'success-notice'
            : undefined
      }
    >
      <div className="toast-content">
        {toast.title && <div className="toast-title">{toast.title}</div>}
        <div className="toast-message">{toast.message}</div>
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label={`关闭通知：${toast.title || toast.message}`}
        title="关闭"
      >
        <X aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  const addToast = useCallback((toast: ToastItem) => {
    // Unread notifications are queued, not deleted when the visible stack fills.
    setToasts((current) => [...current, toast]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  useEffect(() => registerToastListener(addToast), [addToast]);

  const ordered = [...toasts].sort((left, right) => {
    const priority = (toast: ToastItem) =>
      toast.kind === 'error' ? 0 : toast.kind === 'warning' ? 1 : 2;
    return priority(left) - priority(right) || left.id - right.id;
  });
  const visible = showAll ? ordered : ordered.slice(0, MAX_TOASTS);
  return (
    <>
      {children}
      {toasts.length > 0 && (
        <section className="toast-viewport" aria-label="通知">
          {visible.map((toast) => (
            <ToastNotification key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
          {toasts.length > MAX_TOASTS && (
            <button
              type="button"
              className="toast-more"
              onClick={() => setShowAll((value) => !value)}
              aria-expanded={showAll}
            >
              {showAll ? '收起通知' : `还有 ${toasts.length - MAX_TOASTS} 条通知，查看全部`}
            </button>
          )}
        </section>
      )}
    </>
  );
}

export default ToastProvider;
