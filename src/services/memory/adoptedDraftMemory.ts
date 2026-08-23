import type { ChapterDraft } from '../../types/ai';
import type {
  MemoryChunkInput,
  PutMemoryDocumentInput,
  RetrieveMemoryOutput,
} from '../../types/memory';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { countTextWords } from '../../utils/contentHash';
import { generateId, isTauri, lsGet, lsSet } from '../database/db';
import { memoryService } from './memoryService';
import { appLogger } from '../observability/appLogger';

const LOCAL_KEY = 'ai_novel_studio_memory_documents';
const CHUNK_CHARS = 1800;

interface LocalMemoryDocument {
  input: PutMemoryDocumentInput;
  updatedAt: string;
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';
  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if (buffer && buffer.length + paragraph.length + 2 > CHUNK_CHARS) {
      chunks.push(buffer);
      buffer = paragraph;
    } else {
      buffer = buffer ? buffer + '\n\n' + paragraph : paragraph;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function asSha256(value: string): string {
  const hex = value.toLowerCase().replace(/[^a-f0-9]/g, '');
  if (hex.length >= 64) return hex.slice(0, 64);
  return hex.padStart(64, '0');
}

async function sourceHashOf(draft: ChapterDraft): Promise<string> {
  if (
    draft.contentState?.status === 'ready' &&
    /^[a-f0-9]{64}$/i.test(draft.contentState.contentHash)
  ) {
    return draft.contentState.contentHash.toLowerCase();
  }
  return asSha256(await computeContentSha256(draft.content));
}

export async function buildAdoptedDraftMemoryInput(
  draft: ChapterDraft,
): Promise<PutMemoryDocumentInput> {
  const pieces = chunkText(draft.content);
  if (pieces.length === 0) {
    throw new Error('已采用正文为空，无法写入 Memory。');
  }
  const sourceHash = await sourceHashOf(draft);
  const chunks: MemoryChunkInput[] = [];
  for (const [ordinal, text] of pieces.entries()) {
    chunks.push({
      id: 'chk-' + draft.id + '-' + String(ordinal),
      ordinal,
      text,
      tokenCount: Math.max(1, countTextWords(text) || Array.from(text).length),
      importance: 0.85,
      entityKeys: [],
      metadata: { source: 'adopted_draft' },
      contentHash: asSha256(await computeContentSha256(text)),
    });
  }
  return {
    documentId: ('mem-adopted-' + draft.id).slice(0, 200),
    novelId: draft.novelId,
    sourceType: 'adopted_draft',
    sourceId: draft.id,
    sourceVersion: draft.versionNo,
    sourceHash,
    adoptedDraftId: draft.id,
    chapterId: draft.chapterId,
    metadata: { title: draft.title ?? '', versionNo: draft.versionNo },
    chunks,
  };
}

function readLocal(): LocalMemoryDocument[] {
  return lsGet<LocalMemoryDocument[]>(LOCAL_KEY) ?? [];
}

export function putLocalMemoryDocument(input: PutMemoryDocumentInput): void {
  const next = readLocal().filter((item) => item.input.documentId !== input.documentId);
  next.unshift({ input, updatedAt: new Date().toISOString() });
  lsSet(LOCAL_KEY, next.slice(0, 200));
}

export function retrieveLocalMemory(novelId: string, query: string, topK = 8): RetrieveMemoryOutput {
  const needle = query.trim();
  const items = readLocal()
    .filter((item) => item.input.novelId === novelId)
    .flatMap((item) =>
      item.input.chunks
        .filter((chunk) => !needle || chunk.text.includes(needle))
        .map((chunk) => ({
          chunkId: chunk.id,
          documentId: item.input.documentId,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          contentHash: chunk.contentHash,
          sourceType: item.input.sourceType,
          sourceId: item.input.sourceId,
          sourceVersion: item.input.sourceVersion,
          sourceHash: item.input.sourceHash,
          adoptedDraftId: item.input.adoptedDraftId,
          chapterId: item.input.chapterId,
          chapterOrderIndex: chunk.chapterOrderIndex,
          entityKeys: chunk.entityKeys ?? [],
          metadata: chunk.metadata ?? {},
          score: {
            matchedBy: needle ? ['lexical'] : ['adopted_draft'],
            lexicalScore: needle ? 1 : 0.5,
            importanceScore: chunk.importance,
            recencyScore: 1,
            finalScore: chunk.importance,
          },
        })),
    )
    .slice(0, topK);
  return {
    requestId: generateId(),
    retrievalMode: 'lexical_structured',
    ftsAvailable: false,
    semanticCandidateCount: 0,
    candidateCount: items.length,
    usedTokens: items.reduce((sum, item) => sum + item.tokenCount, 0),
    tokenBudget: 4000,
    offset: 0,
    nextOffset: items.length,
    hasMore: false,
    items,
  };
}

export async function ingestAdoptedDraftMemory(draft: ChapterDraft): Promise<void> {
  const input = await buildAdoptedDraftMemoryInput(draft);
  if (!isTauri()) {
    putLocalMemoryDocument(input);
    return;
  }
  await memoryService.putDocument(input);
}

export async function ingestAdoptedDraftMemorySafe(draft: ChapterDraft): Promise<void> {
  try {
    await ingestAdoptedDraftMemory(draft);
  } catch (error) {
    appLogger.warn('[Memory] 采用正文写入 Memory 失败', error);
  }
}
