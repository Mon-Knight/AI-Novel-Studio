export const CO_CREATION_PROTOCOL_VERSION = 1 as const;

export type CoCreationStage =
  | 'story_seed'
  | 'creative_intent'
  | 'world_background'
  | 'rule_system'
  | 'protagonist'
  | 'core_conflict'
  | 'story_arc'
  | 'outline'
  | 'chapter_plan'
  | 'chapter_generation';

export type CoCreationStageStatus =
  | 'not_started'
  | 'in_progress'
  | 'minimum_complete'
  | 'complete'
  | 'skipped';

export type CoCreationIntent =
  | 'answer_current_question'
  | 'free_discussion'
  | 'modify_setting'
  | 'request_ai_completion'
  | 'generate_outline'
  | 'generate_chapter'
  | 'revise_existing_content'
  | 'accept_suggestion'
  | 'reject_suggestion'
  | 'undo_change'
  | 'navigate_to_page';

export type CoCreationFieldState =
  | 'user_confirmed'
  | 'ai_suggested'
  | 'ai_inferred'
  | 'temporary_assumption'
  | 'conflict'
  | 'blank';

export type CoCreationSourceType =
  | 'author_message'
  | 'formal_project_data'
  | 'adopted_chapter_text'
  | 'pending_draft'
  | 'ai_inference';

export interface CoCreationSourceReferenceV1 {
  sourceType: CoCreationSourceType;
  sourceId: string;
  excerpt?: string;
  contentHash?: string;
}

export interface CoCreationConflictV1 {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
  sourceReferences: CoCreationSourceReferenceV1[];
}

export interface CoCreationFieldTargetV1 {
  objectType:
    | 'story_seed'
    | 'creative_intent'
    | 'world_setting'
    | 'rule_system'
    | 'protagonist'
    | 'outline'
    | 'volume'
    | 'chapter';
  objectId?: string;
  fieldPath: string;
}

export interface CoCreationExtractedInformationV1 {
  target: CoCreationFieldTargetV1;
  value: unknown;
  fieldState: CoCreationFieldState;
  sourceReferences: CoCreationSourceReferenceV1[];
  confidence: number;
}

export interface CoCreationFieldSuggestionV1 {
  suggestionId: string;
  target: CoCreationFieldTargetV1;
  originalValue: unknown;
  suggestedValue: unknown;
  fieldState: Exclude<CoCreationFieldState, 'user_confirmed' | 'blank'>;
  sourceType: CoCreationSourceType;
  sourceReferences: CoCreationSourceReferenceV1[];
  confidence: number;
  conflicts: CoCreationConflictV1[];
  baseDataRevision: number;
  baseContextHash?: string;
  baseTargetVersion?: number;
  baseTargetHash?: string;
  decision: 'pending' | 'accepted_to_draft' | 'rejected';
  candidateHash: string;
  sourceMessageId?: string;
  sourceTaskId?: string;
  sourceArtifactId?: string;
  conflictsAcknowledged?: boolean;
  confirmedReplacement?: boolean;
  formalApplyPlanId?: string;
  formalAppliedAt?: string;
}

export interface CoCreationQuestionV1 {
  question: string;
  reason: string;
  targetFieldPaths: string[];
}

export interface CoCreationQuickReplyV1 {
  id: string;
  label: string;
  value: string;
}

export interface CoCreationStageCompletionV1 {
  stage: CoCreationStage;
  status: CoCreationStageStatus;
  completedRequiredFields: string[];
  missingRequiredFields: string[];
  percentage: number;
}

export interface CoCreationTurnOutputV1 {
  schemaVersion: typeof CO_CREATION_PROTOCOL_VERSION;
  naturalLanguageReply: string;
  intent: CoCreationIntent;
  currentStage: CoCreationStage;
  extractedInformation: CoCreationExtractedInformationV1[];
  pendingConfirmations: string[];
  nextHighValueQuestion?: CoCreationQuestionV1;
  quickReplies: CoCreationQuickReplyV1[];
  changeSuggestions: CoCreationFieldSuggestionV1[];
  stageCompletion: CoCreationStageCompletionV1;
  dataRevision: number;
}

