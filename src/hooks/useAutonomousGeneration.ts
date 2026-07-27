/**
 * useAutonomousGeneration Hook
 * v2.7.0 - Phase 0: Autonomous Task Scheduler Foundation
 *
 * React Hook for managing autonomous generation jobs from UI
 */

import { useState, useEffect, useCallback } from 'react';
import { autonomousJobService } from '../services/autonomous/autonomousJobService';
import { autonomousRuntimeService } from '../services/autonomous/autonomousRuntimeService';
import type {
  AutonomousGenerationJob,
  AutonomousAction,
  QualityThresholds,
} from '../types/autonomous';

export interface UseAutonomousGenerationOptions {
  novelId: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // ms
}

export interface UseAutonomousGenerationReturn {
  jobs: AutonomousGenerationJob[];
  activeJob: AutonomousGenerationJob | null;
  thresholds: QualityThresholds | null;
  actions: AutonomousAction[];

  // Loading states
  loading: boolean;
  creating: boolean;
  updating: boolean;

  // Actions
  createJob: (totalChapters: number) => Promise<void>;
  startJob: (jobId: string) => Promise<void>;
  pauseJob: (jobId: string, reason: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;

  updateThresholds: (params: Partial<QualityThresholds>) => Promise<void>;
  loadActions: (jobId: string) => Promise<void>;

  refresh: () => Promise<void>;

  error: Error | null;
}

export function useAutonomousGeneration(
  options: UseAutonomousGenerationOptions
): UseAutonomousGenerationReturn {
  const { novelId, autoRefresh = false, refreshInterval = 5000 } = options;

  const [jobs, setJobs] = useState<AutonomousGenerationJob[]>([]);
  const [activeJob, setActiveJob] = useState<AutonomousGenerationJob | null>(null);
  const [thresholds, setThresholds] = useState<QualityThresholds | null>(null);
  const [actions, setActions] = useState<AutonomousAction[]>([]);

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // ==================== Load Jobs ====================

  const loadJobs = useCallback(async () => {
    if (!autonomousJobService.isAvailable()) return;

    try {
      setLoading(true);
      setError(null);

      const jobList = await autonomousJobService.listByNovel(novelId);
      setJobs(jobList);

      // 找到当前活跃的任务（running 或 paused）
      // Pending jobs are actionable too: expose Start after restore/create.
      const active = jobList.find(
        (j) => j.status === 'pending' || j.status === 'running' || j.status === 'paused'
      ) ?? null;
      setActiveJob(active);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  // ==================== Load Thresholds ====================

  const loadThresholds = useCallback(async () => {
    if (!autonomousJobService.isAvailable()) return;

    try {
      const t = await autonomousJobService.getQualityThresholds(novelId);
      setThresholds(t);
    } catch (err) {
      console.error('Failed to load quality thresholds:', err);
    }
  }, [novelId]);

  // ==================== Refresh ====================

  const refresh = useCallback(async () => {
    await Promise.all([loadJobs(), loadThresholds()]);
  }, [loadJobs, loadThresholds]);

  // ==================== Auto Refresh ====================

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || !activeJob) return;

    const timer = setInterval(() => {
      refresh();
    }, refreshInterval);

    return () => clearInterval(timer);
  }, [autoRefresh, activeJob, refreshInterval, refresh]);

  // ==================== Actions ====================

  const createJob = useCallback(
    async (totalChapters: number) => {
      try {
        setCreating(true);
        setError(null);

        const job = await autonomousJobService.create({
          novelId,
          totalChapters,
        });

        setJobs((prev) => [job, ...prev]);
        setActiveJob(job);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setCreating(false);
      }
    },
    [novelId]
  );

  const startJob = useCallback(async (jobId: string) => {
    try {
      setUpdating(true);
      setError(null);

      const updated = await autonomousRuntimeService.start(jobId);

      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      setActiveJob(updated);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  const pauseJob = useCallback(async (jobId: string, reason: string) => {
    try {
      setUpdating(true);
      setError(null);

      const updated = await autonomousRuntimeService.pause(jobId, reason);

      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      setActiveJob(updated);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  const resumeJob = useCallback(async (jobId: string) => {
    try {
      setUpdating(true);
      setError(null);

      const updated = await autonomousRuntimeService.resume(jobId);

      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      setActiveJob(updated);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setUpdating(false);
    }
  }, []);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      setUpdating(true);
      setError(null);

      const updated = await autonomousRuntimeService.cancel(jobId);

      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      if (activeJob?.id === jobId) {
        setActiveJob(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setUpdating(false);
    }
  }, [activeJob]);

  const updateThresholds = useCallback(
    async (params: Partial<QualityThresholds>) => {
      try {
        setUpdating(true);
        setError(null);

        const updated = await autonomousJobService.saveQualityThresholds({
          novelId,
          ...params,
        });

        setThresholds(updated);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        setUpdating(false);
      }
    },
    [novelId]
  );

  const loadActions = useCallback(async (jobId: string) => {
    try {
      const actionList = await autonomousJobService.listActions(jobId);
      setActions(actionList);
    } catch (err) {
      console.error('Failed to load actions:', err);
    }
  }, []);

  return {
    jobs,
    activeJob,
    thresholds,
    actions,
    loading,
    creating,
    updating,
    createJob,
    startJob,
    pauseJob,
    resumeJob,
    cancelJob,
    updateThresholds,
    loadActions,
    refresh,
    error,
  };
}
