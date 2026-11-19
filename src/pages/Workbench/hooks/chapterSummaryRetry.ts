import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ChapterSummaryOrchestrationState } from '../../../services/conversation/chapterSummaryOrchestration';

/** Page-level retry only clears one failed automatic start; the native task still owns the run. */
export function useChapterSummaryRetry(
  state: ChapterSummaryOrchestrationState,
  failures: { delete: (turnId: string) => unknown },
  bumpEpoch: Dispatch<SetStateAction<number>>,
): () => void {
  return useCallback(() => {
    const turnId = state.turnId;
    if (state.phase !== 'failed' || state.runId || !turnId) return;
    failures.delete(turnId);
    bumpEpoch((current) => current + 1);
  }, [state, failures, bumpEpoch]);
}
