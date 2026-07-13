import type { ApplyExecutionResult, ApplyPlan, PlacementProposal } from './placement';

export interface PrepareCoCreationApplyInput {
  operationId: string;
  novelId: string;
  sessionId: string;
  draftRevisionId: string;
  expectedDraftContentHash: string;
  suggestionIds: string[];
  parentPlanId?: string;
}

export interface PrepareCoCreationUndoInput {
  operationId: string;
  novelId: string;
  completedPlanId: string;
}

export interface CoCreationAffectedTargetV1 {
  targetType: string;
  targetId: string;
  action: string;
  fieldPaths: string[];
}

export interface CoCreationApplyPreparationV1 {
  proposal: PlacementProposal;
  plan: ApplyPlan;
  affectedTargets: CoCreationAffectedTargetV1[];
  impactWarnings: string[];
}

export interface CoCreationApplyResultV1 {
  preparation: CoCreationApplyPreparationV1;
  execution: ApplyExecutionResult;
}
