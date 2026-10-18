import type { ArtifactRevisionSource } from './artifactRevision';
import type {
  ArtifactProcessingStatus,
  ArtifactValidationIssue,
  ResultArtifactType,
} from './result-artifact';

export type ConversationStatus =
  'idle' | 'running' | 'waiting_user' | 'failed' | 'completed' | 'archived';

export type ConversationTurnRole = 'user' | 'assistant' | 'system';

export type TaskRunStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';

export type ToolCallStatus =
  'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export interface ModelToolCallingAttestation {
  protocol: 'ans_model_tool_attestation_v1';
  provider: string;
  model: string;
  verified: true;
  cached: boolean;
  verifiedAt: string;
  expiresAt: string;
  cacheTtlMs: number;
  finishKind: 'tool-calls';
  observedToolCalls: 1;
}

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
    toolCallingAttestation?: ModelToolCallingAttestation;
  };
  capturedAt: string;
}

export interface TaskConversation {
  conversationId: string;
  novelId: string;
  title: string;
  status: ConversationStatus;
  /** Persisted choice for new turns; changing it never rewrites existing runs. */
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
  /** Immutable revision identity restored from persisted turn metadata. */
  revisionSource?: ArtifactRevisionSource;
  /** Browser-only legacy preview; desktop cards resolve content from ResultArtifact. */
  content?: string;
  runId?: string;
  createdAt: string;
}

export interface TaskRun {
  runId: string;
  conversationId: string;
  turnId: string;
  /** Immutable chapter scope captured when this run is created. */
  chapterId?: string;
  status: TaskRunStatus;
  /** Frozen for this run, including when the task later selects another model. */
  modelSnapshot: TaskModelSnapshot;
  workerId: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/** One turn and its runs. It is not a full conversation bundle. */
export interface TaskTurnRunProjection {
  turn: ConversationTurn;
  runs: TaskRun[];
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

export interface ConversationArtifactEvidence {
  sourceNovelId: string;
  sourceChapterId?: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  baseContentHash?: string;
  derivationType?: string;
  processingStatus: ArtifactProcessingStatus;
  validationIssues: ArtifactValidationIssue[];
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
  contentLoadError?: string;
  status: 'candidate' | 'confirmed' | 'rejected';
  createdAt: string;
  /** Conversation-wide rank. Never the index inside the loaded page. */
  candidateOrdinal?: number;
  latestDecision?: ArtifactDecision;
  reviewAuthorization?: ReviewAuthorization;
  artifactEvidence?: ConversationArtifactEvidence;
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

export interface InitializedTaskConversation {
  conversation: TaskConversation;
  turn: ConversationTurn;
}

/** UI page metadata. It never replaces the authoritative full conversation read. */
export interface ConversationWindowPage {
  startSequence: number | null;
  endSequenceExclusive: number | null;
  oldestUserSequence: number | null;
  newestUserSequence: number | null;
  hasOlder: boolean;
  hasNewer: boolean;
  userRoundCount: number;
}

export interface ConversationWindow {
  bundle: TaskConversationBundle;
  page: ConversationWindowPage;
}

/** Session cursor for the loaded user-round window. It is not a database row. */
export interface ConversationWindowCursor {
  conversationId: string;
  oldestUserSequence: number | null;
  loadedUserRounds: number;
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface ConversationWindowQuery {
  conversationId: string;
  limit?: number;
  beforeUserSequence?: number;
  minUserSequence?: number;
  focusTurnId?: string;
  focusCardId?: string;
}

/** A non-terminal run and the user turn that started it. Chapter is the run's own scope. */
export interface RunningTaskTarget {
  conversationId: string;
  novelId: string;
  title: string;
  runId: string;
  chapterId?: string;
  latestGoal?: string;
}
