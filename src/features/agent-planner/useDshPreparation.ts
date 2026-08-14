// useDshPreparation：章节准备提案双源钩子（当前 Planner 确定性映射 / DSH 进程外大脑）。
// v3.1.0 说明：baselineRevisions 暂以 0 回显（应用侧逐来源 revision 接线随 v3.2
// 共享只读 crate 落地）；回显校验机制本身已由 spike 六项门槛验证。

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChapterPreparationInput,
  ChapterPreparationPlannerOptions,
  ChapterPreparationProposal,
} from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';
import { currentPlannerAdapter } from '../../services/dsh/currentPlannerAdapter';
import { dshPlannerAdapter } from '../../services/dsh/dshPlannerAdapter';
import { describeUnknownError } from '../../utils/errorMessage';

export interface DshPreparationDependencies {
  current: { prepare(input: ChapterPreparationInput): Promise<ChapterPreparationProposal> };
  dsh: {
    prepare(
      input: ChapterPreparationInput,
      options?: ChapterPreparationPlannerOptions,
    ): Promise<ChapterPreparationProposal>;
  };
}

const defaultDependencies: DshPreparationDependencies = {
  current: currentPlannerAdapter,
  dsh: dshPlannerAdapter,
};

export function buildPreparationInput(novelId: string, chapterId: string): ChapterPreparationInput {
  return {
    novelId,
    chapterId,
    baselineRevisions: CHAPTER_PREPARATION_SOURCES.map((source) => ({ source, revision: 0 })),
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
  const targetRef = useRef({ novelId, chapterId });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  targetRef.current = { novelId, chapterId };

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const run = useCallback(
    async (mode: DshPreparationMode, options?: ChapterPreparationPlannerOptions) => {
      const target = targetRef.current;
      if (!target.novelId || !target.chapterId) return;
      setRunning(true);
      setError('');
      setProposal(null);
      setPlanner(mode);
      setElapsedMs(0);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
      try {
        const input = buildPreparationInput(target.novelId, target.chapterId);
        const result =
          mode === 'dsh'
            ? await dependencies.dsh.prepare(input, options)
            : await dependencies.current.prepare(input);
        if (
          targetRef.current.novelId === target.novelId &&
          targetRef.current.chapterId === target.chapterId
        ) {
          setProposal(result);
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

  return { proposal, planner, running, error, elapsedMs, run };
}
