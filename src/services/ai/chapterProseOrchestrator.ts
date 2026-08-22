/**
 * Chapter Prose Orchestrator (Thin Facade)
 *
 * All implementation details have been modularized under ./orchestrator/:
 * - scenePlanParser.ts (Scene/Beat plan parsing & validation)
 * - beatContextAssembler.ts (Context compaction & constraint assembling)
 * - beatTextValidator.ts (Semantic coverage, repetition & novelty validation)
 * - beatRepairService.ts (External Beat repair prompts, boundary trimming & retries)
 * - proseGenerationPipeline.ts (Chapter prose generation loop execution)
 */

export * from './orchestrator';
export { executeChapterProseOrchestrator as executeChapterProseOrchestration } from './orchestrator';
