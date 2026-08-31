import { readChapterContext, readChapterOutline } from '../../../agent-tools/chapter-tools';
import { readOutputControl, readStyleProfile } from '../../../agent-tools/style-tools';
import type { ToolInvocationContext } from '../../../types/toolRegistry';
import { productionToolRegistry } from '../../agent-tools/productionToolRegistry';
import { projectCapability } from './projectCapability';
import {
  failure,
  fromToolResult,
  hashPublicValue,
  mapUnknownError,
  success,
  validateChapterScope,
  validateNovelId,
  validateNonEmpty,
} from './domainResult';
import type {
  ChapterSummary,
  DomainRequest,
  DomainResult,
  MemoryHit,
  MemorySearchResult,
  StoryContextReadModel,
} from './domainTypes';
import { isRecord, positiveNumber, text, uniqueWarnings } from './domainTypes';

function mapMemoryResult(novelId: string, query: string, data: unknown): MemorySearchResult {
  if (!isRecord(data)) throw new Error('Memory 结果不是公开对象。');
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: MemoryHit[] = rawItems.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.chunkId !== 'string' ||
      typeof item.documentId !== 'string'
    ) {
      throw new Error('Memory 结果缺少稳定来源身份。');
    }
    if (typeof item.sourceType !== 'string' || typeof item.sourceId !== 'string') {
      throw new Error('Memory 结果缺少来源类型。');
    }
    if (typeof item.chapterId === 'string' && item.chapterId.length === 0) {
      throw new Error('Memory 章节来源为空。');
    }
    const score = isRecord(item.score) ? item.score : {};
    return {
      chunkId: item.chunkId,
      documentId: item.documentId,
      text: text(item.text),
      tokenCount: positiveNumber(item.tokenCount),
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceVersion: positiveNumber(item.sourceVersion),
      sourceHash: text(item.sourceHash),
      ...(typeof item.adoptedDraftId === 'string' ? { adoptedDraftId: item.adoptedDraftId } : {}),
      ...(typeof item.chapterId === 'string' ? { chapterId: item.chapterId } : {}),
      score: {
        matchedBy: Array.isArray(score.matchedBy)
          ? score.matchedBy.filter((value): value is string => typeof value === 'string')
          : [],
        finalScore: positiveNumber(score.finalScore),
      },
    };
  });
  return {
    novelId,
    query,
    retrievalMode: text(data.retrievalMode, 'structured'),
    items,
    hasMore: data.hasMore === true,
    nextOffset: positiveNumber(data.nextOffset),
  };
}

function memoryContext(
  request: DomainRequest,
  query: string,
): Promise<DomainResult<MemorySearchResult>> {
  const invocation: ToolInvocationContext = {
    invocationId: `domain-memory-${request.novelId}-${request.chapterId ?? 'novel'}`,
    novelId: request.novelId,
    chapterId: request.chapterId,
    grantedPermissions: ['novel.read', 'chapter.read'],
    allowedTools: ['search_memory@1'],
    dryRun: true,
    signal: request.signal,
  };
  return productionToolRegistry
    .invoke('search_memory', '1', { novelId: request.novelId, query }, invocation)
    .then(async (result) => {
      const mapped = fromToolResult(result, (data) =>
        mapMemoryResult(request.novelId, query, data),
      );
      if (!mapped.ok || !mapped.data) return mapped;
      return success(mapped.data, {
        source: mapped.source,
        storageMode: mapped.storageMode,
        warnings: mapped.warnings,
        revision: null,
        contentHash: await hashPublicValue(mapped.data),
      });
    })
    .catch((error) => mapUnknownError(error, 'runtime'));
}

function mapChapter(data: unknown, expected: ChapterSummary): ChapterSummary {
  if (!isRecord(data) || !isRecord(data.chapter)) return expected;
  const chapter = data.chapter;
  if (chapter.id !== expected.id || chapter.novelId !== expected.novelId) {
    throw new Error('章节上下文与当前作品/章节不一致。');
  }
  return {
    ...expected,
    title: text(chapter.title, expected.title),
    status: text(chapter.status, expected.status),
    targetWordCount: positiveNumber(chapter.targetWordCount, expected.targetWordCount),
    wordCount: positiveNumber(chapter.wordCount, expected.wordCount),
  };
}

function mapCharacters(data: unknown, novelId: string, chapterId: string) {
  if (!isRecord(data) || !Array.isArray(data.chapterCharacters)) return [];
  return data.chapterCharacters.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.characterId !== 'string') {
      throw new Error('章节角色上下文缺少稳定身份字段。');
    }
    if (
      (typeof item.novelId === 'string' && item.novelId !== novelId) ||
      (typeof item.chapterId === 'string' && item.chapterId !== chapterId)
    ) {
      throw new Error('章节角色上下文归属不一致。');
    }
    return {
      id: item.id,
      characterId: item.characterId,
      name: text(item.characterName, '未命名角色'),
      role: text(item.roleInChapter, 'supporting'),
      mustAppear: item.mustAppear === true,
    };
  });
}

