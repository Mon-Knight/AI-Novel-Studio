/**
 * AI Novel Studio - 统一异步任务管理 Hook
 *
 * 封装 loading / error / success 状态管理，
 * 与 LoadingModal 配合使用时自动处理弹窗生命周期。
 */
import { useState, useCallback, useRef } from 'react';
import type { LoadingModalState } from '../components/common/LoadingModal';

export interface LoadingTaskState {
  modalOpen: boolean;
  modalState: LoadingModalState;
  title: string;
  message: string;
  stage: string;
  percent: number;
  errorMessage: string;
  cancelable: boolean;
}

export interface LoadingTaskOptions {
  /** 弹窗标题 */
  title: string;
  /** 初始消息 */
  initialMessage?: string;
  /** 是否可取消 */
  cancelable?: boolean;
  /** 成功时自动关闭延迟（ms），默认 1200 */
  successAutoCloseMs?: number;
}

export interface LoadingTaskHelpers {
  setMessage: (message: string) => void;
  setStage: (stage: string) => void;
  setPercent: (percent: number) => void;
  setCancelable: (cancelable: boolean) => void;
}

export interface UseLoadingTaskReturn {
  /** 当前状态 */
  state: LoadingTaskState;
  /** 是否正在执行 */
  isProcessing: boolean;
  /** 运行任务 */
  run: <T>(
    task: (helpers: LoadingTaskHelpers) => Promise<T>,
    options?: LoadingTaskOptions,
  ) => Promise<T>;
  /** 关闭弹窗 */
  closeModal: () => void;
  /** 重置状态 */
  reset: () => void;
}

const initialState: LoadingTaskState = {
  modalOpen: false,
  modalState: 'loading',
  title: '',
  message: '',
  stage: '',
  percent: -1,
  errorMessage: '',
  cancelable: false,
};

export function useLoadingTask(): UseLoadingTaskReturn {
  const [state, setState] = useState<LoadingTaskState>(initialState);
  const isProcessingRef = useRef(false);
  const currentTaskRef = useRef<AbortController | null>(null);

  const helpers: LoadingTaskHelpers = {
    setMessage: useCallback((message: string) => {
      setState((prev) => ({ ...prev, message }));
    }, []),
    setStage: useCallback((stage: string) => {
      setState((prev) => ({ ...prev, stage }));
    }, []),
    setPercent: useCallback((percent: number) => {
      setState((prev) => ({ ...prev, percent }));
    }, []),
    setCancelable: useCallback((cancelable: boolean) => {
      setState((prev) => ({ ...prev, cancelable }));
    }, []),
  };

  const closeModal = useCallback(() => {
    setState((prev) => ({ ...prev, modalOpen: false }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
    isProcessingRef.current = false;
    currentTaskRef.current = null;
  }, []);

  const run = useCallback(
    async <T>(
      task: (helpers: LoadingTaskHelpers) => Promise<T>,
      options?: LoadingTaskOptions,
    ): Promise<T> => {
      const {
        title,
        initialMessage = '正在处理，请稍候……',
        cancelable = false,
        successAutoCloseMs = 1200,
      } = options || { title: '处理中' };

      // 防止重复执行
      if (isProcessingRef.current) {
        throw new Error('已有任务正在执行');
      }

      isProcessingRef.current = true;
      const abortController = new AbortController();
      currentTaskRef.current = abortController;

      // 打开 loading 弹窗
      setState({
        modalOpen: true,
        modalState: 'loading',
        title,
        message: initialMessage,
        stage: '',
        percent: -1,
        errorMessage: '',
        cancelable,
      });

      try {
        const result = await task(helpers);

        // 成功
        setState((prev) => ({
          ...prev,
          modalState: 'success',
          message: '操作完成',
          percent: 100,
          stage: '',
          cancelable: false,
        }));

        // 自动关闭
        if (successAutoCloseMs > 0) {
          setTimeout(() => {
            setState((prev) => ({ ...prev, modalOpen: false }));
            isProcessingRef.current = false;
            currentTaskRef.current = null;
          }, successAutoCloseMs);
        }

        isProcessingRef.current = false;
        currentTaskRef.current = null;
        return result;
      } catch (error: unknown) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);

        // 错误状态
        setState((prev) => ({
          ...prev,
          modalState: 'error',
          message: '操作失败',
          errorMessage: errorMsg,
          cancelable: false,
        }));

        isProcessingRef.current = false;
        currentTaskRef.current = null;
        throw error;
      }
    },
    [helpers],
  );

  return {
    state,
    isProcessing: isProcessingRef.current,
    run,
    closeModal,
    reset,
  };
}
