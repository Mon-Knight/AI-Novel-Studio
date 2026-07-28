export type ContentTransactionStrategy = 'all_or_nothing' | 'reviewed_partial';
export type ContentEffectType = 'create' | 'update';
export type ContentTargetType =
  | 'faction'
  | 'location'
  | 'faction_relation'
  | 'location_link'
  | 'character_faction'
  | 'chapter_faction'
  | 'chapter_location'
  | 'chapter_event_faction'
  | 'chapter_event_location'
  | 'chapter_metadata';

export interface PrepareContentTargetInput {
  targetType: ContentTargetType;
  targetId: string;
  effectType: ContentEffectType;
  payload: Record<string, unknown>;
}

export interface PrepareContentTransactionInput {
  operationId: string;
  novelId: string;
  strategy: ContentTransactionStrategy;
  targets: PrepareContentTargetInput[];
}

export interface ApprovedContentTarget {
  targetType: ContentTargetType;
  targetId: string;
}

export interface ContentTransactionTarget {
  ordinal: number;
  targetType: ContentTargetType;
  targetId: string;
  effectType: ContentEffectType;
  baseRevision: number;
  baseHash: string;
  candidatePayload: Record<string, unknown>;
  candidateHash: string;
  appliedRevision?: number;
  appliedHash?: string;
  appliedAt?: string;
}

export interface ContentTransaction {
  transactionId: string;
  operationId: string;
  requestHash: string;
  novelId: string;
  strategy: ContentTransactionStrategy;
  targetSet: Array<Record<string, unknown>>;
  targetSetHash: string;
  transactionHash: string;
  status: 'prepared' | 'applied' | 'conflict';
  revision: number;
  result?: Record<string, unknown>;
  createdAt: string;
  appliedAt?: string;
  targets: ContentTransactionTarget[];
}

export interface ApplyContentTransactionInput {
  transactionId: string;
  operationId: string;
  expectedTransactionHash: string;
  approvedTargets?: ApprovedContentTarget[];
}

export interface ApplyContentTransactionResult {
  transaction: ContentTransaction;
  replayed: boolean;
}

export interface FactionAsset {
  id: string;
  novelId: string;
  name: string;
  kind?: string;
  description: string;
  goals: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationAsset {
  id: string;
  novelId: string;
  name: string;
  kind?: string;
  description: string;
  parentLocationId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
