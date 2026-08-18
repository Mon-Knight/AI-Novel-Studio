import { useCallback, useEffect, useRef } from 'react';

export interface MultiAgentRequestTarget {
  novelId?: string;
  chapterId?: string;
}

export interface MultiAgentRequestLease {
  signal: AbortSignal;
  isLive(): boolean;
  assertLive(): void;
  finish(): boolean;
}

function sameTarget(left: MultiAgentRequestTarget, right: MultiAgentRequestTarget): boolean {
  return left.novelId === right.novelId && left.chapterId === right.chapterId;
}

export function useMultiAgentRequestGuard(target: MultiAgentRequestTarget) {
  const mountedRef = useRef(true);
  const targetRef = useRef(target);
  const epochRef = useRef(0);
  const activeRef = useRef<{
    epoch: number;
    controller: AbortController;
  } | null>(null);

  targetRef.current = target;

  const invalidate = useCallback(() => {
    epochRef.current += 1;
    activeRef.current?.controller.abort();
    activeRef.current = null;
  }, []);

  useEffect(() => {
    invalidate();
  }, [invalidate, target.chapterId, target.novelId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidate();
    };
  }, [invalidate]);

  const isTargetLive = useCallback((expected: MultiAgentRequestTarget) => {
    return mountedRef.current && sameTarget(targetRef.current, expected);
  }, []);

  const begin = useCallback(
    (expected: MultiAgentRequestTarget): MultiAgentRequestLease => {
      invalidate();
      const controller = new AbortController();
      const epoch = epochRef.current;
      activeRef.current = { epoch, controller };

      const ownsCurrentRequest = () =>
        mountedRef.current &&
        epochRef.current === epoch &&
        activeRef.current?.epoch === epoch &&
        sameTarget(targetRef.current, expected);
      const isLive = () => ownsCurrentRequest() && !controller.signal.aborted;

      return {
        signal: controller.signal,
        isLive,
        assertLive() {
          if (!isLive()) throw new DOMException('Multi-Agent 请求目标已变化。', 'AbortError');
        },
        finish() {
          if (!ownsCurrentRequest()) return false;
          activeRef.current = null;
          return true;
        },
      };
    },
    [invalidate],
  );

  const cancelActive = useCallback(() => {
    activeRef.current?.controller.abort();
  }, []);

  return { begin, cancelActive, isTargetLive };
}
