export type MemorySourceType = 'adopted_draft' | 'chapter_summary' | 'context_record';
export type MemoryDocumentStatus = 'active' | 'invalidated';

export interface MemoryDocument {
  id: string;
  novelId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
  adoptedDraftId?: string;
  chapterId?: string;
  status: MemoryDocumentStatus;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
  invalidatedAt?: string;
  invalidationReason?: string;
}
export interface MemoryChunkInput {
  id: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  importance: number;
  chapterOrderIndex?: number;
  temporalStartChapter?: number;
  temporalEndChapter?: number;
  entityKeys?: string[];
  metadata?: Record<string, unknown>;
  contentHash: string;
}

export interface PutMemoryDocumentInput {
  traceId?: string;
  documentId: string;
  novelId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
  adoptedDraftId?: string;
  chapterId?: string;
  metadata?: Record<string, unknown>;
  chunks: MemoryChunkInput[];
}

export interface PutMemoryDocumentOutput {
  document: MemoryDocument;
  chunks: Array<{
    id: string;
    documentId: string;
    novelId: string;
    chapterId?: string;
    ordinal: number;
    text: string;
    tokenCount: number;
    importance: number;
    chapterOrderIndex?: number;
    temporalStartChapter?: number;
    temporalEndChapter?: number;
    entityKeysJson: string;
    metadataJson: string;
    contentHash: string;
    createdAt: string;
  }>;
  created: boolean;
  invalidatedDocumentCount: number;
}

export interface EmbeddingVectorInput {
  chunkId: string;
  vector: number[];
}

export interface PutMemoryEmbeddingsInput {
  traceId?: string;
  novelId: string;
  provider: string;
  model: string;
  dimension: number;
  items: EmbeddingVectorInput[];
}

export interface MemoryEmbeddingOutput {
  id: string;
  chunkId: string;
  provider: string;
  model: string;
  dimension: number;
  vectorHash: string;
  chunkContentHash: string;
  createdAt: string;
}

export interface MemoryRetrievalFilters {
  chapterId?: string;
  chapterStart?: number;
  chapterEnd?: number;
  sourceTypes?: MemorySourceType[];
  entityKeys?: string[];
  minImportance?: number;
  temporalChapter?: number;
}

export interface QueryEmbeddingInput {
  provider: string;
  model: string;
  dimension: number;
  vector: number[];
}

export interface RetrieveMemoryInput {
  traceId?: string;
  requestId: string;
  novelId: string;
  query?: string;
  queryEmbedding?: QueryEmbeddingInput;
  filters?: MemoryRetrievalFilters;
  topK?: number;
  offset?: number;
  candidateLimit?: number;
  tokenBudget?: number;
}

export interface MemoryScoreReason {
  matchedBy: string[];
  semanticScore?: number;
  lexicalScore?: number;
  importanceScore: number;
  recencyScore: number;
  finalScore: number;
}

export interface MemoryRetrievalItem {
  chunkId: string;
  documentId: string;
  text: string;
  tokenCount: number;
  contentHash: string;
  sourceType: MemorySourceType;
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
  adoptedDraftId?: string;
  chapterId?: string;
  chapterOrderIndex?: number;
  entityKeys: string[];
  metadata: Record<string, unknown>;
  score: MemoryScoreReason;
}

export interface RetrieveMemoryOutput {
  requestId: string;
  retrievalMode:
    'hybrid' | 'semantic_structured' | 'fts_structured' | 'lexical_structured' | 'structured';
  ftsAvailable: boolean;
  semanticCandidateCount: number;
  candidateCount: number;
  usedTokens: number;
  tokenBudget: number;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  items: MemoryRetrievalItem[];
}

export interface MemoryDocumentPage {
  total: number;
  offset: number;
  limit: number;
  items: MemoryDocument[];
}
