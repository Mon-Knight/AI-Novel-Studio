/**
 * AI Novel Studio - Novel 数据归一化
 */
import type { Novel, NovelStatus } from '../../types/novel';
import { generateId, nowISO } from '../../services/database/db';
import { isPlainObject, toSafeNumber, toSafeString } from '../../utils/dataGuard';
import { toValidDate } from '../../utils/date';

export interface NovelNormalizeReport {
  items: Novel[];
  repairedCount: number;
  skippedCount: number;
}

const VALID_STATUS: NovelStatus[] = [
  'draft', 'planning', 'writing', 'paused', 'completed', 'archived',
];

function normalizeDate(value: unknown): string | null {
  const date = toValidDate(value);
  return date ? date.toISOString() : null;
}

function resolveTitle(raw: Record<string, unknown>, mark: () => void): string {
  if (typeof raw.title === 'string' && raw.title.trim()) return raw.title.trim();
  if (typeof raw.name === 'string' && raw.name.trim()) {
    mark();
    return raw.name.trim();
  }
  if (typeof raw.novelName === 'string' && raw.novelName.trim()) {
    mark();
    return raw.novelName.trim();
  }
  mark();
  return '未命名作品';
}

function resolveGenre(raw: Record<string, unknown>, mark: () => void): string {
  if (typeof raw.genre === 'string' && raw.genre.trim()) return raw.genre.trim();
  if (typeof raw.category === 'string' && raw.category.trim()) {
    mark();
    return raw.category.trim();
  }
  mark();
  return '未分类';
}

function normalizeNovelInternal(raw: unknown): { novel: Novel | null; repaired: boolean } {
  if (!isPlainObject(raw)) return { novel: null, repaired: false };
  let repaired = false;
  const mark = () => { repaired = true; };

  const now = nowISO();
  const id = typeof raw.id === 'string' && raw.id ? raw.id : (mark(), generateId());
  const title = resolveTitle(raw, mark);
  const genre = resolveGenre(raw, mark);

  const description = typeof raw.description === 'string' ? raw.description : (raw.description == null ? '' : (mark(), toSafeString(raw.description, '')));
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : undefined;
  const coverPath = typeof raw.coverPath === 'string' ? raw.coverPath : undefined;
  const coverUrl = typeof raw.coverUrl === 'string' ? raw.coverUrl : undefined;
  const status = VALID_STATUS.includes(raw.status as NovelStatus) ? raw.status as NovelStatus : (mark(), 'draft');

  const totalWordCountSource = raw.totalWordCount ?? raw.totalWords ?? raw.wordCount;
  const totalWordCount = toSafeNumber(totalWordCountSource, 0);
  if (raw.totalWordCount == null && (raw.totalWords != null || raw.wordCount != null)) mark();
  if (!Number.isFinite(totalWordCount)) mark();

  const targetWordCountSource = raw.targetWordCount ?? raw.targetWords;
  const targetWordCount = toSafeNumber(targetWordCountSource, 0);
  if (raw.targetWordCount == null && raw.targetWords != null) mark();
  if (!Number.isFinite(targetWordCount)) mark();

  const chapterCountSource = raw.chapterCount ?? raw.chapterTotal ?? raw.chapterNum;
  const chapterCount = toSafeNumber(chapterCountSource, 0);
  if (raw.chapterCount == null && chapterCountSource != null) mark();

  const volumeCountSource = raw.volumeCount ?? raw.volumeTotal ?? raw.volumeNum;
  const volumeCount = toSafeNumber(volumeCountSource, 0);
  if (raw.volumeCount == null && volumeCountSource != null) mark();

  const createdAtRaw = normalizeDate(raw.createdAt);
  const updatedAtRaw = normalizeDate(raw.updatedAt);
  const legacyUpdated = normalizeDate(raw.lastUpdatedAt) ?? normalizeDate(raw.lastEditedAt);
  const createdAt = createdAtRaw ?? (mark(), now);
  const updatedAt = updatedAtRaw ?? legacyUpdated ?? createdAt ?? (mark(), now);
  if (!createdAtRaw) mark();
  if (!updatedAtRaw) mark();
  if (!updatedAtRaw && legacyUpdated) mark();

  const lastOpenedAt = normalizeDate(raw.lastOpenedAt) ?? undefined;
  const deletedAt = normalizeDate(raw.deletedAt) ?? undefined;

  const currentVolumeId = typeof raw.currentVolumeId === 'string' ? raw.currentVolumeId : undefined;
  const currentChapterId = typeof raw.currentChapterId === 'string' ? raw.currentChapterId : undefined;

  const volumes = Array.isArray(raw.volumes) ? raw.volumes : (raw.volumes ? (mark(), []) : []);

  const normalized: Novel = {
    id,
    title,
    subtitle,
    description,
    genre,
    coverPath,
    coverUrl,
    status,
    currentVolumeId,
    currentChapterId,
    totalWordCount,
    totalWords: totalWordCount,
    targetWordCount,
    targetWords: targetWordCount,
    chapterCount,
    volumeCount,
    lastOpenedAt,
    createdAt,
    updatedAt,
    deletedAt,
    volumes,
  };

  return { novel: normalized, repaired };
}

export function normalizeNovel(raw: unknown): Novel | null {
  return normalizeNovelInternal(raw).novel;
}

export function normalizeNovels(raw: unknown): Novel[] {
  return normalizeNovelsWithReport(raw).items;
}

export function normalizeNovelsWithReport(raw: unknown): NovelNormalizeReport {
  const list = Array.isArray(raw) ? raw : [];
  let repairedCount = 0;
  let skippedCount = 0;
  const items: Novel[] = [];
  for (const item of list) {
    const { novel, repaired } = normalizeNovelInternal(item);
    if (!novel) {
      skippedCount += 1;
      continue;
    }
    if (repaired) repairedCount += 1;
    items.push(novel);
  }
  return { items, repairedCount, skippedCount };
}
