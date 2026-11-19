import type { TaskModelSnapshot } from './conversation';

/** Formal writes are separate permissions, never implied by permission to generate. */
export type TaskAuthorizationAction = 'apply_planning' | 'adopt_chapter_text' | 'apply_summary';
export interface TaskAuthorizationBudget {
  maxRequests: number;
  maxToolCalls: number;
  maxRevisions: number;
  maxTokens: number;
  maxCostUsd: number;
  maxWallClockMs: number;
}
export interface TaskAuthorizationCreationScope {
  /** Explicit one-based volume interval; not an unlimited permission for this novel. */
  firstVolumeIndex: number;
  lastVolumeIndex: number;
  maxNewVolumes: number;
  maxNewChapters: number;
}
export interface IssueTaskAuthorizationInput {
  conversationId: string;
  novelId: string;
  sourceTurnId: string;
  chapterIds: string[];
  allowNovelPlanning: boolean;
  creationScope?: TaskAuthorizationCreationScope;
  actions: Array<{ action: TaskAuthorizationAction; maxWrites: number }>;
  maxWrites: number;
  budget: TaskAuthorizationBudget;
  expiresAt: string;
}
export interface TaskAuthorization {
  authorizationId: string;
  conversationId: string;
  novelId: string;
  sourceTurnId: string;
  status: 'active' | 'revoked' | 'expired' | 'exhausted';
  revision: number;
  spec: IssueTaskAuthorizationInput;
  modelSnapshot: TaskModelSnapshot;
  modelSnapshotHash: string;
  baselineHash: string;
  usedWrites: number;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revocationReason?: string;
}
export interface ApplyTaskAuthorizationInput {
  authorizationId: string;
  operationId: string;
  cardId: string;
  artifactId: string;
  action: TaskAuthorizationAction;
}
export interface TaskAuthorizationReceipt {
  receiptId: string;
  authorizationId: string;
  operationId: string;
  conversationId: string;
  novelId: string;
  artifactId: string;
  cardId: string;
  action: TaskAuthorizationAction;
  authority: 'task_preauthorized';
  beforeHash: string;
  afterHash: string;
  result: Record<string, unknown>;
  createdAt: string;
  replayed: boolean;
}
