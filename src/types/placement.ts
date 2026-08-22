import type { WorldSetting } from './setting';

export interface PlacementProposal {
  proposalId: string;
  artifactId: string;
  candidateIndex: number;
  candidateHash: string;
  proposalType: 'create_world_setting';
  targetType: 'world_setting';
  targetNovelId: string;
  targetId: string;
  expectedTargetVersion: 0;
  expectedTargetHash: string;
  effectPayloadJson: Record<string, unknown>;
  proposalHash: string;
  createdAt: string;
}

export type ApplyPlanStatus = 'awaiting_confirmation' | 'applying' | 'applied' | 'conflict';

export interface ApplyPlan {
  planId: string;
  proposalId: string;
  operationId: string;
  planHash: string;
  targetType: 'world_setting';
  targetId: string;
  expectedTargetVersion: 0;
  expectedTargetHash: string;
  effectPayloadJson: Record<string, unknown>;
  status: ApplyPlanStatus;
  stateRevision: number;
  confirmedBy?: 'user';
  userConfirmedAt?: string;
  resultJson?: Record<string, unknown>;
  errorJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
}

export interface ArtifactTargetLink {
  linkId: string;
  artifactId: string;
  proposalId: string;
  applyPlanId: string;
  targetType: 'world_setting';
  targetId: string;
  relationship: 'created_from';
  targetVersion: 1;
  targetHash: string;
  createdAt: string;
}

export interface PlacementBundle {
  proposal: PlacementProposal;
  plan: ApplyPlan;
  candidateJson: Record<string, unknown>;
}

export interface ApplyPlacementResult {
  proposal: PlacementProposal;
  plan: ApplyPlan;
  link: ArtifactTargetLink;
  worldSetting: WorldSetting;
  replayed: boolean;
}
