import type {
  NormalizeCandidateInput,
  NormalizedCandidate,
  NormalizedCandidateChange,
  NormalizedCandidateMode,
} from '../../types/normalizedCandidate';

type JsonObject = Record<string, unknown>;

interface SourceParagraph {
  text: string;
  start: number;
  end: number;
}

interface LocatedChange extends NormalizedCandidateChange {
  sourceStart: number;
  sourceEnd: number;
}

const FULL_TEXT_KEYS = [
  'chapterText', 'chapter_text', 'revisedContent', 'revised_content',
  'fullText', 'full_text', 'candidateText', 'candidate_text',
] as const;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(record: JsonObject, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function integerValue(record: JsonObject, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  }
  return undefined;
}

function unwrapJsonFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstLineEnd = trimmed.indexOf('\n');
  const withoutOpening = firstLineEnd >= 0 ? trimmed.slice(firstLineEnd + 1) : '';
  const closing = withoutOpening.lastIndexOf('```');
  return (closing >= 0 ? withoutOpening.slice(0, closing) : withoutOpening).trim();
}

function parseJsonObject(value: string | undefined): JsonObject | null {
  if (!value?.trim()) return null;
  const unfenced = unwrapJsonFence(value);
  const candidates = [unfenced];
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(unfenced.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = object(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // Continue with the next conservative extraction candidate.
    }
  }
  return null;
}

function hasCandidateShape(record: JsonObject | null): record is JsonObject {
  if (!record) return false;
  return [
    'mode', 'revisionMode', 'revision_mode', 'revisionSummary', 'revision_summary',
    'changedRanges', 'changed_ranges', ...FULL_TEXT_KEYS,
  ].some((key) => key in record);
}

function looksLikeStructuredResponse(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('```json') || trimmed.startsWith('```JSON')) return true;
  const unfenced = unwrapJsonFence(value);
  return unfenced.startsWith('{') || unfenced.startsWith('[');
}

export function isStructuredCandidateText(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const unfenced = unwrapJsonFence(value);
  try {
    const parsed = JSON.parse(unfenced);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

function sourceParagraphs(value: string): SourceParagraph[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const paragraphs: SourceParagraph[] = [];
  const matcher = /(?:^|\n{2,})([^]*?)(?=\n{2,}|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(normalized)) !== null) {
    const text = match[1];
    if (!text && matcher.lastIndex === normalized.length) break;
    const relative = match[0].lastIndexOf(text);
    const start = match.index + Math.max(0, relative);
    paragraphs.push({ text, start, end: start + text.length });
    if (matcher.lastIndex === match.index) matcher.lastIndex += 1;
  }
  return paragraphs;
}

function normalizeMode(payload: JsonObject | null): NormalizedCandidateMode {
  const raw = payload && stringValue(payload, ['mode', 'revisionMode', 'revision_mode']);
  return raw === 'targeted_fix' || raw === 'targeted-fix' || raw === 'conservative'
    ? 'targeted_fix'
    : 'full_rewrite';
}

function normalizeChanges(payload: JsonObject | null): NormalizedCandidateChange[] {
  if (!payload) return [];
  const raw = payload.changedRanges ?? payload.changed_ranges;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    const record = object(entry);
    if (!record) return [];
    const originalText = stringValue(record, ['before', 'originalText', 'original_text', 'sourceText', 'source_text']) ?? '';
    const revisedText = stringValue(record, ['after', 'revisedText', 'revised_text', 'replacementText', 'replacement_text']) ?? '';
    if (!originalText && !revisedText) return [];
    return [{
      id: `change-${index + 1}`,
      originalText,
      revisedText,
      summary: stringValue(record, ['reason', 'summary', 'description']),
      paragraphIndex: integerValue(record, ['paragraphIndex', 'paragraph_index']),
      startOffset: integerValue(record, ['startOffset', 'start_offset']),
      endOffset: integerValue(record, ['endOffset', 'end_offset']),
    }];
  });
}

function uniqueIndexOf(haystack: string, needle: string, from = 0, to = haystack.length): number | undefined {
  if (!needle) return undefined;
  const first = haystack.indexOf(needle, from);
  if (first < 0 || first + needle.length > to) return undefined;
  const second = haystack.indexOf(needle, first + Math.max(1, needle.length));
  if (second >= 0 && second + needle.length <= to) return undefined;
  return first;
}

