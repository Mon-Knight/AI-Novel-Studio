import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentPlanBundle } from '../../types/agentPlan';
import { agentPlanPersistenceService } from '../../services/agent-planner/agentPlanPersistenceService';
import { agentPlanRuntimeService } from '../../services/agent-planner/agentPlanRuntimeService';
import { describeUnknownError } from '../../utils/errorMessage';

export function useChapterReadinessPlan(novelId?: string, chapterId?: string) {
  const available = agentPlanPersistenceService.isAvailable();
  const [bundle, setBundle] = useState<AgentPlanBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const targetRef = useRef({ novelId, chapterId });
  const createOperationRef = useRef<string>();
  targetRef.current = { novelId, chapterId };

  const acceptBundle = useCallback((next: AgentPlanBundle) => {
    const target = targetRef.current;
    if (next.plan.novelId === target.novelId && next.plan.chapterId === target.chapterId) {
      setBundle(next);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!available || !chapterId) {
      setBundle(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const plans = await agentPlanPersistenceService.listByChapter(chapterId, 1);
      if (targetRef.current.chapterId !== chapterId) return;
      if (plans.length === 0) {
        setBundle(null);
      } else {
        acceptBundle(await agentPlanPersistenceService.get(plans[0].planId));
      }
    } catch (reason) {
      if (targetRef.current.chapterId === chapterId) {
        setError(describeUnknownError(reason, '无法读取章节准备计划'));
      }
    } finally {
      if (targetRef.current.chapterId === chapterId) setLoading(false);
    }
  }, [acceptBundle, available, chapterId]);

  useEffect(() => {
    setBundle(null);
    setError('');
    setRunning(false);
    createOperationRef.current = undefined;
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<AgentPlanBundle>) => {
      setRunning(true);
      setError('');
      try {
        const result = await action();
        acceptBundle(result);
        return result;
      } catch (reason) {
        setError(describeUnknownError(reason, '章节准备计划执行失败'));
        throw reason;
      } finally {
        setRunning(false);
      }
    },
    [acceptBundle],
  );

  const createAndRun = useCallback(async () => {
    if (!novelId || !chapterId) return;
    createOperationRef.current ??= agentPlanPersistenceService.newOperationId(
      'chapter-readiness-create',
    );
    const operationId = createOperationRef.current;
    try {
      await run(() =>
        agentPlanRuntimeService.createAndRun(
          { novelId, chapterId, operationId },
          { onProgress: ({ bundle: next }) => acceptBundle(next) },
        ),
      );
      createOperationRef.current = undefined;
    } catch {
      // Keep the operation ID so a repeated user click safely replays create.
    }
  }, [acceptBundle, chapterId, novelId, run]);

  const runExisting = useCallback(async () => {
    if (!bundle) return;
    await run(() =>
      agentPlanRuntimeService.runExisting(bundle.plan.planId, {
        onProgress: ({ bundle: next }) => acceptBundle(next),
      }),
    ).catch(() => undefined);
  }, [acceptBundle, bundle, run]);

  const retry = useCallback(async () => {
    if (!bundle) return;
    const step = bundle.steps.find((candidate) => candidate.status === 'waiting_retry');
    if (!step) return;
    await run(() =>
      agentPlanRuntimeService.authorizeRetryAndRun(bundle.plan.planId, step.stepId, {
        onProgress: ({ bundle: next }) => acceptBundle(next),
      }),
    ).catch(() => undefined);
  }, [acceptBundle, bundle, run]);

  return {
    available,
    bundle,
    loading,
    running,
    error,
    reload,
    createAndRun,
    runExisting,
    retry,
  };
}
