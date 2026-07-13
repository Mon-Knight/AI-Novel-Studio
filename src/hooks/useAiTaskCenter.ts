import { useEffect, useSyncExternalStore } from 'react';
import { aiTaskStore } from '../store/aiTaskStore';
import { aiTaskCenterService } from '../services/ai-tasks/aiTaskCenterService';
import { isTauri } from '../services/database/db';
import { aiWorkerClientService } from '../services/ai-tasks/aiWorkerClientService';

export function useAiTaskCenter(options?: { pollMs?: number; refreshOnMount?: boolean }) {
  const snapshot = useSyncExternalStore(
    aiTaskStore.subscribe,
    aiTaskStore.getSnapshot,
    aiTaskStore.getSnapshot,
  );

  useEffect(() => {
    if (options?.refreshOnMount !== false) {
      void aiTaskCenterService.refresh().catch(() => undefined);
    }
    const pollMs = options?.pollMs ?? 0;
    if (pollMs <= 0) return;
    const timer = window.setInterval(() => {
      void aiTaskCenterService.refresh().catch(() => undefined);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [options?.pollMs, options?.refreshOnMount]);

  useEffect(() => {
    if (!isTauri()) return;
    void aiWorkerClientService.configureFromLocalSettings().catch(() => undefined);
    let disposed = false;
    let removeListener: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => listen<{
      taskId: string;
      status: import('../types/ai-task').UnifiedAiTaskStatus;
      progressStage: string;
      progressPercent: number;
      errorMessage?: string;
    }>('ai-task-progress', (event) => {
      const payload = event.payload;
      aiTaskStore.upsert({
        taskId: payload.taskId,
        status: payload.status,
        progress: payload.progressStage,
        errorSummary: payload.errorMessage,
      });
      if (['completed', 'failed', 'cancelled'].includes(payload.status)) {
        void aiTaskCenterService.refresh().catch(() => undefined);
      }
    })).then((unlisten) => {
      if (disposed) unlisten();
      else removeListener = unlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  return {
    ...snapshot,
    refresh: aiTaskCenterService.refresh,
  };
}
