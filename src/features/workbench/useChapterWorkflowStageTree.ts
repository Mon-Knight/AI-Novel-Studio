/**
 * Feature hook for the read-only chapter stage tree.
 *
 * A caller must opt in with an explicit `enabled` flag and an explicit
 * conversation/workflow/chapter scope. Legacy tasks therefore do not show the
 * new tree unless their host deliberately enables it. Reads happen only when
 * `enabled`, the scope identity, or `refreshToken` changes; there is no timer or
 * background polling. A scope change immediately hides old facts and a stale
 * response from the previous scope is ignored.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  readChapterWorkflowStages,
  type ChapterWorkflowStageReadResult,
} from '../../services/conversation/chapterWorkflowStageReader';
import type { ChapterStage } from './chapterStageProjection';
import {
  mapChapterWorkflowStagesToTree,
  type ChapterCandidateEvidence,
  type ChapterStagePlanMapping,
} from './chapterWorkflowStageTreeMapping';

export interface ChapterWorkflowStageTreeScope {
  readonly novelId: string;
  readonly chapterId: string;
  readonly conversationId?: string;
  readonly workflowId?: string;
  readonly runId?: string;
}

export type ChapterWorkflowStageTreeReason =
  'disabled' | 'no_scope' | 'browser' | 'ready' | 'error';

export interface UseChapterWorkflowStageTreeOptions {
  /** Must be explicit; old tasks default to false. */
  readonly enabled: boolean;
  readonly scope: ChapterWorkflowStageTreeScope | null;
  /** Any changed value triggers exactly one explicit re-read. */
  readonly refreshToken?: string | number;
  readonly plan?: ChapterStagePlanMapping;
  /**
   * Requires the full card identity (cardId, conversationId, turnId/workflowId,
   * runId) plus source novel/chapter. A candidate never completes from a card
   * that belongs to another task, turn, or chapter.
   */
  readonly candidateEvidence?: readonly ChapterCandidateEvidence[];
}

export interface ChapterWorkflowStageTreeState {
  readonly stages: readonly ChapterStage[];
  readonly read: ChapterWorkflowStageReadResult | null;
  readonly loading: boolean;
  readonly error: string;
  readonly reason: ChapterWorkflowStageTreeReason;
}

interface LoadState {
  readonly key: string;
  readonly read: ChapterWorkflowStageReadResult | null;
  readonly loading: boolean;
  readonly error: string;
  readonly reason: ChapterWorkflowStageTreeReason;
}

const EMPTY_STAGES: readonly ChapterStage[] = [];

const INITIAL_STATE: LoadState = {
  key: '',
  read: null,
  loading: false,
  error: '',
  reason: 'disabled',
};

export function useChapterWorkflowStageTree(
  options: UseChapterWorkflowStageTreeOptions,
): ChapterWorkflowStageTreeState {
  const { enabled, scope, refreshToken, plan, candidateEvidence } = options;
  const novelId = scope?.novelId.trim() ?? '';
  const chapterId = scope?.chapterId.trim() ?? '';
  const conversationId = scope?.conversationId?.trim() || undefined;
  const workflowId = scope?.workflowId?.trim() || undefined;
  const runId = scope?.runId?.trim() || undefined;
  const hasScope = Boolean(novelId && chapterId);
  const currentKey = [novelId, chapterId, conversationId ?? '', workflowId ?? '', runId ?? ''].join(
    '\u0000',
  );
  const [state, setState] = useState<LoadState>(INITIAL_STATE);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!enabled) {
      setState({ ...INITIAL_STATE });
      return;
    }
    if (!novelId || !chapterId) {
      setState({ ...INITIAL_STATE, reason: 'no_scope' });
      return;
    }
    setState({ key: currentKey, read: null, loading: true, error: '', reason: 'ready' });
    let active = true;
    void readChapterWorkflowStages({
      novelId,
      chapterId,
      ...(conversationId ? { conversationId } : {}),
      ...(workflowId ? { workflowId } : {}),
      ...(runId ? { runId } : {}),
    })
      .then((result) => {
        if (!active || request !== requestRef.current) return;
        setState({
          key: currentKey,
          read: result,
          loading: false,
          error: '',
          reason: result.authority === 'sqlite' ? 'ready' : 'browser',
        });
      })
      .catch((failure: unknown) => {
        if (!active || request !== requestRef.current) return;
        setState({
          key: currentKey,
          read: null,
          loading: false,
          error: failure instanceof Error ? failure.message : '章节写作进度读取失败。',
          reason: 'error',
        });
      });
    return () => {
      active = false;
    };
  }, [enabled, novelId, chapterId, conversationId, workflowId, runId, refreshToken, currentKey]);

  const matches = enabled && hasScope && state.key === currentKey;
  const activeRead = matches ? state.read : null;
  const stages = useMemo(
    () =>
      activeRead?.authority === 'sqlite'
        ? mapChapterWorkflowStagesToTree(activeRead.stages, {
            scope: activeRead.scope,
            plan,
            candidateEvidence,
          })
        : EMPTY_STAGES,
    [activeRead, plan, candidateEvidence],
  );
  const reason: ChapterWorkflowStageTreeReason = !enabled
    ? 'disabled'
    : !hasScope
      ? 'no_scope'
      : matches
        ? state.reason
        : 'ready';
  return {
    stages,
    read: activeRead,
    loading: matches ? state.loading : enabled && hasScope,
    error: matches ? state.error : '',
    reason,
  };
}