export interface CoCreationStageProgress {
  stage: CoCreationStage;
  status: CoCreationStageStatus;
  percentage: number;
  missingRequiredFields: string[];
}

export interface CoCreationObjectContext {
  novelId: string;
  volumeId?: string;
  chapterId?: string;
  objectType?: string;
  objectId?: string;
  selectedText?: string;
  selectedTextHash?: string;
}

export interface CoCreationTurnContextV1 {
  currentStage: CoCreationStage;
  canonicalDataHash: string;
  dataRevision: number;
}

export interface CoCreationSession {
  sessionId: string;
  novelId: string;
  title: string;
  status: 'active' | 'archived';
  currentStage: CoCreationStage;
  stageProgress: CoCreationStageProgress[];
  objectContext: CoCreationObjectContext;
  summary?: string;
  summaryHash?: string;
  activeDraftRevisionId?: string;
  activeArtifactId?: string;
  dataRevision: number;
  dataHash: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CoCreationMessage {
  messageId: string;
  sessionId: string;
  sequenceNo: number;
  role: 'user' | 'assistant';
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  content: string;
  contentHash: string;
  contentLength: number;
  replyToMessageId?: string;
  sourceTaskId?: string;
  sourceArtifactId?: string;
  turnContext?: CoCreationTurnContextV1;
  structuredPayload?: unknown;
  operationId: string;
  requestHash: string;
  createdAt: string;
  completedAt?: string;
}

export interface CoCreationDraftRevision {
  draftRevisionId: string;
  sessionId: string;
  stage: CoCreationStage;
  revisionNo: number;
  parentRevisionId?: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  contentHash: string;
  origin: 'author_edit' | 'assistant_proposal_accepted' | 'assistant_turn';
  sourceMessageId?: string;
  sourceTaskId?: string;
  sourceArtifactId?: string;
  operationId: string;
  requestHash: string;
  createdAt: string;
}

export interface CoCreationWorkspaceSnapshot {
  session: CoCreationSession;
  messages: CoCreationMessage[];
  draftRevisions: CoCreationDraftRevision[];
  activeDraft?: CoCreationDraftRevision;
  pendingTurn?: CoCreationMessage;
}

export interface PersistedCoCreationSessionV1 {
  sessionId: string;
  novelId: string;
  workspaceType: string;
  status: 'active' | 'archived';
  revision: number;
  stateHash: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface PersistedCoCreationMessageV1 {
  messageId: string;
  sessionId: string;
  turnId: string;
  sequenceNo: number;
  role: 'user' | 'assistant';
  status: 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled';
  content: string;
  contentHash: string;
  contentLength: number;
  replyToMessageId?: string;
  taskId?: string;
  artifactId?: string;
  turnContext?: CoCreationTurnContextV1;
  error?: unknown;
  createdAt: string;
  completedAt?: string;
}

export interface PersistedCoCreationDraftRevisionV1 {
  draftRevisionId: string;
  sessionId: string;
  stageKey: CoCreationStage;
  revisionNo: number;
  parentRevisionId?: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  contentHash: string;
  origin: CoCreationDraftRevision['origin'];
  sourceMessageId?: string;
  sourceTaskId?: string;
  sourceArtifactId?: string;
  createdAt: string;
}

export interface PersistedCoCreationWorkspaceV1 {
  schemaVersion: number;
  session: PersistedCoCreationSessionV1;
  messages: PersistedCoCreationMessageV1[];
  draftRevisions: PersistedCoCreationDraftRevisionV1[];
}

export interface CoCreationMutationReceiptV1 {
  sessionId: string;
  operationId: string;
  operationType: string;
  revision: number;
  stateHash: string;
  messageId?: string;
  draftRevisionId?: string;
  idempotentReplay: boolean;
}
