/**
 * AI Novel Studio - AI chapter context summarization.
 */
import type {
  ChapterSummarizeResult,
  SummarizeAdoptedChapterInput,
} from '../../types/chapterSummary';
import type { AiGenerateOptions, AiGenerateRequest, AiGenerateResponse } from '../../types/ai';
import { createAiClient, aiSettingsService } from './aiClient';
import { aiTaskService } from './aiTaskService';
import { buildChapterSummarizePrompt, buildChapterSummarizeReducePrompt } from './promptBuilder';
import { safeJsonParse } from './jsonUtils';
import { novelRepository } from '../database/novelRepository';
import { normalizeChapterSummarizeResult } from './chapterSummarizeNormalizer';
import { splitChapterText } from './chapterTextSegmentation';
import { throwIfAiRequestCancelled } from './aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from './aiTaskCancellation';

export const CHAPTER_SUMMARY_REDUCE_MAX_CHARS = 24_000;

interface SummaryRange {
  startSegment: number;
  endSegment: number;
  result: ChapterSummarizeResult;
}

export interface ChapterSummarizeGenerationInput {
  novelTitle?: string;
  chapterTitle: string;
  chapterOutline?: string;
  adoptedContent: string;
  chapterCharacters?: string;
  chapterEvents?: string;
}

export interface ChapterSummarizeGeneration {
  result: ChapterSummarizeResult;
  requestCount: number;
  sourceSegmentCount: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
}

type SummaryGenerator = (request: AiGenerateRequest) => Promise<AiGenerateResponse>;

function parseSummaryResponse(text: string): ChapterSummarizeResult {
  const parsed = safeJsonParse<Partial<ChapterSummarizeResult>>(text, {});
  return normalizeChapterSummarizeResult(parsed, text);
}

function summaryRangePayload(range: SummaryRange): Record<string, unknown> {
  return {
    sourceSegmentRange: [range.startSegment + 1, range.endSegment + 1],
    summary: range.result,
  };
}

function groupSummaryRanges(ranges: SummaryRange[]): SummaryRange[][] {
  const groups: SummaryRange[][] = [];
  let current: SummaryRange[] = [];
  let currentChars = 0;

  for (const range of ranges) {
    const rangeChars = JSON.stringify(summaryRangePayload(range)).length;
    if (current.length > 0 && currentChars + rangeChars > CHAPTER_SUMMARY_REDUCE_MAX_CHARS) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(range);
    currentChars += rangeChars;
  }
  if (current.length > 0) groups.push(current);

  // Provider output is bounded, so this is only a defensive path for an anomalously
  // large partial result. Pairing guarantees that every reduction pass progresses.
  if (ranges.length > 1 && groups.length === ranges.length) {
    return Array.from({ length: Math.ceil(ranges.length / 2) }, (_, index) =>
      ranges.slice(index * 2, index * 2 + 2),
    );
  }
  return groups;
}

function assertCompleteSummaryCoverage(ranges: SummaryRange[], segmentCount: number): void {
  let expectedStart = 0;
  for (const range of ranges) {
    if (range.startSegment !== expectedStart || range.endSegment < range.startSegment) {
      throw new Error('章节总结分段归并范围不连续。');
    }
    expectedStart = range.endSegment + 1;
  }
  if (expectedStart !== segmentCount) {
    throw new Error('章节总结分段未完整覆盖原文。');
  }
}

/**
 * 对完整章节执行 map-reduce 总结。每个连续正文分段都会先独立提取事实，
 * 再以有界分组逐层归并，避免通过固定字符切片丢失章节后半部分。
 */
