/**
 * AI Novel Studio - 统一上下文读取服务
 * v1.7.15: 按任务类型分层读取上下文，过滤 expired/disabled
 */
import { contextRecordService, buildContextSummary } from '../context/contextRecordService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { dbCall } from '../database/db';
import type { ContextRecord } from '../../types/context';
import type { ChapterSummary } from '../../types/chapterSummary';

/** 任务层级 */
export type TaskLevel = 'chapter' | 'volume' | 'book';

/** 上下文读取结果 */
export interface ContextReadResult {
  chapterContexts: ContextRecord[];
  volumeContexts: ContextRecord[];
  manualContexts: ContextRecord[];
  /** 章节上下文（原始 ChapterSummary） */
  chapterSummaries: ChapterSummary[];
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
  dbCall('save_context_read_log', {
    id: log.id, novelId: log.novelId, taskType: log.taskType,
    chapterId: log.chapterId || null, volumeId: log.volumeId || null,
    usedContextIds: JSON.stringify(log.usedContextIds),
    skippedContextIds: JSON.stringify(log.skippedContextIds),
    warnings: JSON.stringify(log.warnings),
  }).catch(() => {});
}

/** 获取最近的上下文读取日志 */
export function getRecentContextReadLogs(limit = 20): ContextReadLog[] {
  return readLogs.slice(0, limit);
}

