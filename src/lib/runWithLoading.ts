/**
 * AI Novel Studio - 统一异步任务执行工具
 *
 * 通过全局事件机制触发 LoadingModal 的显示与隐藏，
 * 无需在每个组件中引入 LoadingModal，降低耦合。
 */
import type { LoadingTaskHelpers } from '../hooks/useLoadingTask';
import { AiRequestCancelledError, isAiRequestCancelled } from '../services/ai/aiCancellation';

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
  /** 可重放操作身份；省略时自动生成 */
  operationId?: string;
}

export interface LoadingTaskContext extends LoadingTaskHelpers {
  signal: AbortSignal;
  operationId: string;
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
  operationId?: string;
}

// ==================== 全局事件名称 ====================
const LOADING_MODAL_EVENT = 'ai-novel-studio:loading-modal';

interface ActiveLoadingOperation {
  controller: AbortController;
  cancelRequested: boolean;
}

const activeLoadingOperations = new Map<string, ActiveLoadingOperation>();

function createLoadingOperationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `loading-${uuid}` : `loading-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cancelLoadingOperation(operationId: string): boolean {
  const active = activeLoadingOperations.get(operationId);
  if (!active || active.controller.signal.aborted) return false;
  active.cancelRequested = true;
  active.controller.abort();
  emit({
    type: 'update',
    operationId,
    message: '正在停止当前任务…',
    stage: '等待请求安全结束',
    cancelable: false,
  });
  return true;
}

export function getActiveLoadingOperationCountForTests(): number {
  return activeLoadingOperations.size;
}

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
  operationId?: string;
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
            operationId: detail.operationId,
            onCancel:
              detail.cancelable && detail.operationId
                ? () => cancelLoadingOperation(detail.operationId!)
                : undefined,
          }));
          break;
        case 'update':
          setState((prev) => {
            if (detail.operationId && prev.operationId !== detail.operationId) return prev;
            const nextCancelable = detail.cancelable ?? prev.cancelable;
            return {
              ...prev,
              message: detail.message ?? prev.message,
              stage: detail.stage ?? prev.stage,
              percent: detail.percent ?? prev.percent,
              cancelable: nextCancelable,
              onCancel:
                nextCancelable && prev.operationId
                  ? () => cancelLoadingOperation(prev.operationId!)
                  : undefined,
            };
          });
          break;
        case 'success': {
          setState((prev) => {
            if (detail.operationId && prev.operationId !== detail.operationId) return prev;
            return {
              ...prev,
              state: 'success',
              message: detail.message || '操作完成',
              stage: '',
              percent: 100,
              cancelable: false,
              errorMessage: '',
              onCancel: undefined,
            };
          });
          const successAutoCloseMs = detail.autoCloseMs ?? autoCloseMs;
          if (successAutoCloseMs > 0) {
            setTimeout(() => {
              setState((prev) =>
                detail.operationId && prev.operationId !== detail.operationId
                  ? prev
                  : { ...prev, open: false },
              );
            }, successAutoCloseMs);
          }
          break;
        }
        case 'error':
          setState((prev) => {
            if (detail.operationId && prev.operationId !== detail.operationId) return prev;
            return {
              ...prev,
              state: 'error',
              message: detail.message || '操作失败',
              errorMessage: detail.errorMessage || '',
              cancelable: false,
              onCancel: undefined,
            };
          });
          break;
        case 'hide':
          setState((prev) =>
            detail.operationId && prev.operationId !== detail.operationId
              ? prev
              : { ...prev, open: false },
          );
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
  task: (context: LoadingTaskContext) => Promise<T>,
): Promise<T> {
  const {
    title,
    initialMessage = '正在处理，请稍候……',
    successMessage = '操作完成',
    errorMessage = '操作失败',
    cancelable = false,
    successAutoCloseMs = 1200,
    signal: externalSignal,
    operationId = createLoadingOperationId(),
  } = options;

  if (activeLoadingOperations.has(operationId)) {
    throw new Error(`加载任务 operationId 正在执行：${operationId}`);
  }

  const controller = new AbortController();
  const active: ActiveLoadingOperation = { controller, cancelRequested: false };
  activeLoadingOperations.set(operationId, active);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();

  // 显示弹窗
  emit({
    type: 'show',
    operationId,
    title,
    message: initialMessage,
    cancelable,
  });

  const helpers: LoadingTaskHelpers = {
    setMessage: (message: string) => emit({ type: 'update', operationId, message }),
    setStage: (stage: string) => emit({ type: 'update', operationId, stage }),
    setPercent: (percent: number) => emit({ type: 'update', operationId, percent }),
    setCancelable: (c: boolean) => emit({ type: 'update', operationId, cancelable: c }),
  };
  const context: LoadingTaskContext = {
    ...helpers,
    signal: controller.signal,
    operationId,
  };

  try {
    const result = await task(context);
    if (controller.signal.aborted) throw new AiRequestCancelledError();
    emit({
      type: 'success',
      operationId,
      message: successMessage,
      autoCloseMs: successAutoCloseMs,
    });
    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAborted =
      controller.signal.aborted ||
      isAiRequestCancelled(error) ||
      (error instanceof DOMException && error.name === 'AbortError');
    emit({
      type: 'error',
      operationId,
      message: isAborted ? '操作已取消' : errorMessage,
      errorMessage: isAborted ? '' : msg,
    });
    if (isAborted && !isAiRequestCancelled(error)) throw new AiRequestCancelledError();
    throw error;
  } finally {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    if (activeLoadingOperations.get(operationId) === active) {
      activeLoadingOperations.delete(operationId);
    }
  }
}

/** 手动关闭弹窗（异常情况） */
export function dismissLoadingModal(): void {
  emit({ type: 'hide' });
}
