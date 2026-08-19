export const CHAPTER_AI_SEGMENT_MAX_CHARS = 7_000;
const CONTEXT_CHARS = 400;

export interface ChapterTextSegment {
  index: number;
  total: number;
  startOffset: number;
  endOffset: number;
  paragraphStart: number;
  text: string;
  previousContext: string;
  nextContext: string;
  joinWithNext: string;
}

function chooseSegmentEnd(text: string, start: number, maxChars: number): number {
  const hardEnd = Math.min(text.length, start + maxChars);
  if (hardEnd === text.length) return hardEnd;
  const minimumEnd = start + Math.floor(maxChars * 0.6);
  const window = text.slice(minimumEnd, hardEnd);
  const boundaries = ['\n\n', '\n', '。', '！', '？', '.', '!', '?'];
  for (const boundary of boundaries) {
    const offset = window.lastIndexOf(boundary);
    if (offset >= 0) return minimumEnd + offset + boundary.length;
  }
  return hardEnd;
}

function paragraphBoundaryOffsets(text: string): number[] {
  const offsets: number[] = [];
  const pattern = /\n\s*\n/g;
  while (pattern.exec(text) !== null) offsets.push(pattern.lastIndex);
  return offsets;
}

export function splitChapterText(
  text: string,
  maxChars = CHAPTER_AI_SEGMENT_MAX_CHARS,
): ChapterTextSegment[] {
  if (!Number.isInteger(maxChars) || maxChars < 500) {
    throw new Error('章节 AI 分段上限必须是不小于 500 的整数。');
  }
  if (!text) return [];

  const raw: Array<Omit<ChapterTextSegment, 'index' | 'total'>> = [];
  const paragraphBoundaries = paragraphBoundaryOffsets(text);
  let paragraphStart = 0;
  let startOffset = 0;
  while (startOffset < text.length) {
    while (paragraphBoundaries[paragraphStart] <= startOffset) paragraphStart += 1;
    const endOffset = chooseSegmentEnd(text, startOffset, maxChars);
    if (endOffset <= startOffset) throw new Error('章节 AI 分段未能向前推进。');
    const segmentText = text.slice(startOffset, endOffset);
    const trailingNewlines = segmentText.match(/\n+$/)?.[0] ?? '';
    raw.push({
      startOffset,
      endOffset,
      paragraphStart,
      text: segmentText,
      previousContext: text.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset),
      nextContext: text.slice(endOffset, Math.min(text.length, endOffset + CONTEXT_CHARS)),
      joinWithNext: trailingNewlines,
    });
    startOffset = endOffset;
  }

  if (raw.map((segment) => segment.text).join('') !== text) {
    throw new Error('章节 AI 分段未完整覆盖原文。');
  }
  return raw.map((segment, index) => ({
    ...segment,
    index,
    total: raw.length,
  }));
}

export function mergePolishedSegments(
  sourceText: string,
  segments: ChapterTextSegment[],
  outputs: string[],
): string {
  if (segments.length === 0 || outputs.length !== segments.length) {
    throw new Error('章节润色分段结果数量不完整。');
  }
  if (segments.map((segment) => segment.text).join('') !== sourceText) {
    throw new Error('章节润色分段来源与原文不一致。');
  }
  const normalized = outputs.map((output, index) => {
    const text = output.trim();
    if (!text) throw new Error(`章节润色第 ${index + 1} 段返回为空。`);
    const sourceLength = segments[index].text.trim().length;
    if (sourceLength >= 500 && text.length < Math.floor(sourceLength * 0.5)) {
      throw new Error(`章节润色第 ${index + 1} 段结果异常过短。`);
    }
    return text;
  });
  const merged = normalized
    .map(
      (output, index) =>
        output + (index < normalized.length - 1 ? segments[index].joinWithNext : ''),
    )
    .join('')
    .trim();
  if (!merged) throw new Error('章节润色合并结果为空。');
  return merged;
}
