import type { ChapterSummaryGrounding } from '../../types/chapterSummary';

export const SUMMARY_GROUNDING_FIELDS = [
  'summary',
  'summaryTitle',
  'keyEvents',
  'coreEvents',
  'protagonistStateChange',
  'importantCharacterChanges',
  'characterChanges',
  'relationshipChanges',
  'settingChanges',
  'newLocations',
  'newItemsOrAbilities',
  'newForeshadows',
  'resolvedForeshadows',
  'foreshadowing',
  'unresolvedQuestions',
  'factsMustRemember',
  'nextChapterHints',
  'nextChapterHook',
  'contextRecords',
] as const;
const CHARACTER_REFERENCES = new Set([
  'name',
  'characterName',
  'characterId',
  'fromCharacterName',
  'toCharacterName',
]);
function isMetadata(path: string, key: string) {
  return (
    (['/characterChanges/', '/importantCharacterChanges/', '/relationshipChanges/'].some((prefix) =>
      path.startsWith(prefix),
    ) &&
      CHARACTER_REFERENCES.has(key)) ||
    (path.startsWith('/contextRecords/') && ['contextType', 'importance'].includes(key))
  );
}
export const SUMMARY_STATUS_LABELS = {
  confirmed: '已确认',
  inferred: '推测',
  unresolved: '待查',
  planned: '计划',
} as const;
export interface SummaryGroundingIssue {
  severity: 'warning' | 'error';
  code: string;
  path: string;
  message: string;
}
export interface SummaryGroundingSource {
  quote: string;
  startChar: number;
  line: number;
  context: string;
  contextLine: number;
}
export interface SummaryGroundingClaimView {
  path: string;
  statement: string;
  status: keyof typeof SUMMARY_STATUS_LABELS | 'unclassified';
  quotes: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Enumerates every content string that can be projected into summary/context/state memory. */
export function summaryAssertionTargets(payload: unknown): Map<string, string> {
  const targets = new Map<string, string>();
  function visit(value: unknown, path: string) {
    if (typeof value === 'string' && value.trim()) targets.set(path, value.trim());
    else if (Array.isArray(value)) value.forEach((row, index) => visit(row, `${path}/${index}`));
    else if (record(value))
      Object.entries(value).forEach(([key, row]) => {
        if (!isMetadata(path, key))
          visit(row, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      });
  }
  if (record(payload)) SUMMARY_GROUNDING_FIELDS.forEach((key) => visit(payload[key], `/${key}`));
  return targets;
}

export function summaryGroundingPayload(content: string): Record<string, unknown> | undefined {
  try {
    const payload: unknown = JSON.parse(content);
    if (!record(payload)) return undefined;
    if ('summary' in payload) return payload;
    if (record(payload.data)) {
      if (typeof payload.data.text === 'string') return summaryGroundingPayload(payload.data.text);
      return payload.data;
    }
    return payload;
  } catch {
    return undefined;
  }
}

export function summaryClaimViews(payload: unknown): SummaryGroundingClaimView[] {
  const grounding = record(payload) && record(payload.grounding) ? payload.grounding : undefined;
  const claims = Array.isArray(grounding?.claims) ? grounding.claims.filter(record) : [];
  return [...summaryAssertionTargets(payload)].map(([path, statement]) => {
    const claim = claims.find((row) => row.path === path);
    const status = claim?.status;
    return {
      path,
      statement,
      status:
        typeof status === 'string' &&
        Object.prototype.hasOwnProperty.call(SUMMARY_STATUS_LABELS, status)
          ? (status as keyof typeof SUMMARY_STATUS_LABELS)
          : 'unclassified',
      quotes: Array.isArray(claim?.quotes)
        ? claim.quotes.filter((quote): quote is string => typeof quote === 'string')
        : [],
    };
  });
}

const QUALIFIERS = [
  '【推测】',
  '【待查】',
  '【计划】',
  '可能',
  '推测',
  '猜测',
  '尚未',
  '未能',
  '未知',
  '不知',
  '无法确认',
  '无法确定',
  '不能确认',
  '计划',
  '准备',
  '拟',
  '打算',
  '将要',
  '有待',
  '待查',
  '尚待',
  '愿意',
  '没有',
  '并未',
  '从未',
  '尚无',
  '无从',
  '未曾',
  '还没',
  '未完成',
  '未确认',
  '并非',
  '不曾',
  '是否',
  '据称',
  '听说',
  '声称',
  '自称',
];
const qualified = (text: string) => QUALIFIERS.some((word) => text.includes(word));

function sourceSentence(source: string, start: number, end: number) {
  const boundary = /[\n。！？.!?]/;
  let left = start;
  while (left > 0 && !boundary.test(source[left - 1])) left--;
  let right = end;
  if (!boundary.test(source[end - 1])) {
    while (right < source.length && !boundary.test(source[right])) right++;
    if (right < source.length) right++;
  }
  return {
    context: source.slice(left, right),
    contextLine: source.slice(0, left).split('\n').length,
  };
}

export function validateSummaryGrounding(source: string, payload: unknown, required = true) {
  const issues: SummaryGroundingIssue[] = [];
  const locations = new Map<string, SummaryGroundingSource[]>();
  const add = (severity: 'warning' | 'error', code: string, path: string, message: string) =>
    issues.push({ severity, code, path, message });
  const grounding = record(payload) && record(payload.grounding) ? payload.grounding : undefined;
  if (!Array.isArray(grounding?.claims)) {
    add(
      required ? 'error' : 'warning',
      'SUMMARY_GROUNDING_MISSING',
      '/grounding',
      '缺少逐条原文依据，请根据当前采用稿重新总结并为所有断言提供原文与确定性分类。',
    );
    return { issues, locations };
  }
  if (grounding.version !== 1 || !grounding.claims.length || grounding.claims.length > 200) {
    add('error', 'SUMMARY_GROUNDING_INVALID', '/grounding', '总结依据格式或版本无效，请重新生成。');
    return { issues, locations };
  }
  const targets = summaryAssertionTargets(payload);
  const covered = new Set<string>();
  for (const candidate of grounding.claims) {
    const claim = record(candidate) ? candidate : {};
    const path = typeof claim.path === 'string' ? claim.path : '';
    const statement = targets.get(path);
    if (!statement) {
      add('error', 'SUMMARY_GROUNDING_TARGET_INVALID', path, '依据指向不存在的内容字段。');
      continue;
    }
    if (
      typeof claim.status !== 'string' ||
      !Object.prototype.hasOwnProperty.call(SUMMARY_STATUS_LABELS, claim.status) ||
      covered.has(path)
    ) {
      add('error', 'SUMMARY_GROUNDING_STATUS_INVALID', path, '断言分类无效或重复。');
      continue;
    }
    covered.add(path);
    const status = claim.status as keyof typeof SUMMARY_STATUS_LABELS;
    if (status !== 'confirmed' && !statement.startsWith(`【${SUMMARY_STATUS_LABELS[status]}】`)) {
      add(
        'error',
        'SUMMARY_QUALIFIER_MISSING',
        path,
        `请在这条文字前保留【${SUMMARY_STATUS_LABELS[status]}】限定，避免进入上下文后被当作既成事实。`,
      );
    }
    if (!Array.isArray(claim.quotes) || !claim.quotes.length || claim.quotes.length > 8) {
      add('error', 'SUMMARY_EVIDENCE_REQUIRED', path, '缺少原文完整引句。');
      continue;
    }
    const sources: SummaryGroundingSource[] = [];
    for (const quote of claim.quotes) {
      const offset = typeof quote === 'string' ? source.indexOf(quote) : -1;
      if (
        typeof quote !== 'string' ||
        Array.from(quote.trim()).length < 4 ||
        Array.from(quote).length > 1200 ||
        offset < 0
      ) {
        add(
          'error',
          'SUMMARY_EVIDENCE_NOT_FOUND',
          path,
          '引句不在完整采用稿中，请删去无依据断言或重新总结。',
        );
        continue;
      }
      sources.push({
        quote,
        startChar: Array.from(source.slice(0, offset)).length,
        line: source.slice(0, offset).split('\n').length,
        ...sourceSentence(source, offset, offset + quote.length),
      });
    }
    locations.set(path, sources);
    if (sources.some((row) => row.context.trim() !== row.quote.trim())) {
      add(
        'warning',
        'SUMMARY_EVIDENCE_FRAGMENT',
        path,
        '引句只摘取了部分原句。请对照完整原句核对省略的否定、口述、推测或计划限定；有误时要求补齐引句并重做。',
      );
    }
    if (
      status === 'confirmed' &&
      sources.some((row) => qualified(row.context)) &&
      !qualified(statement)
    ) {
      add(
        'warning',
        'SUMMARY_CERTAINTY_ESCALATION',
        path,
        '原文含未知、推测或计划，这条总结却写为已确认。请核对是否把待查写成定论、计划写成完成。',
      );
    }
  }
  for (const path of targets.keys())
    if (!covered.has(path))
      add(
        'error',
        'SUMMARY_ASSERTION_UNGROUNDED',
        path,
        '这条进入后续上下文的断言没有依据，请补充原文与确定性分类或删除。',
      );
  add(
    'warning',
    'SUMMARY_SEMANTICS_REQUIRE_REVIEW',
    '/grounding',
    '引句位置与字段覆盖已核对，概括是否得到原文支持仍需作者逐条审阅，未执行完整语义证明。',
  );
  return { issues, locations };
}

/** Keep malformed provider evidence visible to validation instead of silently inventing coverage. */
export function preserveSummaryGrounding(value: unknown): ChapterSummaryGrounding | undefined {
  return value === undefined ? undefined : (value as ChapterSummaryGrounding);
}
