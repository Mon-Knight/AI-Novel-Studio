import { useEffect, useRef, useState } from 'react';
import { taskSessionAdapter } from '../../../services/dsh/taskSessionAdapter';
import { shouldRefreshRuntimeBundleAfterPoll } from './trailingRefreshQueue';

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export interface UseWorkbenchRuntimeHeartbeatOptions {
  selectedNovelRef: React.MutableRefObject<string>;
  selectedConversationIdRef: React.MutableRefObject<string | undefined>;
  selectedConversationId: string | undefined;
  persistedSelectedRunActive: boolean;
  refreshRuntimeBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId: string) => Promise<void>;
}

export interface WorkbenchRuntimeHeartbeat {
  runningConversationIds: Set<string>;
  setRunningConversationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  runtimeStatusReady: boolean;
  setRuntimeStatusReady: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useWorkbenchRuntimeHeartbeat(
  options: UseWorkbenchRuntimeHeartbeatOptions,
): WorkbenchRuntimeHeartbeat {
  const {
    selectedNovelRef,
    selectedConversationIdRef,
    selectedConversationId,
    persistedSelectedRunActive,
    refreshRuntimeBundle,
    loadConversations,
  } = options;

  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [runtimeStatusReady, setRuntimeStatusReady] = useState(false);
  const observedRuntimeIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let unlisten: (() => void) | undefined;

    const handleProjection = (notice: {
      conversationId: string;
      kind: 'run' | 'tool' | 'assistant' | 'artifact' | 'terminal';
    }) => {
      if (disposed) return;
      setRuntimeStatusReady(true);
      const terminal = notice.kind === 'terminal';
      const observed = new Set(observedRuntimeIdsRef.current);
      if (terminal) observed.delete(notice.conversationId);
      else observed.add(notice.conversationId);
      observedRuntimeIdsRef.current = observed;
      setRunningConversationIds((current) => {
        const next = new Set(current);
        if (terminal) next.delete(notice.conversationId);
        else next.add(notice.conversationId);
        return setsEqual(current, next) ? current : next;
      });

      if (selectedConversationIdRef.current === notice.conversationId) {
        void refreshRuntimeBundle(notice.conversationId);
      }
      if ((notice.kind === 'run' || terminal) && selectedNovelRef.current) {
        void loadConversations(selectedNovelRef.current);
      }
    };

    const subscribe = async () => {
      try {
        const release = await taskSessionAdapter.subscribeToRuntimeProjections(handleProjection);
        if (disposed) release();
        else unlisten = release;
      } catch {
        if (!disposed) retryTimer = window.setTimeout(() => void subscribe(), 1_000);
      }
    };

    void subscribe();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [loadConversations, refreshRuntimeBundle, selectedConversationIdRef, selectedNovelRef]);

  // Renderer reloads lose JS workers. Keep polling until Rust and persisted
  // conversation facts agree on a terminal state; projection events accelerate it.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let refreshInFlight = false;

    const refreshRunning = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const ids = await taskSessionAdapter.listRunningConversationIds();
        if (!cancelled) {
          setRuntimeStatusReady(true);
          const next = new Set(ids);
          const previous = observedRuntimeIdsRef.current;
          const changed = !setsEqual(previous, next);
          observedRuntimeIdsRef.current = next;
          setRunningConversationIds((current) => {
            current.forEach((id) => {
              if (taskSessionAdapter.isRunning(id)) next.add(id);
            });
            if (setsEqual(current, next)) return current;
            return next;
          });

          const selectedId = selectedConversationIdRef.current;
          if (selectedId && shouldRefreshRuntimeBundleAfterPoll(previous, next, selectedId)) {
            await refreshRuntimeBundle(selectedId);
          }
          if (changed && selectedNovelRef.current) {
            await loadConversations(selectedNovelRef.current);
          }
        }
      } catch {
        // A transient IPC failure must not permanently stop reload recovery.
      } finally {
        refreshInFlight = false;
      }
    };

    void refreshRunning();

    if (!runtimeStatusReady || runningConversationIds.size > 0 || persistedSelectedRunActive) {
      timer = window.setInterval(() => void refreshRunning(), 1500);
    }

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [
    loadConversations,
    persistedSelectedRunActive,
    refreshRuntimeBundle,
    runningConversationIds.size,
    runtimeStatusReady,
    selectedConversationId,
    selectedConversationIdRef,
    selectedNovelRef,
  ]);

  return {
    runningConversationIds,
    setRunningConversationIds,
    runtimeStatusReady,
    setRuntimeStatusReady,
  };
}
