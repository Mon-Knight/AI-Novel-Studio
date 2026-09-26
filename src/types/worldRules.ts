/** Stored in existing structuredJson; authority is not epistemic certainty or enforcement. */
export type WorldRuleKind =
  | 'world_fact'
  | 'causal_rule'
  | 'social_norm'
  | 'character_belief'
  | 'author_constraint'
  | 'narrative_preference';
export type RuleAuthority = 'draft' | 'candidate' | 'confirmed' | 'superseded';
export type RuleStrength = 'hard' | 'soft' | 'descriptive';
export type RuleKnowledgeStatus = 'established' | 'uncertain' | 'disputed' | 'belief';
export type WorldParameterKey =
  | 'time_history'
  | 'space_environment'
  | 'institutions_power'
  | 'economy_resources'
  | 'technology_infrastructure'
  | 'culture_daily_life'
  | 'information_knowledge'
  | 'conflict_boundaries';

export interface WorldRuleDocument {
  schemaVersion: 1;
  contract: 'world_rules_v1';
  identity: { id: string; revision: number; supersedesRevision?: number };
  kind: WorldRuleKind;
  authority: RuleAuthority;
  strength: RuleStrength;
  statement: string;
  conditions: string[];
  scope: {
    summary: string;
    chapterIds: string[];
    places: string[];
    groups: string[];
    characters: string[];
  };
  chronology: { effectiveFrom: string; effectiveUntil: string; revealAt: string };
  epistemic: {
    status: RuleKnowledgeStatus;
    knownBy: string[];
    learnedAt: string;
    evidence: string;
  };
  boundaries: { limitations: string; cost: string; ceiling: string };
  exceptions: Array<{
    condition: string;
    effect: string;
    approval: 'proposed' | 'author_approved';
    reason: string;
  }>;
  provenance: { origin: 'user' | 'ai_candidate' | 'adopted_text' | 'legacy'; sourceRefs: string[] };
  dependencies: string[];
  worldParameters: Partial<Record<WorldParameterKey, string>>;
}

export type WorldRuleChangeIntent = 'confirm_change' | 'retcon' | 'approve_exception';
export interface WorldRuleChangeAuthorization {
  previewHash: string;
  intent: WorldRuleChangeIntent;
  notes?: string;
}
export interface WorldRuleSaveGuard {
  structuredJson?: string;
  expectedUpdatedAt?: string;
  expectedRuleSetFingerprint?: string;
  changeAuthorization?: WorldRuleChangeAuthorization;
}

export interface WorldRuleSetSnapshot {
  novelId: string;
  fingerprint: string;
  sources: Array<Record<string, unknown>>;
}

export interface WorldRuleChangeImpact {
  novelId: string;
  ruleSetFingerprint: string;
  sources: Array<Record<string, unknown>>;
  affectedChapters: Array<{
    chapterId: string;
    title: string;
    adoptedDraftId: string;
    evidence: string;
    certainty: string;
  }>;
  dependentRules: Array<Record<string, unknown>>;
  blockingConflicts: Array<Record<string, unknown>>;
  uncertainty: string[];
  requiresConfirmation: boolean;
  previewHash: string;
}
export type WorldRuleChangePreview = WorldRuleChangeImpact;

export interface WorldRuleChange {
  operation?: 'upsert' | 'delete';
  targetType: 'world_setting' | 'rule_system';
  targetId?: string;
  title: string;
  content: string;
  category?: string;
  forbiddenRules?: string;
  structuredJson?: string;
  isActive: boolean;
}
export interface WorldRuleImpactInput {
  novelId: string;
  changes: WorldRuleChange[];
}
