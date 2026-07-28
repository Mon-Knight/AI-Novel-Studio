import { appLogger } from '../services/observability/appLogger';
/**
 * Native Feel P2.3.2 — DOM Toast 轻量提示工具
 *
 * 可在 React 组件外调用。
 * ToastProvider 未挂载时安全回退到 console。
 * 不依赖任何第三方库。
 */

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  title?: string;
  message: string;
  durationMs?: number;
}

export interface ToastItem extends ToastOptions {
  id: number;
  createdAt: number;
}

type ToastListener = (toast: ToastItem) => void;

let _nextId = 0;
let _listener: ToastListener | null = null;

export function registerToastListener(fn: ToastListener): () => void {
  _listener = fn;
  return () => {
    if (_listener === fn) _listener = null;
  };
}

export function showToast(options: ToastOptions): void {
  const { kind = 'info', title, message, durationMs = 4000 } = options;
  if (!message) return;

  const item: ToastItem = {
    id: ++_nextId,
    kind,
    title,
    message,
    durationMs,
    createdAt: Date.now(),
  };

  if (_listener) {
    _listener(item);
    return;
  }

  // ToastProvider 未挂载时的安全回退
  const diagnostic = { kind, hasTitle: Boolean(title), messageLength: message.length };
  if (kind === 'error') appLogger.error('TOAST_PROVIDER_UNAVAILABLE', diagnostic);
  else appLogger.info('TOAST_PROVIDER_UNAVAILABLE', diagnostic);
}