export async function summarizeChapterContentInSegments(
  input: ChapterSummarizeGenerationInput,
  generate: SummaryGenerator,
): Promise<ChapterSummarizeGeneration> {
  const segments = splitChapterText(input.adoptedContent);
  if (segments.length === 0) throw new Error('章节总结正文为空。');

  let requestCount = 0;
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenTotal = 0;
  const addUsage = (response: AiGenerateResponse) => {
    tokenInput += response.tokenInput ?? 0;
    tokenOutput += response.tokenOutput ?? 0;
    tokenTotal += response.tokenTotal ?? (response.tokenInput ?? 0) + (response.tokenOutput ?? 0);
  };

  let ranges: SummaryRange[] = [];
  for (const segment of segments) {
    const request = buildChapterSummarizePrompt({
      ...input,
      adoptedContent: segment.text,
      segment:
        segments.length > 1
          ? {
              index: segment.index,
              total: segment.total,
              previousContext: segment.previousContext,
              nextContext: segment.nextContext,
            }
          : undefined,
    });
    const response = await generate(request);
    requestCount += 1;
    addUsage(response);
    ranges.push({
      startSegment: segment.index,
      endSegment: segment.index,
      result: parseSummaryResponse(response.text),
    });
  }
  assertCompleteSummaryCoverage(ranges, segments.length);

  let reductionPass = 0;
  while (ranges.length > 1) {
    reductionPass += 1;
    const groups = groupSummaryRanges(ranges);
    const nextRanges: SummaryRange[] = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (group.length === 1) {
        nextRanges.push(group[0]);
        continue;
      }
      const request = buildChapterSummarizeReducePrompt({
        novelTitle: input.novelTitle,
        chapterTitle: input.chapterTitle,
        chapterOutline: input.chapterOutline,
        sourceSegmentCount: segments.length,
        reductionPass,
        groupIndex,
        groupTotal: groups.length,
        partialSummaries: group.map(summaryRangePayload),
      });
      const response = await generate(request);
      requestCount += 1;
      addUsage(response);
      nextRanges.push({
        startSegment: group[0].startSegment,
        endSegment: group[group.length - 1].endSegment,
        result: parseSummaryResponse(response.text),
      });
    }
    if (nextRanges.length >= ranges.length) {
      throw new Error('章节总结分层归并未能收敛。');
    }
    assertCompleteSummaryCoverage(nextRanges, segments.length);
    ranges = nextRanges;
  }

  return {
    result: ranges[0].result,
    requestCount,
    sourceSegmentCount: segments.length,
    tokenInput,
    tokenOutput,
    tokenTotal,
  };
}

export const chapterSummarizeService = {
  async summarize(
    input: SummarizeAdoptedChapterInput,
    options: AiGenerateOptions = {},
  ): Promise<ChapterSummarizeResult> {
    const settings = aiSettingsService.getSettings();
    const novel = await novelRepository.getById(input.novelId).catch(() => null);

    const task = await aiTaskService
      .create('context_summarize', {
        novelId: input.novelId,
        chapterId: input.chapterId,
        runtimeMode: settings.runtimeMode,
        provider: settings.provider,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        inputSummary: `总结章节「${input.chapterTitle}」`,
      })
      .catch(() => null);
    const releaseCancellation = bindAiTaskCancellation(task?.id, options);

    try {
      const client = createAiClient(settings);
      const generation = await summarizeChapterContentInSegments(
        {
          novelTitle: novel?.title,
          chapterTitle: input.chapterTitle,
          chapterOutline: input.chapterOutline,
          adoptedContent: input.adoptedContent,
          chapterCharacters: input.chapterCharacters,
          chapterEvents: input.chapterEvents,
        },
        (request) => {
          throwIfAiRequestCancelled(options.signal);
          return client.generate(request, options);
        },
      );
      throwIfAiRequestCancelled(options.signal);

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: generation.result.summary,
        tokenInput: generation.tokenInput,
        tokenOutput: generation.tokenOutput,
        tokenTotal: generation.tokenTotal,
      });

      return generation.result;
    } catch (e: unknown) {
      await settleAiTaskError({
        taskId: task?.id,
        error: e,
        signal: options.signal,
        fallbackMessage: '章节总结失败',
      });
      throw e;
    } finally {
      releaseCancellation();
    }
  },
};
