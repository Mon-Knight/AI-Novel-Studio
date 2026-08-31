import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - 统一上下文读取服务
 * v1.7.15: 按任务类型分层读取上下文，过滤 expired/disabled
 */
import {
  contextRecordPromptContent,
  contextRecordService,
  buildContextSummary,
  isContextCompressionRecord,
} from '../context/contextRecordService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { dbCall, getDbMode } from '../database/db';
import type { ContextRecord } from '../../types/context';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import {
  buildPersistedWorldStateTimeline,
  type PersistedWorldStateTimeline,
} from '../context/worldStateTimeline';

/** 任务层级 */
export type TaskLevel = 'chapter' | 'volume' | 'book';

/** 上下文读取结果 */
export interface ContextReadResult {
  chapterContexts: ContextRecord[];
  volumeContexts: ContextRecord[];
  manualContexts: ContextRecord[];
  /** 章节上下文（原始 ChapterSummary） */
  chapterSummaries: ChapterSummary[];
  /** 由已持久化章节总结和 ContextRecord 投影出的目标章前世界状态。 */
  worldStateTimeline?: PersistedWorldStateTimeline;
  warnings: string[];
}

/** 上下文读取日志（内存存储） */
export interface ContextReadLog {
  id: string;
  novelId: string;
  taskType: string;
  chapterId?: string;
  volumeId?: string;
  usedContextIds: string[];
  skippedContextIds: string[];
  warnings: string[];
  createdAt: string;
}

// 内存日志（最多保留 50 条）
const readLogs: ContextReadLog[] = [];

function logId(): string {
  return 'crl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function addLog(log: ContextReadLog): void {
  readLogs.unshift(log);
  if (readLogs.length > 50) readLogs.length = 50;
  // v1.7.17 持久化到 SQLite
  if (getDbMode() !== 'tauri') return;
  dbCall('save_context_read_log', {
    input: {
      id: log.id,
      novelId: log.novelId,
      taskType: log.taskType,
      chapterId: log.chapterId || null,
      volumeId: log.volumeId || null,
      usedContextIds: JSON.stringify(log.usedContextIds),
      skippedContextIds: JSON.stringify(log.skippedContextIds),
      warnings: JSON.stringify(log.warnings),
    },
  }).catch((error) => {
    appLogger.warn('[ContextReader] failed to persist context read log', { error });
  });
}

/** 获取最近的上下文读取日志 */
export function getRecentContextReadLogs(limit = 20): ContextReadLog[] {
  return readLogs.slice(0, limit);
}

function orderChaptersForContinuity(chapters: Chapter[], volumes: Volume[]): Chapter[] {
  const volumeOrder = new Map(volumes.map((volume) => [volume.id, volume.orderIndex]));
  return [...chapters].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
      left.orderIndex - right.orderIndex ||
      left.chapterNumber - right.chapterNumber ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function selectManualContexts(
  records: ContextRecord[],
  isEligible: (record: ContextRecord) => boolean,
  limit: number,
): ContextRecord[] {
  const eligible = records.filter(
    (record) =>
      record.isActive &&
      !record.isExpired &&
      record.contextType !== 'chapter_summary' &&
      record.contextType !== 'volume_summary' &&
      isEligible(record),
  );
  const compression = eligible
    .filter(isContextCompressionRecord)
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )[0];
  if (!compression) return eligible.slice(0, limit);

  const deltas = eligible.filter(
    (record) =>
      !isContextCompressionRecord(record) &&
      record.updatedAt.localeCompare(compression.createdAt) > 0,
  );
  return [compression, ...deltas].slice(0, limit);
}

/**
 * 为章节级任务读取上下文。
 * 读取顺序：紧邻前章上下文 → 前一卷上下文 → 手动上下文。
 * 章节绑定上下文必须严格早于目标章节，避免重写时读到当前章或未来章事实。
 */
