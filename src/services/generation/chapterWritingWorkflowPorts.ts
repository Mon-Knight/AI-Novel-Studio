import type { SceneBeat, ScenePlanItem } from '../../types/chapterEngineering';
import type {
  ActualBeatState,
  BeatProseRecord,
  ChapterScenePlanV2,
  ChapterWritingFourFields,
  ChapterWritingStage,
  ChapterWritingWorkflowBudget,
  ChapterWritingWorkflowCheckpoint,
  ChapterWritingWorkflowIdentity,
  SceneBeatPlan,
} from '../../types/chapterWritingWorkflow';

export interface RunChapterWritingWorkflowInput {
  identity: ChapterWritingWorkflowIdentity;
  attemptId: string;
  sourceContext: string;
  targetCharacters: number;
  chapterConstraints: string[];
  budget: ChapterWritingWorkflowBudget;
  /** Recovery is a user action, never a consequence of rehydrating a running record. */
  authorizeResume?: boolean;
  signal?: AbortSignal;
}

export interface WorkflowBeatInput {
  scene: ScenePlanItem;
  beat: SceneBeat;
  plan: SceneBeatPlan;
  fields: ChapterWritingFourFields;
  previousText: string;
  attempt: number;
  signal?: AbortSignal;
}

export interface WorkflowBeatOutput {
  text: string;
  finishReason: string;
  taskId?: string;
  attemptId?: string;
  artifactId?: string;
}

export interface ChapterWritingWorkflowPorts {
  load: () => Promise<ChapterWritingWorkflowCheckpoint | undefined>;
  /** The persistence implementation must atomically compare revision and the frozen identity. */
  save: (next: ChapterWritingWorkflowCheckpoint, expectedRevision: number | null) => Promise<void>;
  assertBaseline: () => Promise<void>;
  planScenes: (input: {
    sourceContext: string;
    targetCharacters: number;
    signal?: AbortSignal;
  }) => Promise<ChapterScenePlanV2>;
  planBeats: (input: {
    scene: ScenePlanItem;
    sourceContext: string;
    acceptedProse: string;
    actualEntryState: string;
    remainingCalls: number;
    signal?: AbortSignal;
  }) => Promise<SceneBeatPlan>;
  writeBeat: (input: WorkflowBeatInput) => Promise<WorkflowBeatOutput>;
  validateBeat: (output: WorkflowBeatOutput, input: WorkflowBeatInput) => void | Promise<void>;
  extractState: (input: {
    prose: string;
    sourceTextHash: string;
    previousState?: ActualBeatState;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  validateChapter: (text: string, records: readonly BeatProseRecord[]) => void | Promise<void>;
  now?: () => number;
}

export interface ChapterWritingWorkflowSession {
  input: RunChapterWritingWorkflowInput;
  ports: ChapterWritingWorkflowPorts;
  checkpoint: ChapterWritingWorkflowCheckpoint;
  now: () => number;
  commit: (change: (next: ChapterWritingWorkflowCheckpoint) => void) => Promise<void>;
  assertActive: () => Promise<void>;
}

export type WritingStageAddress = Pick<ChapterWritingStage, 'kind' | 'sceneId' | 'beatId'>;
