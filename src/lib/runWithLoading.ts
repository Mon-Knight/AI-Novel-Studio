/**
 * AI Novel Studio - 统一异步任务执行工具
 *
 * 通过全局事件机制触发 LoadingModal 的显示与隐藏，
 * 无需在每个组件中引入 LoadingModal，降低耦合。
 */
import type { LoadingTaskHelpers } from '../hooks/useLoadingTask';
import { describeUnknownError } from '../utils/errorMessage';

// ==================== 类型 ====================

export interface RunWithLoadingOptions {
  title: string;
  initialMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  cancelable?: boolean;
  /** 成功自动关闭延迟（ms），默认 1200，设 0 不自动关闭 */
  successAutoCloseMs?: number;
  /** AbortSignal，用于取消 */
  signal?: AbortSignal;
}

export interface LoadingModalUpdate {
  type: 'show' | 'update' | 'hide' | 'success' | 'error';
  title?: string;
  message?: string;
  stage?: string;
  percent?: number;
  cancelable?: boolean;
  errorMessage?: string;
  autoCloseMs?: number;
}

// ==================== 全局事件名称 ====================
const LOADING_MODAL_EVENT = 'ai-novel-studio:loading-modal';

// ==================== Hook ====================

/**
 * 在 App 根组件中使用的 hook，订阅全局加载事件
 * 返回状态用于渲染 LoadingModal
 */
import { useState, useEffect, useCallback } from 'react';

export interface GlobalLoadingState {
  open: boolean;
  state: 'loading' | 'success' | 'error';
  title: string;
  message: string;
  stage: string;
  percent: number;
  errorMessage: string;
  cancelable: boolean;
  onCancel?: () => void;
  onClose?: () => void;
  onRetry?: () => void;
}

export function useGlobalLoadingModal(
  autoCloseMs = 1200,
): GlobalLoadingState & { closeModal: () => void } {
  const [state, setState] = useState<GlobalLoadingState>({
    open: false,
    state: 'loading',
    title: '',
    message: '',
    stage: '',
    percent: -1,
    errorMessage: '',
    cancelable: false,
  });

  const closeModal = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LoadingModalUpdate>).detail;
      if (!detail) return;

      switch (detail.type) {
        case 'show':
          setState((prev) => ({
            ...prev,
            open: true,
            state: 'loading',
            title: detail.title || prev.title,
            message: detail.message || '正在处理，请稍候……',
            stage: detail.stage || '',
            percent: detail.percent ?? -1,
            cancelable: detail.cancelable ?? false,
            errorMessage: '',
          }));
          break;
        case 'update':
          setState((prev) => ({
            ...prev,
            message: detail.message ?? prev.message,
            stage: detail.stage ?? prev.stage,
            percent: detail.percent ?? prev.percent,
            cancelable: detail.cancelable ?? prev.cancelable,
          }));
          break;
        case 'success': {
          setState((prev) => ({
            ...prev,
            state: 'success',
            message: detail.message || '操作完成',
            stage: '',
            percent: 100,
            cancelable: false,
            errorMessage: '',
          }));
          const successAutoCloseMs = detail.autoCloseMs ?? autoCloseMs;
          if (successAutoCloseMs > 0) {
            setTimeout(() => {
              setState((prev) => ({ ...prev, open: false }));
            }, successAutoCloseMs);
          }
          break;
        }
        case 'error':
          setState((prev) => ({
            ...prev,
            state: 'error',
            message: detail.message || '操作失败',
            errorMessage: detail.errorMessage || '',
            cancelable: false,
          }));
          break;
        case 'hide':
          setState((prev) => ({ ...prev, open: false }));
          break;
      }
    };

    window.addEventListener(LOADING_MODAL_EVENT, handler);
    return () => window.removeEventListener(LOADING_MODAL_EVENT, handler);
  }, [autoCloseMs]);

  return { ...state, closeModal };
}

// ==================== 工具函数 ====================

function emit(event: LoadingModalUpdate): void {
  window.dispatchEvent(
    new CustomEvent<LoadingModalUpdate>(LOADING_MODAL_EVENT, {
      detail: event,
    }),
  );
}

/**
 * 运行带全局加载弹窗的异步任务
 *
 * @example
 * ```ts
 * await runWithLoading({
 *   title: 'AI 正在生成正文',
 *   initialMessage: '正在构建上下文……',
 *   successMessage: '正文生成完成',
 * }, async ({ setMessage, setStage, setPercent }) => {
 *   setStage('准备参数');
 *   const result = await generateChapter();
 *   return result;
 * });
 * ```
 */
export async function runWithLoading<T>(
  options: RunWithLoadingOptions,
  task: (helpers: LoadingTaskHelpers) => Promise<T>,
): Promise<T> {
  const {
    title,
    initialMessage = '正在处理，请稍候……',
    successMessage = '操作完成',
    errorMessage = '操作失败',
    cancelable = false,
    successAutoCloseMs = 1200,
    signal,
  } = options;

  // 显示弹窗
  emit({
    type: 'show',
    title,
    message: initialMessage,
    cancelable,
  });

  const helpers: LoadingTaskHelpers = {
    setMessage: (message: string) => emit({ type: 'update', message }),
    setStage: (stage: string) => emit({ type: 'update', stage }),
    setPercent: (percent: number) => emit({ type: 'update', percent }),
    setCancelable: (c: boolean) => emit({ type: 'update', cancelable: c }),
  };

  try {
    // 支持 AbortSignal
    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        const onAbort = () => {
          reject(new DOMException('任务已取消', 'AbortError'));
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
      const result = await Promise.race([task(helpers), abortPromise]);
      emit({ type: 'success', message: successMessage, autoCloseMs: successAutoCloseMs });
      return result;
    }

    const result = await task(helpers);
    emit({ type: 'success', message: successMessage, autoCloseMs: successAutoCloseMs });
    return result;
  } catch (error: unknown) {
    const msg = describeUnknownError(error, '操作失败');
    const isAborted = error instanceof DOMException && error.name === 'AbortError';
    emit({
      type: 'error',
      message: isAborted ? '操作已取消' : errorMessage,
      errorMessage: isAborted ? '' : msg,
    });
    throw error;
  }
}

/** 手动关闭弹窗（异常情况） */
export function dismissLoadingModal(): void {
  emit({ type: 'hide' });
}
