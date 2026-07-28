/**
 * AI Novel Studio - AI 质量修稿服务
 * v1.7.16: AI 根据质量检查问题自动修稿 + 复检闭环
 */
import { createAiClient, aiSettingsService } from './aiClient';
import { aiTaskService } from './aiTaskService';
import { extractJsonObject, safeJsonParse } from './jsonUtils';
import { fixRunStore } from './fixRunStore';
import type { QualityCheckItem } from '../../types/qualityCheck';
import type {
  AiChatMessage,
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResponse,
  ChapterDraft,
} from '../../types/ai';
import { splitChapterText, type ChapterTextSegment } from './chapterTextSegmentation';
import { isAiRequestCancelled, throwIfAiRequestCancelled } from './aiCancellation';
import { bindAiTaskCancellation, settleAiTaskError } from './aiTaskCancellation';

/** 修稿模式 */
export type FixMode = 'conservative';

/** 修稿运行记录 */
export interface QualityFixRun {
  id: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  targetDraftId?: string;
  targetDraftVersion?: number;
  sourceContentHash: string;
  targetContentHash?: string;
  beforeReportId: string;
  afterReportId?: string;
  beforeScore: number;
  afterScore?: number;
  beforePendingCount: number;
  afterPendingCount?: number;
  beforeSeriousCount: number;
  afterSeriousCount?: number;
  fixedIssueIds: string[];
  newIssueIds: string[];
  mode: FixMode;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'adopted' | 'reverted';
  model?: string;
  revisionSummary?: string;
  changedRangesJson?: string;
  /** v1.7.17 上下文追踪 */
  usedContextIds?: string;
  skippedContextIds?: string;
  warnings?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** AI 修稿返回结果 */
export interface FixResult {
  mode: 'targeted_fix' | 'conservative';
  revisionPlan?: Array<{
    issue_key: string;
    target_quote?: string;
    fix_strategy: string;
    change_scope: string;
  }>;
  fixedIssueKeys: string[];
  revisionSummary: string;
  changedRanges: Array<{ issue_key?: string; reason: string; before: string; after: string }>;
  revisedContent: string;
  unchangedPolicy?: string;
}

/** 修稿范围校验结果 */
export interface FixScopeValidation {
  passed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  changedParagraphCount: number;
  totalParagraphCount: number;
  unrelatedChangedCount: number;
  warnings: string[];
  rejectReason?: string;
}

/** 修复前后对比 */
export interface FixComparison {
  beforeScore: number;
  afterScore: number;
  beforeTotalIssues: number;
  afterTotalIssues: number;
  beforePendingCount: number;
  afterPendingCount: number;
  beforeSeriousCount: number;
  afterSeriousCount: number;
  beforeHighCount: number;
  afterHighCount: number;
  newIssueCount: number;
  fixedIssueCount: number;
  isBetter: boolean;
  isWorse: boolean;
  summary: string;
}

type RawFixResult = Partial<FixResult> & {
  revision_plan?: unknown;
  fixed_issue_keys?: unknown;
  revision_summary?: unknown;
  changed_ranges?: unknown;
  revised_content?: unknown;
  unchanged_policy?: unknown;
};

export interface QualityFixGenerationInput {
  chapterTitle: string;
  chapterOutline?: string;
  sourceContent: string;
  pendingIssues: QualityCheckItem[];
  ignoredIssues: QualityCheckItem[];
  chapterContext?: string;
  volumeContext?: string;
  styleSummary?: string;
}

export interface QualityFixGeneration {
  fixResult: FixResult;
  requestCount: number;
  sourceSegmentCount: number;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
}

type FixGenerator = (request: AiGenerateRequest) => Promise<AiGenerateResponse>;

/** 生成简单哈希 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 5000); i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return 'fx_' + (hash >>> 0).toString(16).padStart(8, '0');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return fallback;
}

function readArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|text|markdown)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractPlainRevisedContent(rawText: string, sourceContent: string): string {
  const cleaned = stripOuterFence(rawText);
  if (!cleaned || extractJsonObject(cleaned)) return '';

  const markerMatch = cleaned.match(
    /(?:revised_content|修订后正文|修订版正文|完整修订后章节正文)\s*[:：]\s*([\s\S]+)$/i,
  );
  const candidate = (markerMatch?.[1] || cleaned).trim();
  const minLength = Math.min(120, Math.max(20, Math.round(sourceContent.trim().length * 0.3)));
  return candidate.length >= minLength ? candidate : '';
}

function normalizeRevisionPlan(value: unknown): FixResult['revisionPlan'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      issue_key: readString(record, ['issue_key', 'issueKey']),
      target_quote: readString(record, ['target_quote', 'targetQuote']) || undefined,
      fix_strategy: readString(record, ['fix_strategy', 'fixStrategy']),
      change_scope: readString(record, ['change_scope', 'changeScope']),
    };
  });
}

function normalizeChangedRanges(value: unknown): FixResult['changedRanges'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      issue_key: readString(record, ['issue_key', 'issueKey']) || undefined,
      reason: readString(record, ['reason']),
      before: readString(record, ['before']),
      after: readString(record, ['after']),
    };
  });
}

function normalizeFixResult(raw: RawFixResult, rawText: string, sourceContent: string): FixResult {
  const record = asRecord(raw);
  const fixedIssueKeys = readArray(record, ['fixedIssueKeys', 'fixed_issue_keys']).filter(
    (item): item is string => typeof item === 'string',
  );
  const revisedContent =
    readString(record, ['revisedContent', 'revised_content']) ||
    extractPlainRevisedContent(rawText, sourceContent) ||
    sourceContent;

  return {
    mode: readString(record, ['mode']) === 'targeted_fix' ? 'targeted_fix' : 'conservative',
    revisionPlan: normalizeRevisionPlan(record.revisionPlan ?? record.revision_plan),
    fixedIssueKeys,
    revisionSummary: readString(record, ['revisionSummary', 'revision_summary'], '无修复摘要'),
    changedRanges: normalizeChangedRanges(record.changedRanges ?? record.changed_ranges),
    revisedContent,
    unchangedPolicy: readString(record, ['unchangedPolicy', 'unchanged_policy']),
  };
}

interface TextRange {
  start: number;
  end: number;
}

function validOffsetRange(item: QualityCheckItem, contentLength: number): TextRange | null {
  if (!Number.isInteger(item.startOffset) || item.startOffset === undefined) return null;
  if (item.startOffset < 0 || item.startOffset >= contentLength) return null;
  const requestedEnd = Number.isInteger(item.endOffset)
    ? (item.endOffset as number)
    : item.startOffset + 1;
  return {
    start: item.startOffset,
    end: Math.min(contentLength, Math.max(item.startOffset + 1, requestedEnd)),
  };
}

function findTextRanges(content: string, text: string | undefined): TextRange[] {
  const needle = text?.trim();
  if (!needle) return [];
  const ranges: TextRange[] = [];
  let fromIndex = 0;
  while (fromIndex < content.length) {
    const start = content.indexOf(needle, fromIndex);
    if (start < 0) break;
    ranges.push({ start, end: start + needle.length });
    fromIndex = start + Math.max(1, needle.length);
  }
  return ranges;
}

function paragraphRange(content: string, paragraphIndex: number | undefined): TextRange | null {
  if (!Number.isInteger(paragraphIndex) || paragraphIndex === undefined || paragraphIndex < 0) {
    return null;
  }
  const separator = /\n\s*\n/g;
  let index = 0;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(content)) !== null) {
    if (index === paragraphIndex) return { start, end: match.index };
    index += 1;
    start = separator.lastIndex;
  }
  return index === paragraphIndex ? { start, end: content.length } : null;
}

function issueTextRanges(content: string, item: QualityCheckItem): TextRange[] {
  const offsetRange = validOffsetRange(item, content.length);
  if (offsetRange) return [offsetRange];

  const quotedRanges = findTextRanges(content, item.quote);
  if (quotedRanges.length > 0) return quotedRanges;

  const evidenceRanges = findTextRanges(content, item.evidence);
  if (evidenceRanges.length > 0) return evidenceRanges;

  const byParagraph = paragraphRange(content, item.paragraphIndex);
  return byParagraph ? [byParagraph] : [];
}

function rangesOverlap(segment: ChapterTextSegment, range: TextRange): boolean {
  return range.start < segment.endOffset && range.end > segment.startOffset;
}

/**
 * 选择与当前连续分段相交的问题。没有任何位置证据的问题视为全章问题，
 * 会进入每个分段，避免静默遗漏无法定位的节奏或结构类问题。
 */
export function selectIssuesForChapterSegment(
  sourceContent: string,
  segment: ChapterTextSegment,
  issues: QualityCheckItem[],
): QualityCheckItem[] {
  return issues.filter((item) => {
    const ranges = issueTextRanges(sourceContent, item);
    return ranges.length === 0 || ranges.some((range) => rangesOverlap(segment, range));
  });
}

/** 构建 AI 修稿 Prompt (v1.7.19 精准局部修稿) */
function buildFixPrompt(params: {
  chapterTitle: string;
  chapterOutline?: string;
  draftContent: string;
  pendingIssues: QualityCheckItem[];
  ignoredIssues: QualityCheckItem[];
  chapterContext?: string;
  volumeContext?: string;
  styleSummary?: string;
  segment?: ChapterTextSegment;
}): { messages: AiChatMessage[]; maxTokens: number } {
  const pendingText = params.pendingIssues
    .map((item, i) => {
      const parts = [
        `### 问题 ${i + 1}`,
        `- issue_key: ${item.issueKey}`,
        `- severity: ${item.severity}`,
        `- category: ${item.category || item.issueType}`,
        `- title: ${item.title}`,
        `- description: ${item.description}`,
      ];
      if (item.quote) parts.push(`- quote: "${item.quote}"`);
      if (item.suggestion) parts.push(`- suggestion: ${item.suggestion}`);
      if (item.startOffset !== undefined) {
        const startOffset = params.segment
          ? Math.max(0, item.startOffset - params.segment.startOffset)
          : item.startOffset;
        parts.push(`- start_offset: ${startOffset}`);
      }
      if (item.endOffset !== undefined) {
        const endOffset = params.segment
          ? Math.min(
              params.draftContent.length,
              Math.max(0, item.endOffset - params.segment.startOffset),
            )
          : item.endOffset;
        parts.push(`- end_offset: ${endOffset}`);
      }
      if (item.paragraphIndex !== undefined) {
        const paragraphIndex = params.segment
          ? Math.max(0, item.paragraphIndex - params.segment.paragraphStart)
          : item.paragraphIndex;
        parts.push(`- paragraph_index: ${paragraphIndex}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  const ignoredText =
    params.ignoredIssues.length > 0
      ? params.ignoredIssues
          .map((item) => `- ${item.issueKey}: ${item.title}（忽略，不要修复）`)
          .join('\n')
      : '无';

  const system = [
    '你是一位精准小说章节修稿专家。你不是在重新创作本章。',
    '你是在对当前章节进行最小必要修改，只修复【待修复问题】中列出的问题。',
    '未被质量检查指出的内容，尽量保持原文不变。只修改问题涉及的段落。',
    '',
    `章节：${params.chapterTitle}`,
    params.chapterOutline ? `大纲：${params.chapterOutline}` : '',
    '',
    params.chapterContext || '',
    params.volumeContext || '',
    params.styleSummary ? `风格：${params.styleSummary}` : '',
    params.segment
      ? `当前处理原章第 ${params.segment.index + 1}/${params.segment.total} 个连续分段；问题位置已换算为当前段内位置。`
      : '',
    params.segment?.previousContext
      ? `前段衔接（只供判断，不属于待修正文，也不要输出）：\n${params.segment.previousContext}`
      : '',
    params.segment?.nextContext
      ? `后段衔接（只供判断，不属于待修正文，也不要输出）：\n${params.segment.nextContext}`
      : '',
    '',
    '【核心约束 - 必须遵守】',
    '- 修稿不是重写，修改范围尽量小。',
    '- 只修复【待修复问题】，不修复 ignored 问题。',
    '- 未涉及质量问题的段落保持原文不变。',
    '- 不改变章节核心目标、设定和人物关系。',
    '- 不新增设定、不提前暴露秘密。',
    params.segment
      ? '- 输出必须是完整的当前分段正文，不要重复前后衔接文本。'
      : '- 输出必须是完整章节正文。',
    '',
    '【已忽略问题，不要修复】',
    ignoredText,
    '',
    '【待修复问题】',
    pendingText,
    '',
    '请严格按以下 JSON 格式返回：',
    '{',
    '  "mode": "targeted_fix",',
    '  "revision_plan": [{ "issue_key":"...", "target_quote":"...", "fix_strategy":"...", "change_scope":"只修改该段" }],',
    '  "changed_ranges": [{ "issue_key":"...", "before":"原文", "after":"修改后", "reason":"修复原因" }],',
    '  "fixed_issue_keys": ["qc_xxx"],',
    '  "revision_summary": "本次修复说明",',
    '  "unchanged_policy": "未涉及质量问题的段落保持原文结构和表达。",',
    params.segment
      ? '  "revised_content": "完整修订后的当前分段正文"'
      : '  "revised_content": "完整修订后章节正文"',
    '}',
    '',
    params.segment ? '以下是当前章节分段正文：' : '以下是当前章节全文：',
    params.draftContent,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `请根据以上 ${params.pendingIssues.length} 个待修复问题，进行精准局部修稿。只修改问题相关部分，其他内容尽量不变。`,
      },
    ],
    maxTokens: 10000,
  };
}

function preserveSegmentBoundaryWhitespace(source: string, revised: string): string {
  if (!source.trim()) return source;
  const revisedBody = revised.trim();
  if (!revisedBody) throw new Error('AI 返回的分段修订正文为空。');
  const leading = source.match(/^\s*/)?.[0] ?? '';
  const trailing = source.match(/\s*$/)?.[0] ?? '';
  return `${leading}${revisedBody}${trailing}`;
}

export function mergeQualityFixSegments(
  sourceContent: string,
  segments: ChapterTextSegment[],
  revisedBySegment: ReadonlyMap<number, string>,
): string {
  if (segments.length === 0 || segments.map((segment) => segment.text).join('') !== sourceContent) {
    throw new Error('章节修稿分段来源与原文不一致。');
  }
  return segments
    .map((segment) => {
      const revised = revisedBySegment.get(segment.index);
      return revised === undefined
        ? segment.text
        : preserveSegmentBoundaryWhitespace(segment.text, revised);
    })
    .join('');
}

function ensureSegmentRevisionIsComplete(
  segment: ChapterTextSegment,
  revisedContent: string,
): void {
  const sourceLength = segment.text.trim().length;
  const revisedLength = revisedContent.trim().length;
  if (revisedLength === 0) throw new Error(`章节修稿第 ${segment.index + 1} 段返回为空。`);
  if (sourceLength >= 500 && revisedLength < Math.floor(sourceLength * 0.8)) {
    throw new Error(`章节修稿第 ${segment.index + 1} 段结果异常过短，可能丢失正文。`);
  }
}

/** 按问题位置修复相关分段，未命中的分段始终逐字符沿用原文。 */
export async function generateSegmentedQualityFix(
  input: QualityFixGenerationInput,
  generate: FixGenerator,
): Promise<QualityFixGeneration> {
  const segments = splitChapterText(input.sourceContent);
  if (segments.length === 0) throw new Error('章节修稿正文为空。');

  let requestCount = 0;
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenTotal = 0;
  const segmentResults = new Map<number, FixResult>();
  const revisedBySegment = new Map<number, string>();

  for (const segment of segments) {
    const pendingIssues = selectIssuesForChapterSegment(
      input.sourceContent,
      segment,
      input.pendingIssues,
    );
    if (pendingIssues.length === 0) continue;
    const ignoredIssues = selectIssuesForChapterSegment(
      input.sourceContent,
      segment,
      input.ignoredIssues,
    );
    const prompt = buildFixPrompt({
      chapterTitle: input.chapterTitle,
      chapterOutline: input.chapterOutline,
      draftContent: segment.text,
      pendingIssues,
      ignoredIssues,
      chapterContext: input.chapterContext,
      volumeContext: input.volumeContext,
      styleSummary: input.styleSummary,
      segment: segments.length > 1 ? segment : undefined,
    });
    const response = await generate({
      taskType: 'quality_fix',
      messages: prompt.messages,
      maxTokens: prompt.maxTokens,
    });
    requestCount += 1;
    tokenInput += response.tokenInput ?? 0;
    tokenOutput += response.tokenOutput ?? 0;
    tokenTotal += response.tokenTotal ?? (response.tokenInput ?? 0) + (response.tokenOutput ?? 0);

    const parsed = safeJsonParse<RawFixResult>(response.text, {
      mode: 'conservative',
      fixedIssueKeys: [],
      revisionSummary: 'AI 返回格式不规范，沿用当前分段正文。',
      changedRanges: [],
      revisedContent: segment.text,
    });
    const result = normalizeFixResult(parsed, response.text, segment.text);
    ensureSegmentRevisionIsComplete(segment, result.revisedContent);

    const relevantKeys = new Set(pendingIssues.map((item) => item.issueKey));
    result.fixedIssueKeys = result.fixedIssueKeys.filter((key) => relevantKeys.has(key));
    result.revisionPlan = result.revisionPlan?.filter((item) => relevantKeys.has(item.issue_key));
    result.changedRanges = result.changedRanges.filter(
      (item) => !item.issue_key || relevantKeys.has(item.issue_key),
    );
    segmentResults.set(segment.index, result);
    revisedBySegment.set(segment.index, result.revisedContent);
  }

  const revisedContent = mergeQualityFixSegments(input.sourceContent, segments, revisedBySegment);
  const orderedResults = [...segmentResults.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, result]) => ({ index, result }));
  const pendingKeys = new Set(input.pendingIssues.map((item) => item.issueKey));
  const fixedIssueKeys = [
    ...new Set(orderedResults.flatMap(({ result }) => result.fixedIssueKeys)),
  ].filter((key) => pendingKeys.has(key));
  const revisionPlan = orderedResults.flatMap(({ result }) => result.revisionPlan ?? []);
  const changedRanges = orderedResults.flatMap(({ result }) => result.changedRanges);
  const revisionSummary =
    orderedResults.length === 0
      ? '没有待修复问题，正文保持不变。'
      : orderedResults.length === 1
        ? orderedResults[0].result.revisionSummary
        : orderedResults
            .map(
              ({ index, result }) =>
                `第 ${index + 1}/${segments.length} 段：${result.revisionSummary}`,
            )
            .join('；');

  return {
    fixResult: {
      mode: orderedResults.some(({ result }) => result.mode === 'targeted_fix')
        ? 'targeted_fix'
        : 'conservative',
      revisionPlan,
      fixedIssueKeys,
      revisionSummary,
      changedRanges,
      revisedContent,
      unchangedPolicy: '未命中待修复问题的连续分段保持原文不变。',
    },
    requestCount,
    sourceSegmentCount: segments.length,
    tokenInput,
    tokenOutput,
    tokenTotal,
  };
}

/** 修稿范围校验 (v1.7.19) */
function validateFixScope(
  sourceContent: string,
  revisedContent: string,
  changedRanges: FixResult['changedRanges'],
  fixedIssueKeys: string[],
  pendingIssueKeys: string[],
): FixScopeValidation {
  const warnings: string[] = [];
  if (!revisedContent || revisedContent.trim().length === 0) {
    return {
      passed: false,
      riskLevel: 'high',
      changedParagraphCount: 0,
      totalParagraphCount: 0,
      unrelatedChangedCount: 0,
      warnings,
      rejectReason: '修订版正文为空',
    };
  }

  const sourceLen = sourceContent.length;
  const revisedLen = revisedContent.length;
  const ratio = revisedLen / Math.max(1, sourceLen);

  if (ratio < 0.8) {
    return {
      passed: false,
      riskLevel: 'high',
      changedParagraphCount: 0,
      totalParagraphCount: 0,
      unrelatedChangedCount: 0,
      warnings,
      rejectReason: `修订版字数异常减少（${Math.round(ratio * 100)}%），可能丢失关键内容`,
    };
  }
  if (ratio > 1.3)
    warnings.push(`修订版字数增加 ${Math.round((ratio - 1) * 100)}%，可能新增了无关内容`);

  // 段落级变化检测
  const srcParas = sourceContent.split(/\n\n+/);
  const revParas = revisedContent.split(/\n\n+/);
  let changedCount = 0;
  const totalComparable = Math.min(srcParas.length, revParas.length);

  for (let i = 0; i < totalComparable; i++) {
    const s = srcParas[i].trim();
    const r = revParas[i] ? revParas[i].trim() : '';
    if (s !== r) changedCount++;
  }
  // 新增/删除的段落也算变化
  changedCount += Math.abs(srcParas.length - revParas.length);

  const totalParagraphCount = Math.max(srcParas.length, revParas.length);
  const changeRatio = changedCount / Math.max(1, totalParagraphCount);

  // 检查是否只修改了 pending issue 相关区域
  const pendingQuoteTexts = pendingIssueKeys.join(' ').toLowerCase();
  let unrelatedChangedCount = 0;

  for (let i = 0; i < Math.min(srcParas.length, revParas.length); i++) {
    const s = srcParas[i].trim();
    const r = revParas[i] ? revParas[i].trim() : '';
    if (s !== r) {
      // 简单判断：是否包含 pending issue key 的引用
      const paraText = (s + ' ' + r).toLowerCase();
      if (!pendingQuoteTexts.includes(paraText.slice(0, 50))) {
        // 粗略判断为无关修改
      }
      unrelatedChangedCount++;
    }
  }

  if (changeRatio > 0.4 && changedCount > 3) {
    return {
      passed: false,
      riskLevel: 'high',
      changedParagraphCount: changedCount,
      totalParagraphCount,
      unrelatedChangedCount,
      warnings,
      rejectReason: `修改了 ${Math.round(changeRatio * 100)}% 段落（${changedCount}/${totalParagraphCount}），超出精准修稿范围`,
    };
  }

  // 检查 changed_ranges 是否绑定 issue_key
  const unboundedRanges = changedRanges.filter(
    (r) => !r.issue_key || !fixedIssueKeys.includes(r.issue_key),
  );
  if (unboundedRanges.length > 0) {
    warnings.push(`${unboundedRanges.length} 个 changed_ranges 未绑定有效的 issue_key`);
  }

  const riskLevel = changeRatio > 0.25 ? 'medium' : 'low';
  return {
    passed: true,
    riskLevel,
    changedParagraphCount: changedCount,
    totalParagraphCount,
    unrelatedChangedCount,
    warnings,
  };
}

export const qualityFixService = {
  async runFix(
    params: {
      novelId: string;
      chapterId: string;
      chapterTitle: string;
      chapterOutline?: string;
      currentDraft: ChapterDraft;
      pendingIssues: QualityCheckItem[];
      ignoredIssues: QualityCheckItem[];
      beforeReportId: string;
      beforeScore: number;
      beforePendingCount: number;
      beforeSeriousCount: number;
      chapterContext?: string;
      volumeContext?: string;
      styleSummary?: string;
    },
    options: AiGenerateOptions = {},
  ): Promise<{ fixResult: FixResult; fixRun: QualityFixRun; scopeValidation: FixScopeValidation }> {
    const settings = aiSettingsService.getSettings();
    const sourceHash = hashContent(params.currentDraft.content);

    // 创建 fix run 记录并持久化
    const fixRun: QualityFixRun = {
      id: 'fxr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      novelId: params.novelId,
      chapterId: params.chapterId,
      sourceDraftId: params.currentDraft.id,
      sourceDraftVersion: params.currentDraft.versionNo,
      sourceContentHash: sourceHash,
      beforeReportId: params.beforeReportId,
      beforeScore: params.beforeScore,
      beforePendingCount: params.beforePendingCount,
      beforeSeriousCount: params.beforeSeriousCount,
      fixedIssueIds: [],
      newIssueIds: [],
      mode: 'conservative',
      status: 'running',
      model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fixRunStore.save(fixRun);

    // 创建 AI 任务
    const task = await aiTaskService
      .create('quality_fix', {
        novelId: params.novelId,
        chapterId: params.chapterId,
        runtimeMode: settings.runtimeMode,
        provider: settings.provider,
        modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        inputSummary: `修复章节「${params.chapterTitle}」${params.pendingIssues.length} 个问题`,
      })
      .catch(() => null);
    const releaseCancellation = bindAiTaskCancellation(task?.id, options);

    try {
      const client = createAiClient(settings);
      const generation = await generateSegmentedQualityFix(
        {
          chapterTitle: params.chapterTitle,
          chapterOutline: params.chapterOutline,
          sourceContent: params.currentDraft.content,
          pendingIssues: params.pendingIssues,
          ignoredIssues: params.ignoredIssues,
          chapterContext: params.chapterContext,
          volumeContext: params.volumeContext,
          styleSummary: params.styleSummary,
        },
        (request) => {
          throwIfAiRequestCancelled(options.signal);
          return client.generate(request, options);
        },
      );
      throwIfAiRequestCancelled(options.signal);
      const safeFixResult = generation.fixResult;

      // 校验 revisedContent 非空
      if (!safeFixResult.revisedContent.trim()) {
        throw new Error('AI 返回的修订版正文为空');
      }

      fixRun.revisionSummary = safeFixResult.revisionSummary;
      fixRun.changedRangesJson = JSON.stringify(safeFixResult.changedRanges);
      fixRun.status = 'success';
      fixRun.fixedIssueIds = params.pendingIssues
        .filter((i) => safeFixResult.fixedIssueKeys.includes(i.issueKey))
        .map((i) => i.id);
      fixRunStore.save(fixRun);

      // v1.7.19 修稿范围校验
      const scopeValidation = validateFixScope(
        params.currentDraft.content,
        safeFixResult.revisedContent,
        safeFixResult.changedRanges,
        safeFixResult.fixedIssueKeys,
        params.pendingIssues.map((i) => i.issueKey),
      );

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: safeFixResult.revisionSummary,
        tokenInput: generation.tokenInput,
        tokenOutput: generation.tokenOutput,
        tokenTotal: generation.tokenTotal,
      });

      return { fixResult: safeFixResult, fixRun, scopeValidation };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'AI 修稿失败';
      const cancelled = options.signal?.aborted || isAiRequestCancelled(e);
      fixRun.status = cancelled ? 'cancelled' : 'failed';
      fixRun.failureReason = cancelled ? undefined : message;
      fixRunStore.save(fixRun);
      await settleAiTaskError({
        taskId: task?.id,
        error: e,
        signal: options.signal,
        fallbackMessage: 'AI 修稿失败',
      });
      throw e;
    } finally {
      releaseCancellation();
    }
  },

  /** 对比修复前后效果 */
  compareResults(
    beforeScore: number,
    afterScore: number,
    beforePending: number,
    afterPending: number,
    beforeSerious: number,
    afterSerious: number,
    beforeTotal: number,
    afterTotal: number,
    beforeHigh: number,
    afterHigh: number,
    fixedCount: number,
  ): FixComparison {
    const newIssueCount = Math.max(0, afterPending - (beforePending - fixedCount));
    const isBetter =
      afterScore > beforeScore && afterSerious <= beforeSerious && afterPending < beforePending;
    const isWorse = afterScore < beforeScore || afterSerious > beforeSerious;

    return {
      beforeScore,
      afterScore,
      beforeTotalIssues: beforeTotal,
      afterTotalIssues: afterTotal,
      beforePendingCount: beforePending,
      afterPendingCount: afterPending,
      beforeSeriousCount: beforeSerious,
      afterSeriousCount: afterSerious,
      beforeHighCount: beforeHigh,
      afterHighCount: afterHigh,
      newIssueCount,
      fixedIssueCount: fixedCount,
      isBetter,
      isWorse,
      summary: isBetter
        ? `修复成功：分数从 ${beforeScore} 提升至 ${afterScore}，修复 ${fixedCount} 个问题。`
        : isWorse
          ? `修复效果不佳：分数从 ${beforeScore} 降至 ${afterScore}。`
          : `修复效果一般：分数 ${beforeScore} → ${afterScore}。`,
    };
  },

  /** 标记修稿已被采用 */
  async adoptFixRun(id: string): Promise<void> {
    await fixRunStore.updateStatus(id, 'adopted');
  },

  /** 回退修稿 */
  async revertFixRun(id: string): Promise<void> {
    await fixRunStore.updateStatus(id, 'reverted');
  },

  /** 获取最近的修稿记录 */
  async getFixRuns(chapterId: string): Promise<QualityFixRun[]> {
    return fixRunStore.getByChapterId(chapterId);
  },
};
