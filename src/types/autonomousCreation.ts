import type { ChapterSummarizeResult } from './chapterSummary';
import type { ConsensusAction } from './multiAgent';

export const AUTONOMOUS_PLAN_SCHEMA_VERSION = 1;

export type AutonomousAgentType =
  | 'plot_planner'
  | 'character_evolution'
  | 'world_builder'
  | 'conflict_generator'
  | 'pacing_controller'
  | 'chapter_batch_planner';

export type AutonomousPlanStatus = 'running' | 'ready' | 'failed' | 'cancelled' | 'applied';

export type AutonomousPlanStage =
  'foundation' | 'creative_dimensions' | 'chapter_batches' | 'ready' | 'applied';

export type PacingMode = 'setup' | 'build' | 'pressure' | 'climax' | 'recovery' | 'resolution';

export interface AutonomousStoryBrief {
  premise: string;
  genre: string;
  targetChapterCount: number;
  targetWordsPerChapter: number;
  readerPromise: string;
  endingPreference: string;
  constraints: string[];
}

export interface AutonomousStoryBible {
  title: string;
  logline: string;
  themes: string[];
  protagonistPromise: string;
  centralQuestion: string;
  endingVision: string;
  narrativeRules: string[];
}

export interface AutonomousStoryArc {
  id: string;
  index: number;
  title: string;
  chapterStart: number;
  chapterEnd: number;
  goal: string;
  turningPoint: string;
  climax: string;
  outcome: string;
}

export interface AutonomousVolumePlan {
  id: string;
  index: number;
  title: string;
  chapterStart: number;
  chapterEnd: number;
  summary: string;
  goal: string;
  mainConflict: string;
  arcIds: string[];
}

export interface CharacterEvolutionBeat {
  id: string;
  characterId: string;
  chapterNumber: number;
  stage: string;
  change: string;
  relationshipShift?: string;
  knowledgeGain?: string;
}

export interface AutonomousCharacterPlan {
  id: string;
  name: string;
  role: 'protagonist' | 'supporting' | 'antagonist' | 'neutral';
  identity: string;
  faction?: string;
  relationToProtagonist?: string;
  personality: string;
  coreNeed: string;
  flaw: string;
  initialState: string;
  desiredEndState: string;
  behaviorLimits: string[];
  forbiddenBehaviors: string[];
  beats: CharacterEvolutionBeat[];
}

export type WorldElementType =
  'location' | 'faction' | 'rule' | 'culture' | 'technology' | 'artifact';

export interface AutonomousWorldElement {
  id: string;
  type: WorldElementType;
  name: string;
  summary: string;
  firstChapter: number;
  dependencies: string[];
  constraints: string[];
}

export interface AutonomousConflictThread {
  id: string;
  title: string;
  type: 'internal' | 'interpersonal' | 'faction' | 'world' | 'mystery';
  participants: string[];
  stakes: string;
  summary: string;
  introducedChapter: number;
  escalationChapters: number[];
  climaxChapter: number;
  resolutionChapter: number;
}

export interface AutonomousPacingPhase {
  id: string;
  title: string;
  chapterStart: number;
  chapterEnd: number;
  mode: PacingMode;
  tensionStart: number;
  tensionEnd: number;
  purpose: string;
}

export interface AutonomousPacingPoint {
  chapterNumber: number;
  phaseId: string;
  mode: PacingMode;
  tension: number;
  dialogueRatio: number;
  descriptionRatio: number;
  cliffhanger: boolean;
}

export interface AutonomousChapterPlan {
  id: string;
  chapterNumber: number;
  volumeId: string;
  arcId: string;
  title: string;
  outline: string;
  goal: string;
  targetWordCount: number;
  pacingMode: PacingMode;
  tension: number;
  endingHook: string;
  conflictThreadIds: string[];
  characterIds: string[];
  characterBeatIds: string[];
  worldElementIds: string[];
  status: 'planned' | 'materialized' | 'adopted';
}

export interface AutonomousAgentRun {
  agent: AutonomousAgentType;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  aiTaskIds: string[];
  tokensInput: number;
  tokensOutput: number;
  tokensUsed: number;
  durationMs: number;
  errorMessage?: string;
  updatedAt: string;
}

export interface AutonomousPlanProgress {
  completedVolumeIds: string[];
  currentVolumeIndex: number;
  adoptedChapterNumbers: number[];
  lastCheckpoint: string;
}

export type AutonomousChapterRunStatus =
  'generating' | 'reviewing' | 'candidate_ready' | 'adopted' | 'failed' | 'cancelled';

export type AutonomousChapterAnalysisStatus =
  'running' | 'pending_confirmation' | 'confirmed' | 'cancelled' | 'failed';

export interface AutonomousChapterAnalysis {
  status: AutonomousChapterAnalysisStatus;
  adoptedDraftId: string;
  result?: ChapterSummarizeResult;
  worldSuggestionIds: string[];
  summaryId?: string;
  errorMessage?: string;
  updatedAt: string;
}

export interface AutonomousChapterRun {
  runId: string;
  operationId: string;
  chapterId: string;
  chapterNumber: number;
  status: AutonomousChapterRunStatus;
  generationJobId?: string;
  sourceDraftId?: string;
  candidateDraftId?: string;
  predecessorDraftId?: string;
  predecessorContentHash?: string;
  reviewSessionId?: string;
  reviewAccepted?: boolean;
  reviewAction?: ConsensusAction;
  acceptanceRate?: number;
  averageScore?: number;
  adoptedDraftId?: string;
  plannedCharacterBeatIds: string[];
  confirmedCharacterBeatIds: string[];
  analysis?: AutonomousChapterAnalysis;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousStoryPlan {
  schemaVersion: typeof AUTONOMOUS_PLAN_SCHEMA_VERSION;
  planId: string;
  operationId: string;
  requestHash: string;
  novelId: string;
  status: AutonomousPlanStatus;
  stage: AutonomousPlanStage;
  revision: number;
  brief: AutonomousStoryBrief;
  storyBible?: AutonomousStoryBible;
  arcs: AutonomousStoryArc[];
  volumes: AutonomousVolumePlan[];
  characters: AutonomousCharacterPlan[];
  worldElements: AutonomousWorldElement[];
  conflicts: AutonomousConflictThread[];
  pacingPhases: AutonomousPacingPhase[];
  pacingCurve: AutonomousPacingPoint[];
  chapters: AutonomousChapterPlan[];
  agentRuns: AutonomousAgentRun[];
  chapterRuns?: AutonomousChapterRun[];
  progress: AutonomousPlanProgress;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  appliedAt?: string;
}

export interface GenerateAutonomousPlanInput {
  novelId: string;
  brief: AutonomousStoryBrief;
  operationId?: string;
  signal?: AbortSignal;
  onProgress?: (plan: AutonomousStoryPlan) => void;
}

export interface ApplyAutonomousPlanResult {
  plan: AutonomousStoryPlan;
  createdVolumes: number;
  createdChapters: number;
  createdCharacters: number;
  createdWorldElements: number;
  createdChapterEvents: number;
  createdChapterCharacters: number;
}
