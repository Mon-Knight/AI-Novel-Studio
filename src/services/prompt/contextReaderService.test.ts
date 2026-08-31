import assert from 'node:assert/strict';
import test from 'node:test';

import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { ContextRecord } from '../../types/context';
import type { Volume } from '../../types/volume';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { contextRecordService } from '../context/contextRecordService';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { buildContextPromptSection, getContextForChapterTask } from './contextReaderService';

const NOVEL_ID = 'novel-timeline';
const CREATED_AT = '2026-08-28T00:00:00.000Z';

function chapter(input: {
  id: string;
  volumeId: string;
  chapterNumber: number;
  orderIndex: number;
}): Chapter {
  return {
    ...input,
    novelId: NOVEL_ID,
    title: input.id,
    outline: '',
    goal: '',
    sortOrder: input.orderIndex,
    status: 'summarized',
    wordCount: 0,
    currentWords: 0,
    targetWords: 0,
    drafts: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function volume(id: string, orderIndex: number): Volume {
  return {
    id,
    novelId: NOVEL_ID,
    title: id,
    orderIndex,
    volumeNumber: orderIndex + 1,
    sortOrder: orderIndex,
    status: 'writing',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function summary(chapterId: string, text: string): ChapterSummary {
  return {
    id: `summary-${chapterId}`,
    novelId: NOVEL_ID,
    chapterId,
    adoptedDraftId: `draft-${chapterId}`,
    summary: text,
    enabled: true,
    isExpired: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function contextRecord(id: string, content: string, chapterId?: string): ContextRecord {
  return {
    id,
    novelId: NOVEL_ID,
    chapterId,
    contextType: 'plot_progress',
    title: id,
    content,
    importance: 4,
    isActive: true,
    isExpired: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function volumeSummaryRecord(id: string, content: string, volumeId: string): ContextRecord {
  return {
    ...contextRecord(id, content),
    volumeId,
    contextType: 'volume_summary',
  };
}

async function withReaderData(
  input: {
    chapters: Chapter[];
    volumes: Volume[];
    summaries: Record<string, ChapterSummary>;
    records?: ContextRecord[];
    summaryReads: string[];
  },
  run: () => Promise<void>,
): Promise<void> {
  const originalGetChapters = chapterRepository.getByNovelId;
  const originalGetVolumes = volumeRepository.getByNovelId;
  const originalGetSummary = chapterSummaryService.getByChapterId;
  const originalGetSummaries = chapterSummaryService.getByNovelId;
  const originalGetRecords = contextRecordService.getByNovelId;

  chapterRepository.getByNovelId = async () => input.chapters;
  volumeRepository.getByNovelId = async () => input.volumes;
  chapterSummaryService.getByChapterId = async (chapterId) => {
    input.summaryReads.push(chapterId);
    return input.summaries[chapterId] ?? null;
  };
  chapterSummaryService.getByNovelId = async () => {
    input.summaryReads.push(`novel:${NOVEL_ID}`);
    return Object.values(input.summaries);
  };
  contextRecordService.getByNovelId = async () => input.records ?? [];

  try {
    await run();
  } finally {
    chapterRepository.getByNovelId = originalGetChapters;
    volumeRepository.getByNovelId = originalGetVolumes;
    chapterSummaryService.getByChapterId = originalGetSummary;
    chapterSummaryService.getByNovelId = originalGetSummaries;
    contextRecordService.getByNovelId = originalGetRecords;
  }
}

test('chapter context injects only prior persisted summaries across a volume boundary', async () => {
  const oldest = chapter({
    id: 'chapter-1',
    volumeId: 'volume-1',
    chapterNumber: 1,
    orderIndex: 0,
  });
  const previous = chapter({
    id: 'chapter-2',
    volumeId: 'volume-1',
    chapterNumber: 2,
    orderIndex: 1,
  });
  const current = chapter({
    id: 'chapter-3',
    volumeId: 'volume-2',
    chapterNumber: 1,
    orderIndex: 0,
  });
  const future = chapter({
    id: 'chapter-4',
    volumeId: 'volume-2',
    chapterNumber: 2,
    orderIndex: 1,
  });
  const summaryReads: string[] = [];

  await withReaderData(
    {
      chapters: [current, future, oldest, previous],
      volumes: [volume('volume-2', 1), volume('volume-1', 0)],
      summaries: {
        [oldest.id]: summary(oldest.id, '更早章节摘要'),
        [previous.id]: summary(previous.id, '唯一允许的紧邻前章摘要'),
        [current.id]: summary(current.id, '不得注入的当前章摘要'),
        [future.id]: summary(future.id, '不得注入的未来章摘要'),
      },
      records: [
        contextRecord('record-oldest', '允许的更早章节记录', oldest.id),
        contextRecord('record-previous', '允许的前章记录', previous.id),
        contextRecord('record-current', '不得注入的当前章记录', current.id),
        contextRecord('record-future', '不得注入的未来章记录', future.id),
        contextRecord('record-global', '允许的全局手动上下文'),
        volumeSummaryRecord('volume-summary-previous', '允许的前一卷总结', 'volume-1'),
        volumeSummaryRecord('volume-summary-current', '不得注入的当前卷总结', 'volume-2'),
      ],
      summaryReads,
    },
    async () => {
      const result = await getContextForChapterTask({
        novelId: NOVEL_ID,
        chapterId: current.id,
        volumeId: current.volumeId,
        taskType: 'chapter_generate',
      });

      assert.deepEqual(summaryReads, [`novel:${NOVEL_ID}`]);
      assert.deepEqual(
        result.chapterSummaries.map((item) => item.chapterId),
        [previous.id],
      );
      assert.equal(result.chapterContexts[0]?.title, '第2章上下文（紧邻前章）');
      assert.deepEqual(
        result.volumeContexts.map((item) => item.id),
        ['volume-summary-previous'],
      );
      assert.deepEqual(
        result.manualContexts.map((item) => item.id),
        ['record-oldest', 'record-previous', 'record-global'],
      );
      assert.ok(result.worldStateTimeline);
      assert.match(result.worldStateTimeline.content, /更早章节摘要/);
      assert.match(result.worldStateTimeline.content, /唯一允许的紧邻前章摘要/);
      assert.doesNotMatch(
        result.worldStateTimeline.content,
        /不得注入的当前章摘要|不得注入的未来章摘要/,
      );
      assert.doesNotMatch(
        result.worldStateTimeline.content,
        /不得注入的当前章记录|不得注入的未来章记录/,
      );

      const prompt = buildContextPromptSection(result);
      assert.match(prompt, /唯一允许的紧邻前章摘要/);
      assert.doesNotMatch(prompt, /不得注入的当前章摘要|不得注入的未来章摘要/);
      assert.doesNotMatch(prompt, /不得注入的当前章记录|不得注入的未来章记录/);
      assert.match(prompt, /允许的前一卷总结/);
      assert.doesNotMatch(prompt, /不得注入的当前卷总结/);
    },
  );
});

test('the first chapter reads no chapter-bound summary or derived context', async () => {
  const current = chapter({
    id: 'chapter-1',
    volumeId: 'volume-1',
    chapterNumber: 1,
    orderIndex: 0,
  });
  const future = chapter({
    id: 'chapter-2',
    volumeId: 'volume-1',
    chapterNumber: 2,
    orderIndex: 1,
  });
  const summaryReads: string[] = [];

  await withReaderData(
    {
      chapters: [future, current],
      volumes: [volume('volume-1', 0)],
      summaries: {
        [current.id]: summary(current.id, '不得回灌的首章既有摘要'),
        [future.id]: summary(future.id, '不得前泄的第二章摘要'),
      },
      records: [
        contextRecord('record-current', '不得回灌的首章记录', current.id),
        contextRecord('record-future', '不得前泄的第二章记录', future.id),
        contextRecord('record-global', '仍可使用的全局手动上下文'),
        volumeSummaryRecord('volume-summary-current', '不得回灌的当前卷总结', 'volume-1'),
      ],
      summaryReads,
    },
    async () => {
      const result = await getContextForChapterTask({
        novelId: NOVEL_ID,
        chapterId: current.id,
        volumeId: current.volumeId,
        taskType: 'chapter_rewrite',
      });

      assert.deepEqual(summaryReads, [`novel:${NOVEL_ID}`]);
      assert.deepEqual(result.chapterSummaries, []);
      assert.equal(result.worldStateTimeline, undefined);
      assert.deepEqual(result.chapterContexts, []);
      assert.deepEqual(result.volumeContexts, []);
      assert.deepEqual(
        result.manualContexts.map((item) => item.id),
        ['record-global'],
      );

      const prompt = buildContextPromptSection(result);
      assert.doesNotMatch(prompt, /不得回灌|不得前泄/);
      assert.match(prompt, /仍可使用的全局手动上下文/);
    },
  );
});

test('chapter prompt consumes full compressedText, keeps later deltas and preserves continuity layers', async () => {
  const previous = chapter({
    id: 'chapter-1',
    volumeId: 'volume-1',
    chapterNumber: 1,
    orderIndex: 0,
  });
  const current = chapter({
    id: 'chapter-2',
    volumeId: 'volume-2',
    chapterNumber: 1,
    orderIndex: 0,
  });
  const compressedText = `压缩正文开始${'甲'.repeat(360)}压缩正文结尾`;
  const legacyCompression: ContextRecord = {
    ...contextRecord('compression', ''),
    title: '小说上下文压缩 1.0.0 rev-old',
    content: JSON.stringify({
      providerId: 'ans.novel-context.extractive-v1',
      compressedText,
      coverage: { tokens: { budget: 4_000 } },
    }),
    importance: 5,
    createdAt: '2026-08-28T02:00:00.000Z',
    updatedAt: '2026-08-28T02:00:00.000Z',
  };
  const oldCoveredRecord: ContextRecord = {
    ...contextRecord('covered-old', '已被压缩覆盖的旧记录'),
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T01:00:00.000Z',
  };
  const laterDelta: ContextRecord = {
    ...contextRecord('later-delta', '压缩后新增的关键事实'),
    createdAt: '2026-08-28T03:00:00.000Z',
    updatedAt: '2026-08-28T03:00:00.000Z',
  };

  await withReaderData(
    {
      chapters: [previous, current],
      volumes: [volume('volume-1', 0), volume('volume-2', 1)],
      summaries: { [previous.id]: summary(previous.id, '紧邻前章总结仍需保留') },
      records: [
        oldCoveredRecord,
        legacyCompression,
        laterDelta,
        volumeSummaryRecord('volume-summary-previous', '前一卷总结仍需保留', 'volume-1'),
      ],
      summaryReads: [],
    },
    async () => {
      const result = await getContextForChapterTask({
        novelId: NOVEL_ID,
        chapterId: current.id,
        volumeId: current.volumeId,
        taskType: 'chapter_generate',
      });
      assert.deepEqual(
        result.manualContexts.map((record) => record.id),
        ['compression', 'later-delta'],
      );

      const prompt = buildContextPromptSection(result);
      assert.match(prompt, /压缩正文开始/);
      assert.match(prompt, /压缩正文结尾/);
      assert.match(prompt, /压缩后新增的关键事实/);
      assert.match(prompt, /紧邻前章总结仍需保留/);
      assert.match(prompt, /前一卷总结仍需保留/);
      assert.doesNotMatch(prompt, /providerId|已被压缩覆盖的旧记录/);
    },
  );
});
