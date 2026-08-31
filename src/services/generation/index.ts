import {
  createGenerationJob,
  updateGenerationJob,
  getGenerationJobById,
  getGenerationJobsByChapterId,
  cancelGenerationJob,
  saveGenerationStep,
  getGenerationSteps,
} from './jobRepository';
import { recoverInterruptedJobsOnStartup } from './startupRecovery';
import { runChapterDraftJob, runMockChapterJob } from './chapterGenerationPipeline';
import { startupCoordinator } from '../startup/startupCoordinator';

export * from './types';
export * from './jobStateMachine';
export * from './jobRepository';
export * from './checkpointRecovery';
export * from './qualityGateRunner';
export * from './startupRecovery';
export * from './chapterGenerationPipeline';

async function waitForActiveStartupGenerationReadiness(): Promise<void> {
  if (!startupCoordinator.isStarted()) return;
  await Promise.all([
    startupCoordinator.waitForContextMigration(),
    startupCoordinator.waitForGenerationRecovery(),
  ]);
}

const createAfterStartupRecovery: typeof createGenerationJob = async (...args) => {
  await waitForActiveStartupGenerationReadiness();
  return createGenerationJob(...args);
};

const runMockAfterStartupRecovery: typeof runMockChapterJob = async (...args) => {
  await waitForActiveStartupGenerationReadiness();
  return runMockChapterJob(...args);
};

const runDraftAfterStartupRecovery: typeof runChapterDraftJob = async (...args) => {
  await waitForActiveStartupGenerationReadiness();
  return runChapterDraftJob(...args);
};

export const generationJobService = {
  recoverInterruptedAtStartup: recoverInterruptedJobsOnStartup,
  create: createAfterStartupRecovery,
  update: updateGenerationJob,
  getById: getGenerationJobById,
  getByChapterId: getGenerationJobsByChapterId,
  cancel: cancelGenerationJob,
  saveStep: saveGenerationStep,
  getSteps: getGenerationSteps,
  runMockChapterJob: runMockAfterStartupRecovery,
  runChapterDraftJob: runDraftAfterStartupRecovery,
};
