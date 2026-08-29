import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type {
  MemoryChunkInput,
  MemoryRetrievalFilters,
  PutMemoryDocumentInput,
  RetrieveMemoryOutput,
} from '../../types/memory';
import type { Volume } from '../../types/volume';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { countTextWords } from '../../utils/contentHash';
import { chapterRepository } from '../database/chapterRepository';
import { generateId, isTauri, lsGet, lsSet } from '../database/db';
import { volumeRepository } from '../database/volumeRepository';
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

function compareChapters(left: Chapter, right: Chapter): number {
  return (
    left.orderIndex - right.orderIndex ||
    left.sortOrder - right.sortOrder ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/** Resolves a stable novel-wide chapter position, including volume order. */
export function resolveChapterSequenceIndex(
  chapters: readonly Chapter[],
  volumes: readonly Volume[],
  chapterId: string,
): number | undefined {
  const volumeOrder = new Map(
    [...volumes]
      .sort(
        (left, right) =>
          left.orderIndex - right.orderIndex ||
          left.sortOrder - right.sortOrder ||
          left.id.localeCompare(right.id),
      )
      .map((volume, index) => [volume.id, index]),
  );
  const ordered = [...chapters].sort((left, right) => {
    const leftVolume = left.volumeId
      ? (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER)
      : -1;
    const rightVolume = right.volumeId
      ? (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER)
      : -1;
    return leftVolume - rightVolume || compareChapters(left, right);
  });
  const index = ordered.findIndex((chapter) => chapter.id === chapterId);
  return index >= 0 ? index : undefined;
}

async function loadChapterSequenceIndex(draft: ChapterDraft): Promise<number | undefined> {
  const [chapters, volumes] = await Promise.all([
    chapterRepository.getByNovelId(draft.novelId),
    volumeRepository.getByNovelId(draft.novelId),
  ]);
  return resolveChapterSequenceIndex(chapters, volumes, draft.chapterId);
}

export async function buildAdoptedDraftMemoryInput(
  draft: ChapterDraft,
  chapterSequenceIndex?: number,
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
      chapterOrderIndex: chapterSequenceIndex,
      temporalStartChapter: chapterSequenceIndex,
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

export function retrieveLocalMemory(
  novelId: string,
  query: string,
  topK = 8,
  filters: MemoryRetrievalFilters = {},
): RetrieveMemoryOutput {
  const needle = query.trim();
  const items = readLocal()
    .filter((item) => item.input.novelId === novelId)
    .flatMap((item) =>
      item.input.chunks
        .filter((chunk) => {
          if (needle && !chunk.text.includes(needle)) return false;
          if (filters.sourceTypes?.length && !filters.sourceTypes.includes(item.input.sourceType)) {
            return false;
          }
          if (filters.chapterId && item.input.chapterId !== filters.chapterId) return false;
          if (
            filters.chapterStart !== undefined &&
            (chunk.chapterOrderIndex === undefined ||
              chunk.chapterOrderIndex < filters.chapterStart)
          ) {
            return false;
          }
          if (
            filters.chapterEnd !== undefined &&
            (chunk.chapterOrderIndex === undefined || chunk.chapterOrderIndex > filters.chapterEnd)
          ) {
            return false;
          }
          if (
            filters.temporalChapter !== undefined &&
            ((chunk.temporalStartChapter !== undefined &&
              filters.temporalChapter < chunk.temporalStartChapter) ||
              (chunk.temporalEndChapter !== undefined &&
                filters.temporalChapter > chunk.temporalEndChapter))
          ) {
            return false;
          }
          return true;
        })
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
  const chapterSequenceIndex = await loadChapterSequenceIndex(draft);
  const input = await buildAdoptedDraftMemoryInput(draft, chapterSequenceIndex);
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
