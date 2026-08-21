import { characterService } from '../characters/characterService';
import { chapterRepository } from '../database/chapterRepository';
import { novelRepository } from '../database/novelRepository';
import { contextRecordService } from './contextRecordService';
import { chapterSummaryService } from './chapterSummaryService';
import type { ContextRecord } from '../../types/context';

export const CONTEXT_COMPRESSION_PROVIDER_ID = 'ans.novel-context.extractive-v1';
export const CONTEXT_COMPRESSION_PROVIDER_VERSION = '1.0.0';
export const CONTEXT_COMPRESSION_TITLE_PREFIX = '小说上下文压缩';
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4000;

export interface NovelContextCompressionConfig {
  tokenBudget: number;
}

export interface CoverageEvidence {
  characters: { required: string[]; present: string[]; missing: string[] };
  plot: { required: string[]; present: string[]; missing: string[] };
  foreshadow: { required: string[]; present: string[]; missing: string[] };
  timeline: { required: string[]; present: string[]; missing: string[] };
  rules: { required: string[]; present: string[]; missing: string[] };
  tokens: { budget: number; used: number; withinBudget: boolean };
}

export interface NovelContextCompressionCandidate {
  providerId: typeof CONTEXT_COMPRESSION_PROVIDER_ID;
  version: typeof CONTEXT_COMPRESSION_PROVIDER_VERSION;
  config: NovelContextCompressionConfig;
  novelId: string;
  sourceRevision: string;
  compressedText: string;
  coverage: CoverageEvidence;
  valid: boolean;
}

export interface AppliedContextCompression {
  recordId: string;
  novelId: string;
  sourceRevision: string;
  previousRecordId?: string;
}

function tokenCount(text: string): number {
  return [...text].length;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function presentIn(text: string, required: string[]): string[] {
  return required.filter((item) => item && text.includes(item));
}

function coverageBucket(text: string, required: string[]): CoverageEvidence['characters'] {
  const present = presentIn(text, required);
  return {
    required,
    present,
    missing: required.filter((item) => !present.includes(item)),
  };
}

function takeUntilBudget(parts: string[], budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    const cost = tokenCount(next) + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      const remaining = budget - used - (kept.length > 0 ? 1 : 0);
      if (remaining > 8) {
        kept.push(`${[...next].slice(0, remaining).join('').trimEnd()}…`);
      }
      break;
    }
    kept.push(next);
    used += cost;
  }
  return kept.join('\n');
}

function hashRevision(parts: string[]): string {
  const body = parts.join('|');
  let hash = 0;
  for (let index = 0; index < body.length; index += 1) {
    hash = (hash * 33 + body.charCodeAt(index)) >>> 0;
  }
  return `rev-${hash.toString(16).padStart(8, '0')}-${body.length}`;
}

function isCompressedRecord(record: ContextRecord): boolean {
  return record.title.startsWith(CONTEXT_COMPRESSION_TITLE_PREFIX);
}

export function isContextCompressionCandidate(
  value: unknown,
): value is NovelContextCompressionCandidate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.providerId === CONTEXT_COMPRESSION_PROVIDER_ID &&
    row.version === CONTEXT_COMPRESSION_PROVIDER_VERSION &&
    typeof row.novelId === 'string' &&
    typeof row.sourceRevision === 'string' &&
    typeof row.compressedText === 'string' &&
    typeof row.valid === 'boolean' &&
    row.coverage !== null &&
    typeof row.coverage === 'object'
  );
}

