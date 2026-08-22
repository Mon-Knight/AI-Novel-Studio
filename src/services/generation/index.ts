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

export * from './types';
export * from './jobStateMachine';
export * from './jobRepository';
export * from './checkpointRecovery';
export * from './qualityGateRunner';
export * from './startupRecovery';
export * from './chapterGenerationPipeline';

export const generationJobService = {
  recoverInterruptedAtStartup: recoverInterruptedJobsOnStartup,
  create: createGenerationJob,
  update: updateGenerationJob,
  getById: getGenerationJobById,
  getByChapterId: getGenerationJobsByChapterId,
  cancel: cancelGenerationJob,
  saveStep: saveGenerationStep,
  getSteps: getGenerationSteps,
  runMockChapterJob,
  runChapterDraftJob,
};
