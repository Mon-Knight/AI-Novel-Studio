/**
 * Host chapter-candidate word-range policy.
 *
 * Acceptance bounds are percentages of the chapter targetWordCount. Defaults
 * match the historical Writer/SubAgent hard window (80%–115%). Repair bands
 * stay relative to the target and are clamped inside the hard window.
 */
export const CHAPTER_WORD_RANGE_STORAGE_KEY = 'ai_novel_studio_chapter_word_range';

export const CHAPTER_WORD_RANGE_PERCENT_LIMITS = {
  hardMinimumPercent: { min: 50, max: 100 },
  hardMaximumPercent: { min: 100, max: 200 },
} as const;

export interface ChapterWordRangePercents {
  hardMinimumPercent: number;
  hardMaximumPercent: number;
}

export const DEFAULT_CHAPTER_WORD_RANGE_PERCENTS: ChapterWordRangePercents = {
  hardMinimumPercent: 80,
  hardMaximumPercent: 115,
};

export type ChapterWordRange = {
  target: number;
  minimum: number;
  maximum: number;
  fallbackMinimum: number;
  fallbackMaximum: number;
  finalMinimum: number;
  finalMaximum: number;
  hardMinimum: number;
  hardMaximum: number;
};

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function band(target: number, percent: number): number {
  return Math.max(1, Math.floor((target * percent) / 100));
}

export function normalizeChapterWordRangePercents(raw: unknown): ChapterWordRangePercents {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const minRaw = Number(source.hardMinimumPercent);
  const maxRaw = Number(source.hardMaximumPercent);
  const hardMinimumPercent = clampInteger(
    Number.isFinite(minRaw)
      ? Math.round(minRaw)
      : DEFAULT_CHAPTER_WORD_RANGE_PERCENTS.hardMinimumPercent,
    CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMinimumPercent.min,
    CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMinimumPercent.max,
  );
  const hardMaximumPercent = clampInteger(
    Number.isFinite(maxRaw)
      ? Math.round(maxRaw)
      : DEFAULT_CHAPTER_WORD_RANGE_PERCENTS.hardMaximumPercent,
    CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMaximumPercent.min,
    CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMaximumPercent.max,
  );
  return { hardMinimumPercent, hardMaximumPercent };
}

export function resolveChapterWordRange(
  targetWordCount: number | undefined,
  percents: ChapterWordRangePercents = DEFAULT_CHAPTER_WORD_RANGE_PERCENTS,
): ChapterWordRange | undefined {
  if (!Number.isFinite(targetWordCount) || (targetWordCount ?? 0) <= 0) return undefined;
  const target = Math.round(targetWordCount!);
  const normalized = normalizeChapterWordRangePercents(percents);
  const hardMinimum = band(target, normalized.hardMinimumPercent);
  const hardMaximum = Math.max(hardMinimum, band(target, normalized.hardMaximumPercent));
  const clamp = (value: number) => Math.min(hardMaximum, Math.max(hardMinimum, value));
  return {
    target,
    // Repair toward a deliberately tighter range, so normal model variance
    // still lands below the final hard ceiling without truncating the ending.
    minimum: clamp(band(target, 90)),
    maximum: clamp(band(target, 105)),
    // If the first repair still misses the hard ceiling, the final retry needs
    // enough headroom for normal model variance to converge deterministically.
    fallbackMinimum: clamp(band(target, 85)),
    fallbackMaximum: clamp(band(target, 95)),
    // A rare third pass is cheaper than discarding an otherwise valid full
    // chapter when a provider repeatedly overshoots by only a small margin.
    finalMinimum: clamp(band(target, 80)),
    finalMaximum: clamp(band(target, 90)),
    hardMinimum,
    hardMaximum,
  };
}

function readStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}

export function getChapterWordRangePercents(): ChapterWordRangePercents {
  const storage = readStorage();
  if (!storage) return { ...DEFAULT_CHAPTER_WORD_RANGE_PERCENTS };
  try {
    const raw = storage.getItem(CHAPTER_WORD_RANGE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHAPTER_WORD_RANGE_PERCENTS };
    return normalizeChapterWordRangePercents(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CHAPTER_WORD_RANGE_PERCENTS };
  }
}

export function saveChapterWordRangePercents(
  input: ChapterWordRangePercents,
): ChapterWordRangePercents {
  const normalized = normalizeChapterWordRangePercents(input);
  const storage = readStorage();
  if (storage) {
    storage.setItem(CHAPTER_WORD_RANGE_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}
