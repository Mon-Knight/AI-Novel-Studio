// useDshPreparation：章节准备提案双源钩子（当前 Planner 确定性映射 / DSH 进程外大脑）。
// v3.1.0：运行前先加载逐来源 baselineRevisions（真实修订号），Proposal 必须原样
// 回显，Validator 做一致性校验；修订号未就绪时禁止发起。

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChapterBaselineRevision,
  ChapterPreparationInput,
  ChapterPreparationPlannerOptions,
  ChapterPreparationProposal,
} from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';
import { currentPlannerAdapter } from '../../services/dsh/currentPlannerAdapter';
import { dshPlannerAdapter } from '../../services/dsh/dshPlannerAdapter';
import { loadBaselineRevisions } from '../../services/dsh/baselineRevisionService';
import { isTauriRuntime, tauriInvoke } from '../../services/tauri/runtime';
import { describeUnknownError } from '../../utils/errorMessage';

export interface DshPreparationSummary {
  runs: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

const EMPTY_SUMMARY: DshPreparationSummary = {
  runs: 0,
  promptTokens: 0,
  completionTokens: 0,
  durationMs: 0,
};

export interface DshPreparationDependencies {
  current: { prepare(input: ChapterPreparationInput): Promise<ChapterPreparationProposal> };
  dsh: {
    prepare(
      input: ChapterPreparationInput,
      options?: ChapterPreparationPlannerOptions,
    ): Promise<ChapterPreparationProposal>;
  };
  revisions: typeof loadBaselineRevisions;
  summary: (novelId: string, chapterId: string) => Promise<DshPreparationSummary>;
}

async function loadPreparationSummary(
  novelId: string,
  chapterId: string,
): Promise<DshPreparationSummary> {
  if (!isTauriRuntime()) return EMPTY_SUMMARY;
  return tauriInvoke<DshPreparationSummary>('get_dsh_preparation_summary', {
    novelId,
    chapterId,
  });
}

const defaultDependencies: DshPreparationDependencies = {
  current: currentPlannerAdapter,
  dsh: dshPlannerAdapter,
  revisions: loadBaselineRevisions,
  summary: loadPreparationSummary,
};

export function buildPreparationInput(
  novelId: string,
  chapterId: string,
  revisions?: ChapterBaselineRevision[],
): ChapterPreparationInput {
  return {
    novelId,
    chapterId,
    baselineRevisions:
      revisions ?? CHAPTER_PREPARATION_SOURCES.map((source) => ({ source, revision: 0 })),
  };
}

export type DshPreparationMode = 'current' | 'dsh';

export function useDshPreparation(
  novelId?: string,
  chapterId?: string,
  dependencies: DshPreparationDependencies = defaultDependencies,
) {
  const [proposal, setProposal] = useState<ChapterPreparationProposal | null>(null);
  const [planner, setPlanner] = useState<DshPreparationMode>('current');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<ChapterBaselineRevision[] | null>(null);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState('');
  const [summary, setSummary] = useState<DshPreparationSummary>(EMPTY_SUMMARY);
  const [summaryError, setSummaryError] = useState('');
  const targetRef = useRef({ novelId, chapterId });
  // 修订号与章节身份原子绑定：run() 只使用与当前目标一致的快照，
  // 防止"旧章节的修订号 + 新章节的输入"竞态。
  const revisionsRef = useRef<{
    novelId: string;
    chapterId: string;
    revisions: ChapterBaselineRevision[];
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  targetRef.current = { novelId, chapterId };

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  useEffect(() => {
    if (!novelId || !chapterId) {
      setRevisions(null);
      setRevisionsError('');
      setSummary(EMPTY_SUMMARY);
      setSummaryError('');
      return;
    }
    let stale = false;
    setRevisions(null);
    setRevisionsLoading(true);
    setRevisionsError('');
    setSummary(EMPTY_SUMMARY);
    setSummaryError('');
    revisionsRef.current = null;
    dependencies
      .revisions(novelId, chapterId)
      .then((loaded) => {
        if (!stale) {
          revisionsRef.current = { novelId, chapterId, revisions: loaded };
          setRevisions(loaded);
        }
      })
      .catch((reason) => {
        if (!stale) setRevisionsError(describeUnknownError(reason, '基线修订号加载失败'));
      })
      .finally(() => {
        if (!stale) setRevisionsLoading(false);
      });
    dependencies
      .summary(novelId, chapterId)
      .then((loaded) => {
        if (!stale) setSummary(loaded);
      })
      .catch((reason) => {
        if (!stale) {
          setSummaryError(describeUnknownError(reason, 'DSH 用量汇总读取失败'));
        }
      });
    return () => {
      stale = true;
    };
  }, [chapterId, dependencies, novelId]);

  const run = useCallback(
    async (mode: DshPreparationMode, options?: ChapterPreparationPlannerOptions) => {
      const target = targetRef.current;
      if (!target.novelId || !target.chapterId) return;
      const bound = revisionsRef.current;
      if (!bound || bound.novelId !== target.novelId || bound.chapterId !== target.chapterId) {
        setError('基线修订号尚未就绪（或已随章节切换失效），无法发起提案');
        return;
      }
      const snapshot = bound.revisions;
      setRunning(true);
      setError('');
      setProposal(null);
      setPlanner(mode);
      setElapsedMs(0);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
      try {
        const input = buildPreparationInput(target.novelId, target.chapterId, snapshot);
        const result =
          mode === 'dsh'
            ? await dependencies.dsh.prepare(input, options)
            : await dependencies.current.prepare(input);
        if (
          targetRef.current.novelId === target.novelId &&
          targetRef.current.chapterId === target.chapterId
        ) {
          setProposal(result);
          if (mode === 'dsh') {
            dependencies
              .summary(target.novelId, target.chapterId)
              .then((loaded) => {
                if (
                  targetRef.current.novelId === target.novelId &&
                  targetRef.current.chapterId === target.chapterId
                ) {
                  setSummary(loaded);
                  setSummaryError('');
                }
              })
              .catch((reason) => {
                if (
                  targetRef.current.novelId === target.novelId &&
                  targetRef.current.chapterId === target.chapterId
                ) {
                  setSummaryError(describeUnknownError(reason, 'DSH 用量汇总读取失败'));
                }
              });
          }
        }
      } catch (reason) {
        if (
          targetRef.current.novelId === target.novelId &&
          targetRef.current.chapterId === target.chapterId
        ) {
          setError(
            describeUnknownError(
              reason,
              mode === 'dsh' ? 'DSH 提案生成失败' : '当前 Planner 提案映射失败',
            ),
          );
        }
      } finally {
        stopTimer();
        setRunning(false);
      }
    },
    [dependencies, stopTimer],
  );

  return {
    proposal,
    planner,
    running,
    error,
    elapsedMs,
    revisions,
    revisionsLoading,
    revisionsError,
    summary,
    summaryError,
    run,
  };
}
