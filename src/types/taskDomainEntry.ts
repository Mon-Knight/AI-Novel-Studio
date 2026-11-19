import type {
  AutonomousPlanningBaseline,
  AutonomousPlanningMode,
  AutonomousStoryBrief,
  AutonomousVolumeStrategy,
} from './autonomousCreation';
import type { StyleRuntimeEntry } from './taskLibrary';
import type { OutlineRuntimeEntry } from './outlineGeneration';
import type { GenerateSettingSuggestionsInput } from './settingSuggestion';

/** Dedicated UI goals, not permissions or independently executable workflows. */
export type TaskDomainEntry =
  | OutlineRuntimeEntry
  | StyleRuntimeEntry
  | {
      kind: 'autonomous_plan';
      operationId: string;
      brief: AutonomousStoryBrief;
      planningMode?: AutonomousPlanningMode;
      volumeStrategy?: AutonomousVolumeStrategy;
      baseline?: AutonomousPlanningBaseline;
      resumePlanId?: string;
    }
  | { kind: 'chapter_readiness'; planId: string; retryStepId?: string }
  | { kind: 'setting_suggestions'; input: GenerateSettingSuggestionsInput }
  | {
      kind: 'autonomous_chapter';
      planId: string;
      selection?: 'next_unadopted' | 'next_missing_candidate';
    }
  | { kind: 'autonomous_post_chapter'; planId: string; adoptedDraftId: string }
  | { kind: 'autonomous_scheduler'; runId: string; explicitResume?: boolean };
