import { generateId, nowISO } from '../database/db';
import { generationJobService } from '../generation/generationJobService';
import { multiAgentService } from '../multi-agent/multiAgentRuntime';
import { AutonomousChapterWorkflowService } from './autonomousChapterWorkflow';
import { autonomousPlanPersistence } from './autonomousPersistence';
import { draftVersionService } from '../database/draftVersionService';

export const autonomousChapterWorkflow = new AutonomousChapterWorkflowService({
  persistence: autonomousPlanPersistence,
  generation: generationJobService,
  review: multiAgentService,
  drafts: draftVersionService,
  generateId,
  now: nowISO,
});
