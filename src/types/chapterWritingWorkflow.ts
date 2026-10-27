import type { SceneBeat, ScenePlanItem } from './chapterEngineering';

/** Runtime plans and validated prose remain unadopted; none of these records grants apply authority. */
export const CHAPTER_WRITING_WORKFLOW_SCHEMA = 'chapter_writing_workflow_v1' as const;

export interface ChapterScenePlanV2 {
  schemaVersion: 2;
  scenes: ScenePlanItem[];
}

export interface SceneBeatPlan {
  schemaVersion: 1;
  sceneId: string;
  sourceContextHash: string;
  previousTextHash: string;
  inputStateHash: string;
  beats: SceneBeat[];
  planHash: string;
}

/** Offsets refer to UTF-16 code units in the exact immutable Beat prose. */
export interface BeatStateEvidence {
  start: number;
  end: number;
  quote: string;
}

export interface GroundedBeatStateFact {
  text: string;
  epistemic: 'explicit' | 'uncertain';
  evidence: BeatStateEvidence[];
}

export interface ActualBeatState {
  schemaVersion: 1;
  sourceTextHash: string;
  actualStateChange: GroundedBeatStateFact[];
  /** null means the end state could not be established; plans must never fill it in. */
  endState: GroundedBeatStateFact | null;
  unknowns: string[];
  /** Exact source matching is an integrity check, not an automatic semantic proof. */
  semanticValidation: 'not_checked';
}

export interface ChapterWritingWorkflowIdentity {
  schemaVersion: typeof CHAPTER_WRITING_WORKFLOW_SCHEMA;
  workflowId: string;
  novelId: string;
  chapterId: string;
  contextHash: string;
  modelSnapshotHash: string;
}

export type ChapterWritingStageKind =
  'scene_plan' | 'beat_plan' | 'beat_write' | 'beat_state' | 'scene_close' | 'chapter_assemble';

export type ChapterWritingStageStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ChapterWritingStage {
  stageId: string;
  kind: ChapterWritingStageKind;
  sceneId?: string;
  beatId?: string;
  status: ChapterWritingStageStatus;
  attempt: number;
  inputHash: string;
  resultHash?: string;
  errorCode?: string;
}

export interface BeatProseRecord {
  sceneId: string;
  beatId: string;
  planHash: string;
  previousTextHash: string;
  text: string;
  contentHash: string;
  finishReason: 'stop';
  taskId?: string;
  attemptId?: string;
  artifactId?: string;
  actualState?: ActualBeatState;
}

export interface SceneExecutionRecord {
  sceneId: string;
  planHash: string;
  contentHash: string;
  beatIds: string[];
  actualEndState: GroundedBeatStateFact | null;
  unknowns: string[];
  /** Retain evidence-bearing individual Beat records; do not turn expectedEndState into fact. */
  stateSourceBeatIds: string[];
}

export interface ChapterWritingWorkflowCheckpoint {
  identity: ChapterWritingWorkflowIdentity;
  requestHash: string;
  revision: number;
  status: 'running' | 'waiting_retry' | 'cancelled' | 'completed';
  errorCode?: string;
  attemptId: string;
  startedAt: number;
  callsUsed: number;
  budget: ChapterWritingWorkflowBudget;
  attemptHistory: Array<{
    attemptId: string;
    startedAt: number;
    callsUsed: number;
    status: 'interrupted' | 'waiting_retry' | 'cancelled';
  }>;
  scenePlan?: ChapterScenePlanV2;
  scenePlanHash?: string;
  beatPlans: SceneBeatPlan[];
  prose: BeatProseRecord[];
  scenes: SceneExecutionRecord[];
  stages: ChapterWritingStage[];
  assembledTextHash?: string;
}

export interface ChapterWritingFourFields {
  context: string;
  goal: string;
  beat: string;
  constraints: string[];
}

export interface ChapterWritingWorkflowBudget {
  maxCalls: number;
  maxWallClockMs: number;
  maxBeatAttempts: number;
  maxBeats: number;
}
