import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousAutomationPolicy,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';
import { autonomousSchedulerWorker } from './autonomousSchedulerWorker';

export interface UseAutonomousSchedulerResult extends AutonomousSchedulerSnapshot {
  start(policy: AutonomousAutomationPolicy): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
}

export function useAutonomousScheduler(
  plan: AutonomousStoryPlan | null,
): UseAutonomousSchedulerResult {
  const planId = plan?.planId ?? '';
  const subscribe = useCallback(
    (listener: () => void) => autonomousSchedulerWorker.subscribe(listener),
    [],
  );
  const getSnapshot = useCallback(() => autonomousSchedulerWorker.snapshot(planId), [planId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(async () => {
    if (!plan) return;
    await autonomousSchedulerWorker.refresh(plan.novelId, plan.planId);
  }, [plan]);

  useEffect(() => {
    void autonomousSchedulerWorker.recoverStartup().then(refresh);
  }, [refresh]);

  return useMemo(
    () => ({
      ...snapshot,
      async start(policy: AutonomousAutomationPolicy) {
        if (!plan) return;
        await autonomousSchedulerWorker.start(plan, policy);
      },
      async pause() {
        if (snapshot.run) await autonomousSchedulerWorker.pause(snapshot.run);
      },
      async resume() {
        if (snapshot.run) await autonomousSchedulerWorker.resume(snapshot.run);
      },
      async stop() {
        if (snapshot.run) await autonomousSchedulerWorker.stop(snapshot.run);
      },
      refresh,
    }),
    [plan, refresh, snapshot],
  );
}