function locateChange(change: NormalizedCandidateChange, source: string, paragraphs: SourceParagraph[]): LocatedChange | null {
  const startOffset = change.startOffset;
  const endOffset = change.endOffset;
  if (startOffset !== undefined && endOffset !== undefined
    && startOffset <= endOffset && endOffset <= source.length
    && source.slice(startOffset, endOffset) === change.originalText) {
    return { ...change, sourceStart: startOffset, sourceEnd: endOffset };
  }

  if (change.paragraphIndex !== undefined) {
    const paragraph = paragraphs[change.paragraphIndex];
    if (!paragraph) return null;
    if (!change.originalText && change.revisedText) {
      return { ...change, sourceStart: paragraph.end, sourceEnd: paragraph.end };
    }
    const within = uniqueIndexOf(source, change.originalText, paragraph.start, paragraph.end);
    if (within === undefined) return null;
    return { ...change, sourceStart: within, sourceEnd: within + change.originalText.length };
  }

  const global = uniqueIndexOf(source, change.originalText);
  if (global === undefined) return null;
  return { ...change, sourceStart: global, sourceEnd: global + change.originalText.length };
}

function paragraphIndexForOffset(paragraphs: SourceParagraph[], offset: number): number | undefined {
  const index = paragraphs.findIndex((paragraph) => offset >= paragraph.start && offset <= paragraph.end);
  return index >= 0 ? index : undefined;
}

function candidateParagraphIndex(fullText: string, revisedText: string, preferred?: number): number | undefined {
  const paragraphs = sourceParagraphs(fullText);
  if (preferred !== undefined && paragraphs[preferred]?.text.includes(revisedText)) return preferred;
  if (!revisedText) return preferred;
  const matches = paragraphs
    .map((paragraph, index) => paragraph.text.includes(revisedText) ? index : -1)
    .filter((index) => index >= 0);
  return matches.length === 1 ? matches[0] : preferred;
}

function rebuildFromChanges(baseContent: string, changes: NormalizedCandidateChange[]): {
  fullText?: string;
  changes: NormalizedCandidateChange[];
  error?: string;
} {
  if (!baseContent.trim()) return { changes, error: '缺少生成时冻结的章节正文，无法重建完整候选。' };
  if (changes.length === 0) return { changes, error: '结构化结果没有可用于重建正文的修改片段。' };
  const normalizedSource = baseContent.replace(/\r\n?/g, '\n');
  const paragraphs = sourceParagraphs(normalizedSource);
  const located = changes.map((change) => locateChange(change, normalizedSource, paragraphs));
  if (located.some((change) => !change)) {
    return { changes, error: '至少一处修改片段无法在冻结正文中唯一定位。' };
  }
  const ordered = (located as LocatedChange[]).sort((left, right) => right.sourceStart - left.sourceStart);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1].sourceStart < ordered[index].sourceEnd) {
      return { changes, error: '结构化结果包含相互重叠的修改片段。' };
    }
  }
  let fullText = normalizedSource;
  for (const change of ordered) {
    fullText = `${fullText.slice(0, change.sourceStart)}${change.revisedText}${fullText.slice(change.sourceEnd)}`;
  }
  const locatedInSourceOrder = [...ordered]
    .sort((left, right) => left.sourceStart - right.sourceStart)
    .map((change) => {
      const sourceParagraphIndex = change.paragraphIndex
        ?? paragraphIndexForOffset(paragraphs, change.sourceStart);
      return {
        ...change,
        paragraphIndex: sourceParagraphIndex,
        candidateParagraphIndex: candidateParagraphIndex(fullText, change.revisedText, sourceParagraphIndex),
      };
    });
  return { fullText, changes: locatedInSourceOrder };
}

function assignCandidateLocations(fullText: string, changes: NormalizedCandidateChange[]): NormalizedCandidateChange[] {
  return changes.map((change) => ({
    ...change,
    candidateParagraphIndex: candidateParagraphIndex(fullText, change.revisedText, change.paragraphIndex),
  }));
}

