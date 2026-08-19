import { dbCall } from '../database/db';
import type {
  MemoryDocumentPage,
  MemoryDocumentStatus,
  PutMemoryDocumentInput,
  PutMemoryDocumentOutput,
  PutMemoryEmbeddingsInput,
  MemoryEmbeddingOutput,
  RetrieveMemoryInput,
  RetrieveMemoryOutput,
} from '../../types/memory';

const MAX_EMBEDDING_DIMENSION = 8192;
const MAX_TOP_K = 50;
const MAX_CANDIDATES = 500;
const MAX_TOKEN_BUDGET = 100_000;

export function validateEmbeddingVector(vector: readonly number[], dimension: number): void {
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > MAX_EMBEDDING_DIMENSION) {
    throw new Error('Embedding 维度无效。');
  }
  if (vector.length !== dimension) {
    throw new Error(`Embedding 向量维度不匹配：期望 ${dimension}，实际 ${vector.length}。`);
  }
  let squaredNorm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('Embedding 向量包含非有限数值。');
    squaredNorm += value * value;
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm <= Number.EPSILON) {
    throw new Error('Embedding 向量范数无效。');
  }
}

export function normalizeRetrieveMemoryInput(
  input: RetrieveMemoryInput,
): Required<
  Pick<
    RetrieveMemoryInput,
    | 'requestId'
    | 'novelId'
    | 'query'
    | 'filters'
    | 'topK'
    | 'offset'
    | 'candidateLimit'
    | 'tokenBudget'
  >
> &
  Pick<RetrieveMemoryInput, 'traceId' | 'queryEmbedding'> {
  const normalized = {
    traceId: input.traceId,
    requestId: input.requestId.trim(),
    novelId: input.novelId.trim(),
    query: input.query?.trim() ?? '',
    queryEmbedding: input.queryEmbedding,
    filters: input.filters ?? {},
    topK: input.topK ?? 10,
    offset: input.offset ?? 0,
    candidateLimit: input.candidateLimit ?? 200,
    tokenBudget: input.tokenBudget ?? 8_000,
  };
  if (!normalized.requestId || !normalized.novelId) {
    throw new Error('Memory 检索缺少请求或作品标识。');
  }
  if (
    !Number.isInteger(normalized.topK) ||
    normalized.topK < 1 ||
    normalized.topK > MAX_TOP_K ||
    !Number.isInteger(normalized.offset) ||
    normalized.offset < 0 ||
    !Number.isInteger(normalized.candidateLimit) ||
    normalized.candidateLimit < normalized.topK ||
    normalized.candidateLimit > MAX_CANDIDATES ||
    !Number.isInteger(normalized.tokenBudget) ||
    normalized.tokenBudget < 1 ||
    normalized.tokenBudget > MAX_TOKEN_BUDGET
  ) {
    throw new Error('Memory 检索分页、候选或 Token 预算参数无效。');
  }
  if (normalized.queryEmbedding) {
    if (!normalized.queryEmbedding.provider.trim() || !normalized.queryEmbedding.model.trim()) {
      throw new Error('Embedding 模型身份无效。');
    }
    validateEmbeddingVector(normalized.queryEmbedding.vector, normalized.queryEmbedding.dimension);
  }
  const hasFilter = Object.values(normalized.filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined,
  );
  if (!normalized.query && !normalized.queryEmbedding && !hasFilter) {
    throw new Error('Memory 检索至少需要查询文本、Embedding 或结构化过滤条件。');
  }
  return normalized;
}

export const memoryService = {
  async putDocument(input: PutMemoryDocumentInput): Promise<PutMemoryDocumentOutput> {
    return dbCall<PutMemoryDocumentOutput>('put_memory_document', { input });
  },

  async putEmbeddings(input: PutMemoryEmbeddingsInput): Promise<MemoryEmbeddingOutput[]> {
    for (const item of input.items) validateEmbeddingVector(item.vector, input.dimension);
    const output = await dbCall<{ embeddings: MemoryEmbeddingOutput[] }>('put_memory_embeddings', {
      input,
    });
    return output.embeddings;
  },

  async retrieve(input: RetrieveMemoryInput): Promise<RetrieveMemoryOutput> {
    return dbCall<RetrieveMemoryOutput>('retrieve_memory', {
      input: normalizeRetrieveMemoryInput(input),
    });
  },

  async listDocuments(input: {
    novelId: string;
    status?: MemoryDocumentStatus;
    offset?: number;
    limit?: number;
  }): Promise<MemoryDocumentPage> {
    return dbCall<MemoryDocumentPage>('list_memory_documents', {
      input: {
        novelId: input.novelId,
        status: input.status,
        offset: input.offset ?? 0,
        limit: input.limit ?? 50,
      },
    });
  },

  async invalidateDocument(input: {
    traceId?: string;
    novelId: string;
    documentId: string;
    expectedSourceHash: string;
    reason: string;
  }): Promise<boolean> {
    const output = await dbCall<{ invalidated: boolean }>('invalidate_memory_document', {
      input,
    });
    return output.invalidated;
  },
};