function mapEvents(data: unknown, novelId: string, chapterId: string) {
  if (!isRecord(data) || !Array.isArray(data.chapterEvents)) return [];
  return data.chapterEvents.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') {
      throw new Error('章节事件上下文缺少稳定身份字段。');
    }
    if (
      (typeof item.novelId === 'string' && item.novelId !== novelId) ||
      (typeof item.chapterId === 'string' && item.chapterId !== chapterId)
    ) {
      throw new Error('章节事件上下文归属不一致。');
    }
    return {
      id: item.id,
      title: item.title,
      summary: text(item.description),
      status: text(item.status, 'candidate'),
    };
  });
}

function mapStyle(data: unknown): StoryContextReadModel['style'] {
  const value = isRecord(data) && isRecord(data.activeStyle) ? data.activeStyle : undefined;
  if (!value) return { forbiddenStyles: [] };
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.narrativePerspective === 'string'
      ? { narrativePerspective: value.narrativePerspective }
      : {}),
    ...(typeof value.tone === 'string' ? { tone: value.tone } : {}),
    ...(typeof value.pace === 'string' ? { pace: value.pace } : {}),
    forbiddenStyles: Array.isArray(value.forbiddenStyles)
      ? value.forbiddenStyles.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function mapOutput(data: unknown): StoryContextReadModel['output'] {
  const value = isRecord(data) && isRecord(data.activeProfile) ? data.activeProfile : undefined;
  if (!value) {
    return { targetWordCount: 0, minWordCount: 0, maxWordCount: 0 };
  }
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    targetWordCount: positiveNumber(value.targetWordCount),
    minWordCount: positiveNumber(value.minWordCount),
    maxWordCount: positiveNumber(value.maxWordCount),
    ...(typeof value.paceLevel === 'string' ? { paceLevel: value.paceLevel } : {}),
  };
}

export const contextCapability = {
  async searchMemory(request: DomainRequest): Promise<DomainResult<MemorySearchResult>> {
    const novelInvalid = validateNovelId(request);
    if (novelInvalid) return novelInvalid;
    const queryInvalid = validateNonEmpty(request.query, 'query');
    if (queryInvalid) return queryInvalid;
    return memoryContext(request, request.query!.trim());
  },

  async readCurrentStoryContext(
    request: DomainRequest,
  ): Promise<DomainResult<StoryContextReadModel>> {
    const invalid = validateChapterScope(request);
    if (invalid) return invalid;
    const chapterId = request.chapterId!;
    const position = await projectCapability.readChapterPosition(request);
    if (!position.ok || !position.data) {
      return failure(
        position.error?.code ?? 'UPSTREAM_FAILURE',
        position.error?.message ?? '章节定位失败。',
        position.source,
        position.storageMode,
        position.warnings,
      );
    }

    const [outlineResult, contextResult, styleResult, outputResult, memoryResult] =
      await Promise.all([
        readChapterOutline({ novelId: request.novelId, chapterId }),
        readChapterContext({ novelId: request.novelId, chapterId }),
        readStyleProfile({ novelId: request.novelId }),
        readOutputControl({ novelId: request.novelId }),
        request.query?.trim()
          ? memoryContext(request, request.query.trim())
          : Promise.resolve(undefined),
      ]);

    const outline = fromToolResult(outlineResult, (data) => data);
    const chapterContext = fromToolResult(contextResult, (data) => data);
    const style = fromToolResult(styleResult, (data) => data);
    const output = fromToolResult(outputResult, (data) => data);
    if (!outline.ok) return outline as DomainResult<StoryContextReadModel>;
    if (!chapterContext.ok) return chapterContext as DomainResult<StoryContextReadModel>;

    try {
      const data: StoryContextReadModel = {
        project: position.data.project,
        chapter: mapChapter(chapterContext.data, position.data.chapter),
        ...(position.data.volume ? { volume: position.data.volume } : {}),
        settings: position.data.settings,
        chapterCharacters: mapCharacters(chapterContext.data, request.novelId, chapterId),
        chapterEvents: mapEvents(chapterContext.data, request.novelId, chapterId),
        style: style.ok ? mapStyle(style.data) : { forbiddenStyles: [] },
        output: output.ok ? mapOutput(output.data) : mapOutput(undefined),
        ...(memoryResult?.ok && memoryResult.data ? { memory: memoryResult.data } : {}),
      };
      const warnings = uniqueWarnings(
        position.warnings,
        outline.warnings,
        chapterContext.warnings,
        style.warnings,
        output.warnings,
        memoryResult?.warnings,
        style.ok ? [] : ['风格方案暂时不可用。'],
        output.ok ? [] : ['输出控制方案暂时不可用。'],
        memoryResult && !memoryResult.ok ? ['记忆检索暂时不可用。'] : [],
      );
      return success(data, {
        source: position.source,
        storageMode: position.storageMode,
        warnings,
        revision: null,
        contentHash: await hashPublicValue(data),
      });
    } catch (error) {
      return failure(
        'INTEGRITY_ERROR',
        error instanceof Error ? error.message : String(error),
        position.source,
        position.storageMode,
      );
    }
  },
};

export type ContextCapability = typeof contextCapability;