function paragraphTexts(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function deriveParagraphChanges(baseContent: string, fullText: string): NormalizedCandidateChange[] {
  if (!baseContent.trim() || baseContent.replace(/\r\n?/g, '\n') === fullText.replace(/\r\n?/g, '\n')) return [];
  const source = paragraphTexts(baseContent);
  const candidate = paragraphTexts(fullText);
  const changes: NormalizedCandidateChange[] = [];
  let sourceIndex = 0;
  let candidateIndex = 0;

  const append = (originalText: string, revisedText: string, summary: string) => {
    changes.push({
      id: `change-${changes.length + 1}`,
      originalText,
      revisedText,
      summary,
      paragraphIndex: sourceIndex < source.length ? sourceIndex : undefined,
      candidateParagraphIndex: candidateIndex < candidate.length ? candidateIndex : undefined,
    });
  };

  while (sourceIndex < source.length || candidateIndex < candidate.length) {
    const originalText = source[sourceIndex];
    const revisedText = candidate[candidateIndex];
    if (originalText === revisedText) {
      sourceIndex += 1;
      candidateIndex += 1;
      continue;
    }
    if (revisedText !== undefined && source[sourceIndex + 1] === revisedText) {
      append(originalText, '', '删除段落');
      sourceIndex += 1;
      continue;
    }
    if (originalText !== undefined && candidate[candidateIndex + 1] === originalText) {
      append('', revisedText, '新增段落');
      candidateIndex += 1;
      continue;
    }
    append(originalText ?? '', revisedText ?? '', originalText === undefined ? '新增段落' : revisedText === undefined ? '删除段落' : '调整段落');
    if (originalText !== undefined) sourceIndex += 1;
    if (revisedText !== undefined) candidateIndex += 1;
  }
  return changes;
}

function candidateChanges(
  fullText: string,
  changes: NormalizedCandidateChange[],
  baseContent: string | undefined,
): NormalizedCandidateChange[] {
  return changes.length > 0
    ? assignCandidateLocations(fullText, changes)
    : deriveParagraphChanges(baseContent ?? '', fullText);
}

function invalid(
  mode: NormalizedCandidateMode,
  status: 'format_error' | 'rebuild_error',
  rawResponse: string,
  changes: NormalizedCandidateChange[],
  error: string,
): NormalizedCandidate {
  return { mode, status, fullText: '', revisionSummary: undefined, changes, rawResponse, error, rebuiltFrom: 'unavailable' };
}

export function normalizeCandidate(input: NormalizeCandidateInput): NormalizedCandidate {
  const rawResponse = input.rawResponse ?? input.content ?? '';
  const structured = [
    object(input.structuredPayload),
    parseJsonObject(input.rawResponse),
    parseJsonObject(input.content),
  ].find(hasCandidateShape) ?? null;
  const mode = normalizeMode(structured);
  const revisionSummary = structured
    ? stringValue(structured, ['revisionSummary', 'revision_summary', 'summary'])
    : undefined;
  const changes = normalizeChanges(structured);
  const structuredFullText = structured ? stringValue(structured, FULL_TEXT_KEYS) : undefined;

  if (structuredFullText) {
    if (isStructuredCandidateText(structuredFullText)) {
      return invalid(mode, 'format_error', rawResponse, changes, '完整正文仍是结构化数据，无法作为小说正文审查。');
    }
    return {
      mode,
      status: 'ready',
      fullText: structuredFullText.replace(/\r\n?/g, '\n'),
      revisionSummary,
      changes: candidateChanges(structuredFullText, changes, input.baseContent),
      rawResponse,
      rebuiltFrom: 'structured_full_text',
    };
  }

  if (mode === 'targeted_fix' || changes.length > 0) {
    const rebuilt = rebuildFromChanges(input.baseContent ?? '', changes);
    if (!rebuilt.fullText) {
      return invalid('targeted_fix', 'rebuild_error', rawResponse, rebuilt.changes, rebuilt.error || '无法重建完整章节正文。');
    }
    return {
      mode: 'targeted_fix',
      status: 'ready',
      fullText: rebuilt.fullText,
      revisionSummary,
      changes: rebuilt.changes,
      rawResponse,
      rebuiltFrom: 'changed_ranges',
    };
  }

  const plainText = input.content?.trim() ? input.content : rawResponse;
  if (!plainText.trim() || structured || isStructuredCandidateText(plainText) || looksLikeStructuredResponse(plainText)) {
    return invalid(mode, 'format_error', rawResponse, changes, 'AI 返回格式异常，未找到可安全展示的完整章节正文。');
  }
  return {
    mode: 'full_rewrite',
    status: 'ready',
    fullText: plainText.replace(/\r\n?/g, '\n'),
    revisionSummary,
    changes: deriveParagraphChanges(input.baseContent ?? '', plainText),
    rawResponse,
    rebuiltFrom: 'plain_text',
  };
}

export function assertNormalizedCandidateReady(candidate: NormalizedCandidate): string {
  if (candidate.status !== 'ready' || !candidate.fullText.trim() || isStructuredCandidateText(candidate.fullText)) {
    throw new Error(candidate.error || '候选格式异常，禁止采用。');
  }
  return candidate.fullText;
}