export async function getContextForChapterTask(params: {
  novelId: string;
  chapterId: string;
  volumeId?: string;
  taskType: string;
}): Promise<ContextReadResult> {
  const { novelId, chapterId, volumeId, taskType } = params;
  const warnings: string[] = [];
  const usedIds: string[] = [];
  const skippedIds: string[] = [];

  const [allChapters, allVolumes, allRecords, allSummaries] = await Promise.all([
    chapterRepository.getByNovelId(novelId),
    volumeRepository.getByNovelId(novelId),
    contextRecordService.getByNovelId(novelId),
    chapterSummaryService.getByNovelId(novelId),
  ]);
  const orderedChapters = orderChaptersForContinuity(allChapters, allVolumes);
  const currentChapterIndex = orderedChapters.findIndex((chapter) => chapter.id === chapterId);
  const currentChapter =
    currentChapterIndex >= 0 ? orderedChapters[currentChapterIndex] : undefined;
  const previousChapter =
    currentChapterIndex > 0 ? orderedChapters[currentChapterIndex - 1] : undefined;
  const resolvedVolumeId = currentChapter?.volumeId || volumeId;
  const orderedVolumes = [...allVolumes].sort(
    (left, right) =>
      left.orderIndex - right.orderIndex ||
      left.volumeNumber - right.volumeNumber ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const currentVolumeIndex = currentChapter
    ? orderedVolumes.findIndex((volume) => volume.id === resolvedVolumeId)
    : -1;
  const previousVolume =
    currentVolumeIndex > 0 ? orderedVolumes[currentVolumeIndex - 1] : undefined;
  const strictlyPreviousChapterIds = new Set(
    currentChapterIndex > 0
      ? orderedChapters.slice(0, currentChapterIndex).map((chapter) => chapter.id)
      : [],
  );

  // 1. 只投影全书时间线上的紧邻前章；当前章及后续章节永不进入模型上下文。
  const chapterSummaries: ChapterSummary[] = [];
  if (previousChapter) {
    const previousSummary = allSummaries.find(
      (summary) => summary.chapterId === previousChapter.id,
    );
    if (previousSummary) {
      if (previousSummary.novelId !== novelId || previousSummary.chapterId !== previousChapter.id) {
        warnings.push('紧邻前章上下文归属不一致，未纳入本次 AI 任务。');
        skippedIds.push(previousSummary.id);
      } else if (previousSummary.enabled && !previousSummary.isExpired) {
        chapterSummaries.push(previousSummary);
        usedIds.push(previousSummary.id);
      } else {
        warnings.push(
          `紧邻前章上下文${previousSummary.isExpired ? '已过期' : '已停用'}，未纳入本次 AI 任务。`,
        );
        skippedIds.push(previousSummary.id);
      }
    }
  }

  if (!currentChapter) {
    warnings.push('目标章节不在当前作品时间线中，未读取任何章节绑定上下文。');
  }

  // 2. 只读取前一卷总结；当前卷总结可能包含目标章之后的事实。
  const volumeContexts: ContextRecord[] = [];
  if (previousVolume) {
    const volRecords = allRecords.filter(
      (record) =>
        record.contextType === 'volume_summary' &&
        record.volumeId === previousVolume.id &&
        record.isActive &&
        !record.isExpired,
    );
    for (const record of volRecords) {
      volumeContexts.push(record);
      usedIds.push(record.id);
    }
    if (volRecords.length === 0) {
      warnings.push('前一卷上下文不存在或不可用，已降级使用章节上下文。');
    }
  }

  // 3. 手动上下文；有章节归属的记录同样不得来自当前章或未来章。
  const chapterContexts: ContextRecord[] = chapterSummaries.map((summary) => {
    const sourceChapter = allChapters.find((chapter) => chapter.id === summary.chapterId);
    return {
      id: summary.id,
      novelId: summary.novelId,
      chapterId: summary.chapterId,
      volumeId: summary.volumeId,
      contextType: 'chapter_summary' as const,
      title: `第${sourceChapter?.chapterNumber || '?'}章上下文（紧邻前章）`,
      content: summary.summary,
      importance: 4,
      isActive: summary.enabled,
      isExpired: summary.isExpired,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    };
  });

  const manualContexts = selectManualContexts(
    allRecords,
    (record) => !record.chapterId || strictlyPreviousChapterIds.has(record.chapterId),
    10,
  );
  for (const record of manualContexts) usedIds.push(record.id);

  // 去重：移除已在 chapterContexts 中出现的
  const dedupedManual = manualContexts.filter(
    (manualContext) =>
      !chapterContexts.some((chapterContext) => chapterContext.id === manualContext.id),
  );

  const worldStateTimeline = currentChapter
    ? buildPersistedWorldStateTimeline({
        orderedChapters,
        volumes: allVolumes,
        targetChapterId: currentChapter.id,
        summaries: allSummaries,
        contextRecords: allRecords,
      })
    : undefined;
  for (const sourceId of [
    ...(worldStateTimeline?.sourceSummaryIds ?? []),
    ...(worldStateTimeline?.sourceContextRecordIds ?? []),
  ]) {
    if (!usedIds.includes(sourceId)) usedIds.push(sourceId);
  }

  // 记录日志
  addLog({
    id: logId(),
    novelId,
    taskType,
    chapterId,
    volumeId: resolvedVolumeId,
    usedContextIds: usedIds,
    skippedContextIds: skippedIds,
    warnings,
    createdAt: new Date().toISOString(),
  });

  return {
    chapterContexts,
    volumeContexts,
    manualContexts: dedupedManual,
    chapterSummaries,
    worldStateTimeline,
    warnings,
  };
}

/**
 * 为卷级任务读取上下文。
 * 读取顺序：卷下所有章节上下文 → 当前卷上下文 → 前一卷上下文 → 手动上下文
 */
export async function getContextForVolumeTask(params: {
  novelId: string;
  volumeId: string;
  taskType: string;
}): Promise<ContextReadResult> {
  const { novelId, volumeId, taskType } = params;
  const warnings: string[] = [];
  const usedIds: string[] = [];

  // 1. 卷下所有章节上下文
  const allChapters = await chapterRepository.getByNovelId(novelId);
  const volChapters = allChapters.filter((c) => c.volumeId === volumeId);
  const chapterSummaries: ChapterSummary[] = [];
  for (const ch of volChapters) {
    const s = await chapterSummaryService.getByChapterId(ch.id);
    if (s && s.enabled && !s.isExpired) chapterSummaries.push(s);
  }

  const chapterContexts: ContextRecord[] = chapterSummaries.map((s) => ({
    id: s.id,
    novelId: s.novelId,
    chapterId: s.chapterId,
    volumeId,
    contextType: 'chapter_summary' as const,
    title: '章节上下文',
    content: s.summary,
    importance: 4,
    isActive: s.enabled,
    isExpired: s.isExpired,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  // 2. 当前卷上下文
  const allRecords = await contextRecordService.getByNovelId(novelId);
  const volumeContexts = allRecords.filter(
    (r) =>
      r.contextType === 'volume_summary' && r.volumeId === volumeId && r.isActive && !r.isExpired,
  );
  for (const vr of volumeContexts) usedIds.push(vr.id);

  // 3. 前一卷上下文
  const currentVol = (await volumeRepository.getByNovelId(novelId)).find((v) => v.id === volumeId);
  if (currentVol) {
    const allVolumes = await volumeRepository.getByNovelId(novelId);
    const prevVol = allVolumes.find((v) => v.orderIndex === currentVol.orderIndex - 1);
    if (prevVol) {
      const prevRecords = allRecords.filter(
        (r) =>
          r.contextType === 'volume_summary' &&
          r.volumeId === prevVol.id &&
          r.isActive &&
          !r.isExpired,
      );
      for (const pr of prevRecords) {
        volumeContexts.push(pr);
        usedIds.push(pr.id);
      }
    }
  }

  // 4. 手动上下文
  const manualContexts = selectManualContexts(allRecords, () => true, 10);

  addLog({
    id: logId(),
    novelId,
    taskType,
    volumeId,
    usedContextIds: usedIds,
    skippedContextIds: [],
    warnings,
    createdAt: new Date().toISOString(),
  });

  return { chapterContexts, volumeContexts, manualContexts, chapterSummaries, warnings };
}

/**
 * 为全书级任务读取上下文。
 * 读取顺序：所有启用卷上下文 → 重要手动上下文
 */
export async function getContextForBookTask(params: {
  novelId: string;
  taskType: string;
}): Promise<ContextReadResult> {
  const { novelId, taskType } = params;
  const warnings: string[] = [];

  const allRecords = await contextRecordService.getByNovelId(novelId);

  // 1. 所有启用卷上下文
  const volumeContexts = allRecords.filter(
    (r) => r.contextType === 'volume_summary' && r.isActive && !r.isExpired,
  );

  // 2. 重要手动上下文（importance >= 4）
  const manualContexts = selectManualContexts(allRecords, (record) => record.importance >= 4, 15);

  if (volumeContexts.length === 0 && manualContexts.length === 0) {
    warnings.push('无可用卷上下文或手动上下文。');
  }

  addLog({
    id: logId(),
    novelId,
    taskType,
    usedContextIds: [...volumeContexts.map((v) => v.id), ...manualContexts.map((m) => m.id)],
    skippedContextIds: [],
    warnings,
    createdAt: new Date().toISOString(),
  });

  return { chapterContexts: [], volumeContexts, manualContexts, chapterSummaries: [], warnings };
}

/**
 * 将上下文读取结果构建为 Prompt 可用的分区文本
 */
export function buildContextPromptSection(result: ContextReadResult): string {
  const sections: string[] = [];

  if (result.chapterSummaries.length > 0) {
    const texts = result.chapterSummaries.map(
      (s, i) =>
        `### 章节上下文 ${i + 1}\n${s.summary}\n` +
        (s.keyEvents?.length ? `关键事件：${s.keyEvents.join('；')}\n` : '') +
        (s.protagonistStateChange ? `主角变化：${s.protagonistStateChange}\n` : '') +
        (s.factsMustRemember?.length ? `关键事实：${s.factsMustRemember.join('；')}\n` : ''),
    );
    sections.push('【章节上下文】\n' + texts.join('\n---\n'));
  }

  if (result.volumeContexts.length > 0) {
    const texts = result.volumeContexts.map((v) => `### ${v.title}\n${v.content.slice(0, 800)}`);
    sections.push('【卷上下文】\n' + texts.join('\n---\n'));
  }

  if (result.manualContexts.length > 0) {
    const compressed = result.manualContexts.filter(isContextCompressionRecord);
    const manual = result.manualContexts.filter((record) => !isContextCompressionRecord(record));
    if (compressed.length > 0) {
      sections.push(
        '【小说压缩上下文】\n' +
          compressed
            .map((record) => contextRecordPromptContent(record))
            .filter(Boolean)
            .join('\n---\n'),
      );
    }
    if (manual.length > 0) {
      sections.push('【压缩后增量上下文】\n' + buildContextSummary(manual, 1200));
    }
  }

  if (result.warnings.length > 0) {
    sections.push('【上下文读取警告】\n' + result.warnings.map((w) => `- ${w}`).join('\n'));
  }

  sections.push(
    '【注意】\n' +
      '- 以上上下文用于保持故事连续性，不得新增与上下文冲突的事实。\n' +
      '- 如上下文与正文或已确认设定冲突，以正文和已确认设定为准。\n' +
      '- 上下文中的推测不应被当作正文事实。',
  );

  return sections.join('\n\n');
}