/**
 * 为章节级任务读取上下文。
 * 读取顺序：当前章节上下文 → 相邻章节上下文 → 当前卷上下文 → 手动上下文
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

  // 1. 当前章节上下文
  const currentSummary = await chapterSummaryService.getByChapterId(chapterId);
  const chapterSummaries: ChapterSummary[] = [];
  if (currentSummary) {
    if (currentSummary.enabled && !currentSummary.isExpired) {
      chapterSummaries.push(currentSummary);
    } else {
      warnings.push(`当前章节上下文${currentSummary.isExpired ? '已过期' : '已停用'}，未纳入本次 AI 任务。`);
      skippedIds.push(currentSummary.id);
    }
  }

  // 2. 相邻章节上下文
  const allChapters = await chapterRepository.getByNovelId(novelId).catch(() => []);
  const currentChapter = allChapters.find((c) => c.id === chapterId);
  if (currentChapter) {
    const adjacentIds = getAdjacentChapterIds(allChapters, currentChapter.chapterNumber, volumeId);
    for (const adjId of adjacentIds) {
      const adjSummary = await chapterSummaryService.getByChapterId(adjId);
      if (adjSummary && adjSummary.enabled && !adjSummary.isExpired) {
        chapterSummaries.push(adjSummary);
      }
    }
  }

  // 3. 当前卷上下文
  const volumeContexts: ContextRecord[] = [];
  const resolvedVolumeId = volumeId || currentChapter?.volumeId;
  if (resolvedVolumeId) {
    const allRecords = await contextRecordService.getByNovelId(novelId).catch(() => []);
    const volRecords = allRecords.filter(
      (r) => r.contextType === 'volume_summary' && r.volumeId === resolvedVolumeId && r.isActive && !r.isExpired,
    );
    for (const vr of volRecords) {
      volumeContexts.push(vr);
      usedIds.push(vr.id);
    }
    if (volRecords.length === 0) {
      warnings.push('当前卷上下文不存在或不可用，已降级使用章节上下文。');
    }
  }

  // 4. 手动上下文
  const allRecords = await contextRecordService.getByNovelId(novelId).catch(() => []);
  const chapterContexts: ContextRecord[] = chapterSummaries.map((s) => ({
    id: s.id, novelId: s.novelId, chapterId: s.chapterId, volumeId: s.volumeId,
    contextType: 'chapter_summary' as const, title: `第${currentChapter?.chapterNumber || '?'}章上下文`,
    content: s.summary, importance: 4, isActive: s.enabled, isExpired: s.isExpired,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  }));

  const manualContexts = allRecords.filter(
    (r) => r.isActive && !r.isExpired && r.contextType !== 'chapter_summary' && r.contextType !== 'volume_summary',
  ).slice(0, 10);
  for (const mc of manualContexts) usedIds.push(mc.id);

  // 去重：移除已在 chapterContexts 中出现的
  const dedupedManual = manualContexts.filter(
    (mc) => !chapterContexts.some((cc) => cc.id === mc.id),
  );

  // 记录日志
  addLog({
    id: logId(), novelId, taskType, chapterId, volumeId: resolvedVolumeId,
    usedContextIds: usedIds, skippedContextIds: skippedIds, warnings,
    createdAt: new Date().toISOString(),
  });

  return { chapterContexts, volumeContexts, manualContexts: dedupedManual, chapterSummaries, warnings };
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
  const allChapters = await chapterRepository.getByNovelId(novelId).catch(() => []);
  const volChapters = allChapters.filter((c) => c.volumeId === volumeId);
  const chapterSummaries: ChapterSummary[] = [];
  for (const ch of volChapters) {
    const s = await chapterSummaryService.getByChapterId(ch.id);
    if (s && s.enabled && !s.isExpired) chapterSummaries.push(s);
  }

  const chapterContexts: ContextRecord[] = chapterSummaries.map((s) => ({
    id: s.id, novelId: s.novelId, chapterId: s.chapterId, volumeId,
    contextType: 'chapter_summary' as const, title: '章节上下文',
    content: s.summary, importance: 4, isActive: s.enabled, isExpired: s.isExpired,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  }));

  // 2. 当前卷上下文
  const allRecords = await contextRecordService.getByNovelId(novelId).catch(() => []);
  const volumeContexts = allRecords.filter(
    (r) => r.contextType === 'volume_summary' && r.volumeId === volumeId && r.isActive && !r.isExpired,
  );
  for (const vr of volumeContexts) usedIds.push(vr.id);

  // 3. 前一卷上下文
  const currentVol = (await volumeRepository.getByNovelId(novelId).catch(() => []))
    .find((v) => v.id === volumeId);
  if (currentVol) {
    const allVolumes = await volumeRepository.getByNovelId(novelId).catch(() => []);
    const prevVol = allVolumes.find((v) => v.orderIndex === currentVol.orderIndex - 1);
    if (prevVol) {
      const prevRecords = allRecords.filter(
        (r) => r.contextType === 'volume_summary' && r.volumeId === prevVol.id && r.isActive && !r.isExpired,
      );
      for (const pr of prevRecords) { volumeContexts.push(pr); usedIds.push(pr.id); }
    }
  }

  // 4. 手动上下文
  const manualContexts = allRecords.filter(
    (r) => r.isActive && !r.isExpired && r.contextType !== 'chapter_summary' && r.contextType !== 'volume_summary',
  ).slice(0, 10);

  addLog({
    id: logId(), novelId, taskType, volumeId,
    usedContextIds: usedIds, skippedContextIds: [], warnings,
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

  const allRecords = await contextRecordService.getByNovelId(novelId).catch(() => []);

  // 1. 所有启用卷上下文
  const volumeContexts = allRecords.filter(
    (r) => r.contextType === 'volume_summary' && r.isActive && !r.isExpired,
  );

  // 2. 重要手动上下文（importance >= 4）
  const manualContexts = allRecords.filter(
    (r) => r.isActive && !r.isExpired
      && r.contextType !== 'chapter_summary' && r.contextType !== 'volume_summary'
      && r.importance >= 4,
  ).slice(0, 15);

  if (volumeContexts.length === 0 && manualContexts.length === 0) {
    warnings.push('无可用卷上下文或手动上下文。');
  }

  addLog({
    id: logId(), novelId, taskType,
    usedContextIds: [...volumeContexts.map((v) => v.id), ...manualContexts.map((m) => m.id)],
    skippedContextIds: [], warnings,
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
    const texts = result.chapterSummaries.map((s, i) =>
      `### 章节上下文 ${i + 1}\n${s.summary}\n` +
      (s.keyEvents?.length ? `关键事件：${s.keyEvents.join('；')}\n` : '') +
      (s.protagonistStateChange ? `主角变化：${s.protagonistStateChange}\n` : '') +
      (s.factsMustRemember?.length ? `关键事实：${s.factsMustRemember.join('；')}\n` : ''),
    );
    sections.push('【章节上下文】\n' + texts.join('\n---\n'));
  }

  if (result.volumeContexts.length > 0) {
    const texts = result.volumeContexts.map((v) =>
      `### ${v.title}\n${v.content.slice(0, 800)}`,
    );
    sections.push('【卷上下文】\n' + texts.join('\n---\n'));
  }

  if (result.manualContexts.length > 0) {
    sections.push('【手动上下文】\n' + buildContextSummary(result.manualContexts, 1200));
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

/** 获取相邻章节 ID（前一章 + 后一章） */
function getAdjacentChapterIds(
  chapters: Array<{ id: string; chapterNumber: number; volumeId?: string }>,
  currentNumber: number,
  volumeId?: string,
): string[] {
  const ids: string[] = [];
  const sameVolume = volumeId
    ? chapters.filter((c) => c.volumeId === volumeId)
    : chapters;
  const sorted = [...sameVolume].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const currentIdx = sorted.findIndex((c) => c.chapterNumber === currentNumber);
  if (currentIdx > 0) ids.push(sorted[currentIdx - 1].id);
  if (currentIdx < sorted.length - 1) ids.push(sorted[currentIdx + 1].id);
  return ids;
}
