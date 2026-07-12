import type { ChapterDiffBlock, ChapterDiffInput, ChapterDiffResult } from '../../types/chapterDiff';
import { computeContentSha256 } from '../../utils/contentIntegrity';

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function paragraphs(value: string): string[] {
  const normalized = normalizeLineEndings(value);
  if (normalized === '') return [];
  return normalized.split(/\n{2,}/u);
}

function displayText(value: string): string {
  return /(?:api[_ -]?key\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|system\s+prompt)/i.test(value)
    || /(?:系统提示词|忽略之前指令|以下是章节正文|内部 JSON)/.test(value)
    ? '[REDACTED SENSITIVE PARAGRAPH]'
    : value;
}

function indexByText(values: string[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  values.forEach((value, offset) => {
    const positions = index.get(value) || [];
    positions.push(offset);
    index.set(value, positions);
  });
  return index;
}

function firstAtOrAfter(index: Map<string, number[]>, value: string, at: number): number | undefined {
  return index.get(value)?.find((position) => position >= at);
}

export async function calculateChapterDiff(input: ChapterDiffInput): Promise<ChapterDiffResult> {
  if (input.novelId !== input.candidateNovelId || input.chapterId !== input.candidateChapterId
    || input.baseDraftId !== input.candidateSourceDraftId
    || input.baseDraftVersion !== input.candidateSourceDraftVersion
    || input.baseContentHash !== input.candidateBaseContentHash) {
    return { status: 'blocked', blocks: [], reason: 'Artifact source baseline does not match the selected chapter.' };
  }
  if ((await computeContentSha256(input.baseContent)) !== input.baseContentHash) {
    return { status: 'blocked', blocks: [], reason: 'Base draft content hash no longer matches the Artifact baseline.' };
  }
  const base = paragraphs(input.baseContent);
  const candidate = paragraphs(input.candidateContent);
  const baseIndex = indexByText(base);
  const candidateIndex = indexByText(candidate);
  const blocks: ChapterDiffBlock[] = [];
  let left = 0;
  let right = 0;
  while (left < base.length || right < candidate.length) {
    if (left < base.length && right < candidate.length && base[left] === candidate[right]) {
      blocks.push({ kind: 'unchanged', baseIndex: left, candidateIndex: right, baseText: displayText(base[left]), candidateText: displayText(candidate[right]) });
      left += 1; right += 1;
      continue;
    }
    if (left >= base.length) {
      blocks.push({ kind: 'added', candidateIndex: right, candidateText: displayText(candidate[right]) }); right += 1; continue;
    }
    if (right >= candidate.length) {
      blocks.push({ kind: 'removed', baseIndex: left, baseText: displayText(base[left]) }); left += 1; continue;
    }
    const nextInCandidate = firstAtOrAfter(candidateIndex, base[left], right + 1);
    const nextInBase = firstAtOrAfter(baseIndex, candidate[right], left + 1);
    if (nextInCandidate !== undefined && (nextInBase === undefined || nextInCandidate - right <= nextInBase - left)) {
      blocks.push({ kind: 'added', candidateIndex: right, candidateText: displayText(candidate[right]) }); right += 1; continue;
    }
    if (nextInBase !== undefined) {
      blocks.push({ kind: 'removed', baseIndex: left, baseText: displayText(base[left]) }); left += 1; continue;
    }
    blocks.push({ kind: 'modified', baseIndex: left, candidateIndex: right, baseText: displayText(base[left]), candidateText: displayText(candidate[right]) });
    left += 1; right += 1;
  }
  const count = (kind: ChapterDiffBlock['kind']) => blocks.filter((block) => block.kind === kind).length;
  return {
    status: 'ready',
    blocks,
    summary: {
      baseDraftId: input.baseDraftId,
      baseDraftVersion: input.baseDraftVersion,
      baseContentHash: input.baseContentHash,
      candidateArtifactId: input.candidateArtifactId,
      addedBlocks: count('added'),
      removedBlocks: count('removed'),
      modifiedBlocks: count('modified'),
      unchangedBlocks: count('unchanged'),
      baseCharacterCount: Array.from(input.baseContent).length,
      candidateCharacterCount: Array.from(input.candidateContent).length,
      characterDelta: Array.from(input.candidateContent).length - Array.from(input.baseContent).length,
    },
  };
}