export const novelContextCompressionProvider = {
  describe() {
    return {
      providerId: CONTEXT_COMPRESSION_PROVIDER_ID,
      version: CONTEXT_COMPRESSION_PROVIDER_VERSION,
      config: { tokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET } satisfies NovelContextCompressionConfig,
    };
  },

  async propose(
    novelId: string,
    tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET,
  ): Promise<NovelContextCompressionCandidate> {
    const budget = Math.max(200, Math.min(tokenBudget, 20_000));
    const novel = await novelRepository.getById(novelId);
    if (!novel) {
      throw new Error(`作品 ${novelId} 不存在，无法压缩上下文。`);
    }
    const [characters, chapters, records, summaries] = await Promise.all([
      characterService.getByNovelId(novelId),
      chapterRepository.getByNovelId(novelId),
      contextRecordService.getByNovelId(novelId),
      chapterSummaryService.getByNovelId(novelId),
    ]);
    const characterNames = unique([
      novel.protagonistName ?? '',
      ...characters.map((character) => character.name),
    ]);
    const chapterTitles = unique(chapters.map((chapter) => chapter.title));
    const timeline = unique(
      [...chapters]
        .sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0))
        .map((chapter) => chapter.title),
    );
    const foreshadow = unique(
      records
        .filter((record) => record.contextType === 'foreshadow' && !isCompressedRecord(record))
        .map((record) => record.title),
    );
    const rules = unique(
      records
        .filter((record) => record.contextType === 'rule' && !isCompressedRecord(record))
        .map((record) => record.title),
    );
    const sourceRevision = hashRevision([
      novelId,
      novel.updatedAt,
      ...characterNames,
      ...chapterTitles,
      ...records.map((record) => `${record.id}:${record.updatedAt}`),
      ...summaries.map((summary) => `${summary.id}:${summary.updatedAt}`),
    ]);
    const parts = [
      `【作品】${novel.title}${novel.genre ? ` · ${novel.genre}` : ''}`,
      novel.description ? `简介：${novel.description}` : '',
      novel.protagonistName ? `主角：${novel.protagonistName}` : '',
      characterNames.length > 0 ? `人物：${characterNames.join('、')}` : '',
      timeline.length > 0 ? `时间线：${timeline.join(' → ')}` : '',
      ...chapters.map((chapter) =>
        chapter.outline ? `章《${chapter.title}》：${chapter.outline}` : `章《${chapter.title}》`,
      ),
      ...records
        .filter((record) => !isCompressedRecord(record))
        .sort((left, right) => right.importance - left.importance)
        .map((record) => `${record.contextType}《${record.title}》：${record.content}`),
      ...summaries.map((summary) => `总结《${summary.chapterId}》：${summary.summary}`),
    ];
    const compressedText = takeUntilBudget(parts, budget);
    const coverage: CoverageEvidence = {
      characters: coverageBucket(compressedText, characterNames),
      plot: coverageBucket(compressedText, chapterTitles),
      foreshadow: coverageBucket(compressedText, foreshadow),
      timeline: coverageBucket(compressedText, timeline),
      rules: coverageBucket(compressedText, rules),
      tokens: {
        budget,
        used: tokenCount(compressedText),
        withinBudget: tokenCount(compressedText) <= budget,
      },
    };
    const valid =
      coverage.tokens.withinBudget &&
      coverage.characters.missing.length === 0 &&
      coverage.plot.missing.length === 0 &&
      coverage.foreshadow.missing.length === 0 &&
      coverage.timeline.missing.length === 0 &&
      coverage.rules.missing.length === 0;
    return {
      providerId: CONTEXT_COMPRESSION_PROVIDER_ID,
      version: CONTEXT_COMPRESSION_PROVIDER_VERSION,
      config: { tokenBudget: budget },
      novelId,
      sourceRevision,
      compressedText,
      coverage,
      valid,
    };
  },

  async apply(candidate: NovelContextCompressionCandidate): Promise<AppliedContextCompression> {
    if (!candidate.valid) {
      throw new Error('压缩候选未通过覆盖率或 token 预算校验，不能应用。');
    }
    const existing = (await contextRecordService.getByNovelId(candidate.novelId)).filter(
      isCompressedRecord,
    );
    const previous = existing.find((record) => record.isActive);
    const record = await contextRecordService.create({
      novelId: candidate.novelId,
      contextType: 'plot_progress',
      title: `${CONTEXT_COMPRESSION_TITLE_PREFIX} ${candidate.version} ${candidate.sourceRevision}`,
      content: JSON.stringify(candidate),
      importance: 5,
      isActive: true,
      contentHash: candidate.sourceRevision,
    });
    if (previous && previous.id !== record.id) {
      await contextRecordService.setActive(previous.id, false);
    }
    return {
      recordId: record.id,
      novelId: candidate.novelId,
      sourceRevision: candidate.sourceRevision,
      previousRecordId: previous?.id,
    };
  },

  async rollback(applied: AppliedContextCompression): Promise<void> {
    await contextRecordService.setActive(applied.recordId, false);
    if (applied.previousRecordId) {
      await contextRecordService.setActive(applied.previousRecordId, true);
    }
  },
};
