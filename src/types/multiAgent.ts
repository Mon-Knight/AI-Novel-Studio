import type { ChapterDraft } from './ai';

export type ExpertType = 'outline' | 'character' | 'setting' | 'logic' | 'polish' | 'quality';

export type ExpertOpinionStatus = 'succeeded' | 'failed';
export type ConsensusAction = 'accept' | 'revise' | 'regenerate';
export type MultiAgentSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExpertOpinion {
  opinionId: string;
  expert: ExpertType;
  status: ExpertOpinionStatus;
  score?: number;
  accepted: boolean;
  summary: string;
  issues: string[];
  suggestions: string[];
  provider?: string;
  model?: string;
  aiTaskId?: string;
  tokensInput: number;
  tokensOutput: number;
  tokensUsed: number;
  durationMs: number;
  errorMessage?: string;
}

export interface Consensus {
  agreed: boolean;
  acceptanceRate: number;
  averageScore: number;
  successfulExperts: number;
  failedExperts: number;
  requiredSuccessfulExperts: number;
  majorConcerns: string[];
  mergedSuggestions: string[];
  action: ConsensusAction;
}

export interface CollaborationRound {
  roundNumber: number;
  inputDraftId: string;
  inputDraftVersion: number;
  inputContentHash: string;
  outputDraftId?: string;
  outputDraftVersion?: number;
  outputContentHash?: string;
  expertOpinions: ExpertOpinion[];
  consensus: Consensus;
  tokensInput: number;
  tokensOutput: number;
  tokensUsed: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

export interface MultiAgentSessionRecord {
  sessionId: string;
  operationId: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  sourceContentHash: string;
  expertTypes: ExpertType[];
  maxRounds: number;
  acceptanceThreshold: number;
  minimumAverageScore: number;
  minimumSuccessfulExperts: number;
  status: MultiAgentSessionStatus;
  currentRound: number;
  accepted: boolean;
  finalAction?: ConsensusAction;
  finalDraftId?: string;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalTokensUsed: number;
  durationMs: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface MultiAgentSessionBundle {
  session: MultiAgentSessionRecord;
  rounds: CollaborationRound[];
}

export interface MultiAgentReviewParams {
  novelId: string;
  chapterId: string;
  draftId: string;
  draftVersion?: number;
  draftContent?: string;
  contentHash?: string;
  chapterTitle?: string;
  chapterOutline?: string;
  chapterGoal?: string;
  experts: ExpertType[];
  maxRounds?: number;
  acceptanceThreshold?: number;
  minimumAverageScore?: number;
  minimumSuccessfulExperts?: number;
  operationId?: string;
  signal?: AbortSignal;
}

export interface MultiAgentReviewResult {
  success: true;
  accepted: boolean;
  finalAction: ConsensusAction;
  finalDraft: ChapterDraft;
  session: MultiAgentSessionBundle;
  totalTokensUsed: number;
  durationMs: number;
}

export interface ExpertReviewRequest {
  expert: ExpertType;
  novelId: string;
  chapterId: string;
  chapterTitle: string;
  chapterOutline: string;
  chapterGoal: string;
  draftContent: string;
  roundNumber: number;
  operationId: string;
  signal?: AbortSignal;
}

export interface DraftRevisionRequest {
  action: Exclude<ConsensusAction, 'accept'>;
  novelId: string;
  chapterId: string;
  chapterTitle: string;
  chapterOutline: string;
  chapterGoal: string;
  draftContent: string;
  majorConcerns: string[];
  suggestions: string[];
  roundNumber: number;
  operationId: string;
  signal?: AbortSignal;
}

export interface DraftRevisionResult {
  content: string;
  provider: string;
  model: string;
  aiTaskId?: string;
  tokensInput: number;
  tokensOutput: number;
  tokensUsed: number;
  durationMs: number;
}
