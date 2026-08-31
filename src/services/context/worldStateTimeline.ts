import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { ContextRecord, ContextRecordType } from '../../types/context';
import type { Volume } from '../../types/volume';
import { isContextCompressionRecord } from './contextRecordService';

const MAX_TIMELINE_CHAPTERS = 12;
const MAX_TIMELINE_CHARS = 7_200;
const MAX_LIST_ITEMS = 5;
const MAX_ITEM_CHARS = 220;
const MAX_SUMMARY_CHARS = 520;

export interface PersistedWorldStateTimeline {
  content: string;
  latestChapterId: string;
  chapterCount: number;
  sourceSummaryIds: string[];
  sourceContextRecordIds: string[];
}

interface TimelineEntry {
  chapterId: string;
  text: string;
  summaryId?: string;
  contextRecordIds: string[];
}

const CONTEXT_TYPE_LABELS: Partial<Record<ContextRecordType, string>> = {
  character_state: '人物状态',
  foreshadow: '伏笔状态',
  rule: '规则状态',
  relationship: '关系状态',
  plot_progress: '剧情进度',
  other: '其他正式事实',
};

function normalizedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}...`;
}

function normalizedItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizedText(item, MAX_ITEM_CHARS))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_LIST_ITEMS);
}

function appendItems(lines: string[], label: string, value: unknown): void {
  const items = normalizedItems(value);
  if (items.length > 0) lines.push(`- ${label}：${items.join('；')}`);
}

function summaryIsEligible(summary: ChapterSummary): boolean {
  return (
    summary.enabled &&
    !summary.isExpired &&
    summary.validationStatus !== 'failed' &&
    summary.validationResult?.safeToContext !== false
  );
}

function compareNewestSummary(left: ChapterSummary, right: ChapterSummary): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

function latestSummaryByChapter(summaries: readonly ChapterSummary[]): Map<string, ChapterSummary> {
  const result = new Map<string, ChapterSummary>();
  for (const summary of summaries.filter(summaryIsEligible).sort(compareNewestSummary)) {
    if (!result.has(summary.chapterId)) result.set(summary.chapterId, summary);
  }
  return result;
}

function chapterLabel(chapter: Chapter, volumeById: ReadonlyMap<string, Volume>): string {
  const volume = chapter.volumeId ? volumeById.get(chapter.volumeId) : undefined;
  const volumeLabel = volume ? `第${volume.volumeNumber}卷《${volume.title}》 / ` : '';
  return `${volumeLabel}第${chapter.chapterNumber}章《${chapter.title}》`;
}

function buildTimelineEntry(
  chapter: Chapter,
  volumeById: ReadonlyMap<string, Volume>,
  summary: ChapterSummary | undefined,
  records: readonly ContextRecord[],
): TimelineEntry | undefined {
  const lines: string[] = [];
  if (summary) {
    const summaryText = normalizedText(summary.summary, MAX_SUMMARY_CHARS);
    if (summaryText) lines.push(`- 章节终态：${summaryText}`);
    appendItems(
      lines,
      '核心事件',
      summary.coreEvents?.length ? summary.coreEvents : summary.keyEvents,
    );
    appendItems(lines, '世界/规则变化', summary.settingChanges);
    appendItems(lines, '新增地点', summary.newLocations);
    appendItems(lines, '物件/能力变化', summary.newItemsOrAbilities);
    appendItems(
      lines,
      '新增伏笔',
      summary.newForeshadows?.length ? summary.newForeshadows : summary.foreshadowing,
    );
    appendItems(lines, '已回收伏笔', summary.resolvedForeshadows);
    appendItems(lines, '未决问题', summary.unresolvedQuestions);
    appendItems(lines, '持续有效事实', summary.factsMustRemember);
  }

  const eligibleRecords = records
    .filter(
      (record) =>
        record.isActive &&
        !record.isExpired &&
        record.contextType !== 'volume_summary' &&
        !(summary && record.contextType === 'chapter_summary') &&
        !isContextCompressionRecord(record),
    )
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, MAX_LIST_ITEMS);

  for (const record of eligibleRecords) {
    const content = normalizedText(record.content, MAX_ITEM_CHARS);
    if (!content) continue;
    const typeLabel = CONTEXT_TYPE_LABELS[record.contextType] ?? '章节上下文';
    const title = normalizedText(record.title, 80) ?? typeLabel;
    lines.push(`- ${typeLabel}「${title}」：${content}`);
  }

  if (lines.length === 0) return undefined;
  return {
    chapterId: chapter.id,
    text: `### ${chapterLabel(chapter, volumeById)}\n${lines.join('\n')}`,
    summaryId: summary?.id,
    contextRecordIds: eligibleRecords.map((record) => record.id),
  };
}

