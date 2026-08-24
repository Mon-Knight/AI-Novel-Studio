import type { ResultArtifactType } from './result-artifact';

export type ConversationStatus =
  'idle' | 'running' | 'waiting_user' | 'failed' | 'completed' | 'archived';

export type ConversationTurnRole = 'user' | 'assistant' | 'system';

export type TaskRunStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';

export type ToolCallStatus =
  'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export interface TaskModelSnapshot {
  providerId: string;
  modelId: string;
  runtimeMode: 'mock' | 'api';
  baseUrl?: string;
  capabilities: string[];
  options: Record<string, unknown>;
  pricing?: {
    inputPricePerMillionTokens?: number;
    outputPricePerMillionTokens?: number;
  };
  runtime?: {
    adapterProtocol: string;
    adapterProvider: string;
    dshSourceCommit?: string;
    bundle: string;
    profile: string;
  };
  capturedAt: string;
}

export interface TaskConversation {
  conversationId: string;
  novelId: string;
  title: string;
  status: ConversationStatus;
  defaultModel?: TaskModelSnapshot;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ConversationTurn {
  turnId: string;
  conversationId: string;
  sequence: number;
  role: ConversationTurnRole;
  /** Browser-only legacy preview; desktop cards resolve content from ResultArtifact. */
  content?: string;
  runId?: string;
  createdAt: string;
}

export interface TaskRun {
  runId: string;
  conversationId: string;
  turnId: string;
  status: TaskRunStatus;
  modelSnapshot: TaskModelSnapshot;
  workerId: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ToolCallEvent {
  eventId: string;
  runId: string;
  callId?: string;
  sequence: number;
  toolName: string;
  argumentsSummary: Record<string, unknown>;
  status: ToolCallStatus;
  durationMs?: number;
  error?: string;
  result?: unknown;
  createdAt: string;
  finishedAt?: string;
}

export type ArtifactDecisionKind = 'confirm' | 'reject' | 'request_revision' | 'request_apply';

export interface ArtifactDecision {
  decisionId: string;
  artifactId: string;
  artifactHash: string;
  cardId: string;
  conversationId: string;
  decision: ArtifactDecisionKind;
  idempotencyKey: string;
  actor: string;
  targetType: string;
  targetId: string;
  baseRevision?: string;
  applyTransactionId?: string;
  conflictCode?: string;
  createdAt: string;
}

export type ReviewAuthorizationStatus = 'issued' | 'consumed' | 'expired';

export interface ReviewAuthorization {
  authorizationId: string;
  artifactId: string;
  chapterId: string;
  novelId: string;
  decisionId: string;
  status: ReviewAuthorizationStatus;
  issuedAt: string;
  consumedAt?: string;
  consumedByDraftId?: string;
}

export interface ReviewCandidateDocument {
  authorizationId: string;
  artifactId: string;
  content: string;
  contentHash: string;
  chapterId: string;
  novelId: string;
}

export interface ConversationArtifactCard {
  cardId: string;
  conversationId: string;
  turnId?: string;
  runId?: string;
  artifactId?: string;
  artifactType: ResultArtifactType | 'generic';
  title: string;
  summary: string;
  content?: string;
  status: 'candidate' | 'confirmed' | 'rejected';
  createdAt: string;
  latestDecision?: ArtifactDecision;
  reviewAuthorization?: ReviewAuthorization;
}

export interface TaskConversationBundle {
  conversation: TaskConversation;
  turns: ConversationTurn[];
  runs: TaskRun[];
  toolEvents: ToolCallEvent[];
  artifacts: ConversationArtifactCard[];
  decisions?: ArtifactDecision[];
  authorizations?: ReviewAuthorization[];
}
