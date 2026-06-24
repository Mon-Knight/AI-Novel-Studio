/**
 * AI Novel Studio — DOM Toast Provider (Native Feel P2.3.2)
 *
 * 轻量页面内提示组件。
 * 默认显示在窗口右上角，最多同时 3 条，自动消失。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { registerToastListener, type ToastItem } from '../utils/toast';
import './Toast.css';

const MAX_TOASTS = 3;

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => {
      const next = [...prev, toast];
      if (next.length > MAX_TOASTS) {
        // 移除最旧的一条
        const removed = next.shift()!;
        const timer = timersRef.current.get(removed.id);
        if (timer) { clearTimeout(timer); timersRef.current.delete(removed.id); }
      }
      return next;
    });

    // 自动消失
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      timersRef.current.delete(toast.id);
    }, toast.durationMs ?? 4000);
    timersRef.current.set(toast.id, timer);
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const unregister = registerToastListener(addToast);
    const timers = timersRef.current;
    return () => {
      unregister();
      // 清理所有 timer
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, [addToast]);

  return (
    <>
      {children}
      {toasts.length > 0 && (
        <div className="toast-viewport" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast-item toast-${toast.kind}`}
              role="status"
            >
              <div className="toast-content">
                {toast.title && <div className="toast-title">{toast.title}</div>}
                <div className="toast-message">{toast.message}</div>
              </div>
              <button
                className="toast-close"
                onClick={() => dismissToast(toast.id)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default ToastProvider;
