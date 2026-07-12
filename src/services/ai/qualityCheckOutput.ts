import type { AiClient, AiGenerateRequest, AiGenerateResponse } from '../../types/ai';
import type {
  QualityCheckResult,
  QualityIssueSeverity,
  QualityIssueType,
} from '../../types/qualityCheck';
import { extractJsonObject } from './jsonUtils';

const ISSUE_TYPES = new Set<QualityIssueType>([
  'logic',
  'setting_violation',
  'character_behavior',
  'continuity',
  'language',
  'pacing',
  'style',
  'other',
]);

const SEVERITIES = new Set<QualityIssueSeverity>(['low', 'medium', 'high', 'critical']);

const OUTPUT_CORRECTION_MESSAGE = [
  '前面的任务是质量检查，不是续写、改写或复述正文。',
  '请重新分析同一份正文，并且只返回一个 JSON 对象；不要输出 Markdown 代码块、解释文字或正文内容。',
  'JSON 必须严格使用以下结构：',
  '{"overallScore":78,"summary":"总体评价","items":[{"issueType":"logic","severity":"medium","title":"问题标题","description":"问题描述","evidence":"原文证据","suggestion":"修改建议","quote":"相关原文片段","startOffset":0,"endOffset":12,"paragraphIndex":0}]}',
  'issueType 只能是 logic、setting_violation、character_behavior、continuity、pacing、style、language、other。',
  'severity 只能是 critical、high、medium、low。没有问题时 items 返回空数组。',
].join('\n');

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function readValue(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function readString(record: UnknownRecord, keys: string[]): string | undefined {
  const value = readValue(record, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFiniteNumber(record: UnknownRecord, keys: string[]): number | undefined {
  const value = readValue(record, keys);
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalIndex(record: UnknownRecord, keys: string[]): number | undefined {
  const value = readFiniteNumber(record, keys);
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeIssueType(value: unknown): QualityIssueType | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (ISSUE_TYPES.has(normalized as QualityIssueType)) return normalized as QualityIssueType;

  if (/逻辑|logic/.test(normalized)) return 'logic';
  if (/设定|世界观|setting|world/.test(normalized)) return 'setting_violation';
  if (/角色|人物|character/.test(normalized)) return 'character_behavior';
  if (/连续|衔接|前后文|continuity/.test(normalized)) return 'continuity';
  if (/语言|病句|错别字|language/.test(normalized)) return 'language';
  if (/节奏|pacing/.test(normalized)) return 'pacing';
  if (/风格|文风|style/.test(normalized)) return 'style';
  if (/其他|other/.test(normalized)) return 'other';
  return undefined;
}

function normalizeSeverity(value: unknown): QualityIssueSeverity | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (SEVERITIES.has(normalized as QualityIssueSeverity)) {
    return normalized as QualityIssueSeverity;
  }
  if (/严重|致命|critical/.test(normalized)) return 'critical';
  if (/高|high/.test(normalized)) return 'high';
  if (/中|medium/.test(normalized)) return 'medium';
  if (/低|low/.test(normalized)) return 'low';
  return undefined;
}

function normalizeItem(value: unknown): QualityCheckResult['items'][number] | null {
  const record = asRecord(value);
  if (!record) return null;

  const severity = normalizeSeverity(readValue(record, ['severity', 'level']));
  const title = readString(record, ['title', 'name']);
  const description = readString(record, ['description', 'detail', 'details']);
  if (!severity || !title || !description) return null;

  const category = readString(record, ['category']);
  const issueType = normalizeIssueType(readValue(record, [
    'issueType', 'issue_type', 'type', 'category',
  ]));
  const startOffset = readOptionalIndex(record, ['startOffset', 'start_offset']);
  const endOffset = readOptionalIndex(record, ['endOffset', 'end_offset']);
  const paragraphIndex = readOptionalIndex(record, ['paragraphIndex', 'paragraph_index']);

  return {
    issueType,
    severity,
    category,
    title,
    description,
    evidence: readString(record, ['evidence']),
    suggestion: readString(record, ['suggestion', 'recommendation']),
    quote: readString(record, ['quote']),
    startOffset,
    endOffset: startOffset === undefined || endOffset === undefined || endOffset >= startOffset
      ? endOffset
      : undefined,
    paragraphIndex,
  };
}

/**
 * Parse and validate a quality-check response without accepting prose fallbacks.
 * Returning null is intentional: callers must retry once or fail closed.
 */
export function parseQualityCheckResult(text: string): QualityCheckResult | null {
  const json = extractJsonObject(text);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record) return null;
  const overallScore = readFiniteNumber(record, ['overallScore', 'overall_score', 'score']);
  const summary = readString(record, ['summary', 'overallSummary', 'overall_summary']);
  const rawItems = readValue(record, ['items', 'issues', 'problems']);
  if (overallScore === undefined || overallScore < 0 || overallScore > 100 || !summary || !Array.isArray(rawItems)) {
    return null;
  }

  const items = rawItems.map(normalizeItem);
  if (items.some((item) => item === null)) return null;

  return {
    overallScore,
    summary,
    items: items as QualityCheckResult['items'],
  };
}

function addOptionalNumbers(left?: number, right?: number): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

function retryRaw(response: AiGenerateResponse): unknown {
  return response.raw === undefined ? { text: response.text } : response.raw;
}

function correctionRequest(request: AiGenerateRequest): AiGenerateRequest {
  const lastUserIndex = request.messages.reduce(
    (found, message, index) => message.role === 'user' ? index : found,
    -1,
  );
  const messages = lastUserIndex < 0
    ? [...request.messages, { role: 'user' as const, content: OUTPUT_CORRECTION_MESSAGE }]
    : request.messages.map((message, index) => index === lastUserIndex
      ? { ...message, content: `${message.content}\n\n${OUTPUT_CORRECTION_MESSAGE}` }
      : message);

  return {
    ...request,
    messages,
  };
}

/**
 * Retry a malformed quality response exactly once with a JSON-only correction.
 * All provider/model/temperature/token/timeout inputs are preserved unchanged.
 */
export function withQualityCheckStructuredRetry(client: AiClient): AiClient {
  return {
    async generate(request): Promise<AiGenerateResponse> {
      const structuredRequest = correctionRequest(request);
      const initial = await client.generate(structuredRequest);
      if (parseQualityCheckResult(initial.text)) return initial;

      const corrected = await client.generate(structuredRequest);
      return {
        ...corrected,
        raw: {
          kind: 'quality_structured_retry_v1',
          initial: retryRaw(initial),
          corrected: retryRaw(corrected),
        },
        tokenInput: addOptionalNumbers(initial.tokenInput, corrected.tokenInput),
        tokenOutput: addOptionalNumbers(initial.tokenOutput, corrected.tokenOutput),
        tokenTotal: addOptionalNumbers(initial.tokenTotal, corrected.tokenTotal),
      };
    },
  };
}
