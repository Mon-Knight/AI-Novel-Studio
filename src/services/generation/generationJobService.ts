/**
 * Generation Job Service (Thin Facade)
 *
 * All implementation details have been modularized under ./generation/:
 * - types.ts (Data contracts, transition rules, helper functions)
 * - jobStateMachine.ts (Active job controls, JSON/Job/Step normalizers)
 * - jobRepository.ts (SQLite & localStorage persistence CRUD)
 * - checkpointRecovery.ts (Resumable beat discovery & repair artifact checkpoints)
 * - qualityGateRunner.ts (Patch candidate generation & quality gate decisions)
 * - startupRecovery.ts (Interrupted job recovery on app startup)
 * - chapterGenerationPipeline.ts (End-to-end 6-stage generation runner)
 * - index.ts (generationJobService facade)
 */

export * from './index';