function fitRecentEntries(header: string, entries: TimelineEntry[]): TimelineEntry[] {
  const selected = entries.slice(-MAX_TIMELINE_CHAPTERS);
  while (
    selected.length > 1 &&
    `${header}\n\n${selected.map((entry) => entry.text).join('\n\n')}`.length > MAX_TIMELINE_CHARS
  ) {
    selected.shift();
  }
  if (selected.length === 1) {
    const available = Math.max(0, MAX_TIMELINE_CHARS - header.length - 2);
    if (selected[0].text.length > available) {
      selected[0] = {
        ...selected[0],
        text: `${selected[0].text.slice(0, Math.max(0, available - 20))}\n[本章状态已截断]`,
      };
    }
  }
  return selected;
}

/**
 * Builds a read-time world-state timeline from persisted, adopted chapter facts.
 * It never materializes inferred state and never includes the target/future chapters.
 */
export function buildPersistedWorldStateTimeline(input: {
  orderedChapters: readonly Chapter[];
  volumes: readonly Volume[];
  targetChapterId: string;
  summaries: readonly ChapterSummary[];
  contextRecords: readonly ContextRecord[];
}): PersistedWorldStateTimeline | undefined {
  const currentIndex = input.orderedChapters.findIndex(
    (chapter) => chapter.id === input.targetChapterId,
  );
  if (currentIndex <= 0) return undefined;

  const priorChapters = input.orderedChapters.slice(0, currentIndex);
  const priorChapterIds = new Set(priorChapters.map((chapter) => chapter.id));
  const volumeById = new Map(input.volumes.map((volume) => [volume.id, volume]));
  const summaries = latestSummaryByChapter(
    input.summaries.filter(
      (summary) =>
        summary.novelId === priorChapters[0]?.novelId && priorChapterIds.has(summary.chapterId),
    ),
  );
  const recordsByChapter = new Map<string, ContextRecord[]>();
  for (const record of input.contextRecords) {
    if (!record.chapterId || !priorChapterIds.has(record.chapterId)) continue;
    const records = recordsByChapter.get(record.chapterId) ?? [];
    records.push(record);
    recordsByChapter.set(record.chapterId, records);
  }

  const entries = priorChapters.flatMap((chapter) => {
    const entry = buildTimelineEntry(
      chapter,
      volumeById,
      summaries.get(chapter.id),
      recordsByChapter.get(chapter.id) ?? [],
    );
    return entry ? [entry] : [];
  });
  if (entries.length === 0) return undefined;

  const latestChapter = priorChapters[priorChapters.length - 1];
  const targetChapter = input.orderedChapters[currentIndex];
  const header = [
    '以下状态只来自已采用章节总结与正式 ContextRecord，不包含模型推测。',
    `叙事进度：已完成至${chapterLabel(latestChapter, volumeById)}；当前目标为${chapterLabel(targetChapter, volumeById)}。`,
    '条目按正式卷章顺序排列，章节序号不是故事日期；只沿用正文中明确出现的日期、时刻和期限。',
    '同一状态若有冲突，以更靠后的明确记录为准；未记录的变化必须保持未知。',
  ].join('\n');
  const selected = fitRecentEntries(header, entries);

  return {
    content: `${header}\n\n${selected.map((entry) => entry.text).join('\n\n')}`,
    latestChapterId: latestChapter.id,
    chapterCount: selected.length,
    sourceSummaryIds: selected.flatMap((entry) => (entry.summaryId ? [entry.summaryId] : [])),
    sourceContextRecordIds: selected.flatMap((entry) => entry.contextRecordIds),
  };
}
