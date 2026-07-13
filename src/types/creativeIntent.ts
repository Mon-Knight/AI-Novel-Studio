export const CREATIVE_INTENT_SCHEMA_VERSION = 1 as const;
export const INITIALIZATION_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const DIRECTOR_GOVERNANCE_SCHEMA_VERSION = 1 as const;

export type CreativeKnowledgeClass =
  | 'author_explicit'
  | 'inferred_preference'
  | 'requires_confirmation';

export type ConfirmationStatus = 'pending' | 'confirmed' | 'rejected';

export interface EvidenceReferenceV1 {
  evidenceId: string;
  sourceType: 'author_input' | 'project_document' | 'canon' | 'ai_inference';
  sourceId?: string;
  excerpt?: string;
  contentHash?: string;
}

export interface AuthorConfirmationV1 {
  status: ConfirmationStatus;
  confirmedBy?: 'author';
  confirmedAt?: string;
}

export interface CreativeIntentStatementV1 {
  statementId: string;
  kind: 'goal' | 'preference' | 'fact' | 'constraint';
  knowledgeClass: CreativeKnowledgeClass;
  value: unknown;
  confidence: number;
  evidence: EvidenceReferenceV1[];
  confirmation: AuthorConfirmationV1;
  statementHash: string;
}

export interface CreativeIntentSnapshotV1 {
  schemaVersion: typeof CREATIVE_INTENT_SCHEMA_VERSION;
  intentId: string;
  novelId: string;
  revision: number;
  parentIntentId?: string;
  status: 'frozen';
  statements: CreativeIntentStatementV1[];
  createdAt: string;
  frozenAt: string;
  contentHash: string;
}

export type InitializationTargetType = 'world_setting' | 'rule_system' | 'character';

export interface InitializationConflictV1 {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
  evidenceRefs: string[];
}

export interface InitializationCandidateV1 {
  candidateId: string;
  targetType: InitializationTargetType;
  proposedValue: Record<string, unknown>;
  knowledgeClass: CreativeKnowledgeClass;
  confidence: number;
  evidence: EvidenceReferenceV1[];
  explanation: string;
  conflicts: InitializationConflictV1[];
  conflictAcknowledged: boolean;
  confirmation: AuthorConfirmationV1;
  dependsOnCandidateIds: string[];
  candidateHash: string;
}

export interface InitializationCandidateBundleV1 {
  schemaVersion: typeof INITIALIZATION_CANDIDATE_SCHEMA_VERSION;
  bundleId: string;
  novelId: string;
  revision: number;
  parentBundleId?: string;
  intent: Pick<CreativeIntentSnapshotV1, 'intentId' | 'revision' | 'contentHash'>;
  items: InitializationCandidateV1[];
  createdAt: string;
  contentHash: string;
}

export interface InitializationCandidateDecisionV1 {
  candidateId: string;
  expectedCandidateHash: string;
  decision: 'confirm' | 'reject';
  conflictAcknowledged?: boolean;
}

export interface DirectorBudgetV1 {
  limits: {
    maxProviderCalls: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxCostUsd: number;
    maxDurationMs: number;
  };
  used: {
    providerCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  };
  onExceeded: 'block';
}

export interface DirectorPermissionsV1 {
  canSubmitTasks: boolean;
  canReadCanon: boolean;
  canProposeCanonChanges: boolean;
  canApplyCanonChanges: false;
  canChangeProviderConfig: false;
  allowedTaskTypes: string[];
  allowedTargetTypes: InitializationTargetType[];
}

export interface DirectorGovernanceV1 {
  schemaVersion: typeof DIRECTOR_GOVERNANCE_SCHEMA_VERSION;
  governanceId: string;
  novelId: string;
  intent: Pick<CreativeIntentSnapshotV1, 'intentId' | 'revision' | 'contentHash'>;
  budget: DirectorBudgetV1;
  permissions: DirectorPermissionsV1;
  createdAt: string;
  contentHash: string;
}

export interface DirectorDecisionAuditV1 {
  schemaVersion: typeof DIRECTOR_GOVERNANCE_SCHEMA_VERSION;
  decisionId: string;
  taskId: string;
  governanceId: string;
  intent: Pick<CreativeIntentSnapshotV1, 'intentId' | 'revision' | 'contentHash'>;
  selectedAction: string;
  alternatives: string[];
  rationale: string;
  evidence: EvidenceReferenceV1[];
  requiresUserConfirmation: true;
  outcome: 'proposed' | 'approved' | 'rejected' | 'executed';
  createdAt: string;
  contentHash: string;
}

