import { useEffect, useState } from 'react';
import type { RunningTaskTarget } from '../../types/conversation';
import { taskConversationWindow } from '../../services/conversation/taskConversationWindow';

/** Advisory peers only. A failed read yields no hint rather than a guessed chapter. */
export function useRunningTaskTargets(
  novelId: string,
  runningIds: ReadonlySet<string>,
): RunningTaskTarget[] {
  const [targets, setTargets] = useState<RunningTaskTarget[]>([]);
  const runningKey = [...runningIds].sort().join('\0');
  useEffect(() => {
    if (!novelId) {
      setTargets([]);
      return undefined;
    }
    let cancelled = false;
    void taskConversationWindow.listRunningTargets(novelId).then(
      (rows) => {
        if (!cancelled) setTargets(rows);
      },
      () => {
        if (!cancelled) setTargets([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [novelId, runningKey]);
  return targets;
}
