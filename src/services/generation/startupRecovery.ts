import { dbCall, generateId, nowISO } from '../database/db';
import type { StartupGenerationRecovery } from '../../types/generationJob';
import { STARTUP_RECOVERY_ERROR_CODE, STARTUP_RECOVERY_MESSAGE } from './types';
import { getLocalJobs, saveLocalJobs, saveLocalStep } from './jobRepository';

export async function recoverInterruptedJobsOnStartup(): Promise<StartupGenerationRecovery> {
  const recoveredAt = nowISO();
  return dbCall<StartupGenerationRecovery>('recover_interrupted_generation_jobs', {}, () => {
    const jobs = getLocalJobs();
    const interrupted = jobs.filter(
      (job) => job.status === 'pending' || job.status === 'running' || job.status === 'retrying',
    );
    if (interrupted.length === 0) {
      return { recoveredJobs: 0, recoveredAt };
    }
    const interruptedIds = new Set(interrupted.map((job) => job.id));
    saveLocalJobs(
      jobs.map((job) => {
        if (!interruptedIds.has(job.id)) return job;
        return {
          ...job,
          status: 'failed',
          errorCode: STARTUP_RECOVERY_ERROR_CODE,
          errorMessage: STARTUP_RECOVERY_MESSAGE,
          finishedAt: recoveredAt,
        };
      }),
    );
    for (const job of interrupted) {
      saveLocalStep({
        id: generateId(),
        jobId: job.id,
        stepName: job.currentStep ?? 'preflight',
        status: 'failed',
        outputJson: {
          recoveryReason: STARTUP_RECOVERY_ERROR_CODE,
          previousStatus: job.status,
          preservedProgressPercent: job.progressPercent,
        },
        outputText: STARTUP_RECOVERY_MESSAGE,
        errorMessage: STARTUP_RECOVERY_MESSAGE,
        createdAt: recoveredAt,
      });
    }
    return { recoveredJobs: interrupted.length, recoveredAt };
  });
}
