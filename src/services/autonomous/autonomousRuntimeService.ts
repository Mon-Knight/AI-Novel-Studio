import { autonomousJobService } from './autonomousJobService';
import { autonomousOrchestrator } from './autonomousOrchestrator';
import type { AutonomousGenerationJob } from '../../types/autonomous';

type RunningExecution = {
  promise: Promise<void>;
  mode: 'sequential' | 'concurrent';
  controller: AbortController;
};

const executions = new Map<string, RunningExecution>();

async function markFailedIfRunning(jobId: string): Promise<void> {
  const current = await autonomousJobService.get(jobId).catch(() => null);
  if (current?.status === 'running') {
    await autonomousJobService.fail(jobId).catch(() => undefined);
  }
}

function dispatch(
  jobId: string,
  mode: 'sequential' | 'concurrent',
  maxConcurrency: number,
): Promise<void> {
  const existing = executions.get(jobId);
  if (existing) return existing.promise;
  const controller = new AbortController();

  const execution = (mode === 'concurrent'
    ? autonomousOrchestrator.runConcurrentChapterGeneration(jobId, maxConcurrency, controller.signal)
    : autonomousOrchestrator.runMultiChapterGeneration(jobId, controller.signal))
    .catch(async (error) => {
      await markFailedIfRunning(jobId);
      throw error;
    })
    .finally(() => {
      const current = executions.get(jobId);
      if (current?.promise === execution) executions.delete(jobId);
    });

  // Attach a terminal rejection handler immediately. UI commands deliberately
  // do not await the complete book-generation lifetime.
  void execution.catch((error) => {
    console.error('[AutonomousRuntime] execution failed', {
      jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  executions.set(jobId, { promise: execution, mode, controller });
  return execution;
}

export const autonomousRuntimeService = {
  isRunning(jobId: string): boolean {
    return executions.has(jobId);
  },

  getRunningJobIds(): string[] {
    return [...executions.keys()];
  },

  async start(
    jobId: string,
    options: { mode?: 'sequential' | 'concurrent'; maxConcurrency?: number } = {},
  ): Promise<AutonomousGenerationJob> {
    const current = await autonomousJobService.get(jobId);
    if (!current) throw new Error(`Autonomous job ${jobId} not found`);
    if (!['pending', 'running'].includes(current.status)) {
      throw new Error(`Autonomous job ${jobId} cannot start from ${current.status}`);
    }
    const running = current.status === 'running'
      ? current
      : await autonomousJobService.start(jobId);
    dispatch(
      jobId,
      options.mode ?? 'sequential',
      Math.max(1, Math.min(8, options.maxConcurrency ?? 3)),
    );
    return running;
  },

  async resume(
    jobId: string,
    options: { mode?: 'sequential' | 'concurrent'; maxConcurrency?: number } = {},
  ): Promise<AutonomousGenerationJob> {
    const current = await autonomousJobService.get(jobId);
    if (!current) throw new Error(`Autonomous job ${jobId} not found`);
    if (!['paused', 'running'].includes(current.status)) {
      throw new Error(`Autonomous job ${jobId} cannot resume from ${current.status}`);
    }
    const running = current.status === 'running'
      ? current
      : await autonomousJobService.resume(jobId);
    dispatch(
      jobId,
      options.mode ?? 'sequential',
      Math.max(1, Math.min(8, options.maxConcurrency ?? 3)),
    );
    return running;
  },

  async pause(jobId: string, reason: string): Promise<AutonomousGenerationJob> {
    const paused = await autonomousJobService.pause({
      jobId,
      reason,
      chapterId: null,
    });
    executions.get(jobId)?.controller.abort();
    return paused;
  },

  async cancel(jobId: string): Promise<AutonomousGenerationJob> {
    const cancelled = await autonomousJobService.cancel(jobId);
    executions.get(jobId)?.controller.abort();
    return cancelled;
  },

  /** Test-only observation without exposing the mutable Map. */
  async waitForIdle(jobId: string): Promise<void> {
    await executions.get(jobId)?.promise;
  },
};
