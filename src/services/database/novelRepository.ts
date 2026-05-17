/**
 * AI Novel Studio - 小说 Repository
 */
import type { Novel, CreateNovelInput, UpdateNovelInput } from '../../types/novel';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';
import { mockNovels } from '../../features/novels/mockNovels';
import {
  normalizeNovel,
  normalizeNovelsWithReport,
  type NovelNormalizeReport,
} from '../../features/novels/novelNormalizer';
import { toIsoDateOrNow } from '../../utils/date';

const NOVELS_KEY = 'ai_novel_studio_novels';

export interface NovelRepairResult {
  before: number;
  after: number;
  repairedCount: number;
  skippedCount: number;
  backupKey: string;
}

export interface NovelRepairSummary {
  repairedCount: number;
  skippedCount: number;
  totalCount: number;
}

let lastRepairSummary: NovelRepairSummary | null = null;

function buildSeedNovels(): Novel[] {
  const seed = mockNovels.map((n) => normalizeNovel({
    ...n,
    totalWordCount: n.totalWords ?? n.totalWordCount,
    targetWordCount: n.targetWords ?? n.targetWordCount,
  })).filter((n): n is Novel => n !== null);
  return seed;
}

function setRepairSummary(report: NovelNormalizeReport, totalCount: number) {
  if (report.repairedCount > 0 || report.skippedCount > 0) {
    lastRepairSummary = {
      repairedCount: report.repairedCount,
      skippedCount: report.skippedCount,
      totalCount,
    };
  } else {
    lastRepairSummary = null;
  }
}

function getLocalNovels(): Novel[] {
  const stored = lsGet<unknown>(NOVELS_KEY);
  const totalCount = Array.isArray(stored) ? stored.length : 0;
  const report = normalizeNovelsWithReport(stored);
  setRepairSummary(report, totalCount);

  if (report.items.length > 0) {
    if (report.repairedCount > 0 || report.skippedCount > 0 || !Array.isArray(stored)) {
      lsSet(NOVELS_KEY, report.items);
    }
    return report.items;
  }

  const seed = buildSeedNovels();
  lsSet(NOVELS_KEY, seed);
  return seed;
}

function saveLocalNovels(novels: Novel[]): void {
  lsSet(NOVELS_KEY, novels);
}

function createBackupKey(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${NOVELS_KEY}_backup_${stamp}`;
}

export const novelRepository = {
  async getAll(): Promise<Novel[]> {
    return dbCall<Novel[]>('get_all_novels', undefined, () => getLocalNovels());
  },

  async getById(id: string): Promise<Novel | null> {
    return dbCall<Novel | null>('get_novel_by_id', { id }, () => {
      const novels = getLocalNovels();
      return novels.find((n) => n.id === id) ?? null;
    });
  },

  getLastRepairSummary(): NovelRepairSummary | null {
    return lastRepairSummary;
  },

  async repairData(): Promise<NovelRepairResult> {
    const raw = lsGet<unknown>(NOVELS_KEY);
    const before = Array.isArray(raw) ? raw.length : 0;
    const backupKey = createBackupKey();
    if (raw != null) lsSet(backupKey, raw);

    const report = normalizeNovelsWithReport(raw);
    lsSet(NOVELS_KEY, report.items);
    setRepairSummary(report, before);

    return {
      before,
      after: report.items.length,
      repairedCount: report.repairedCount,
      skippedCount: report.skippedCount,
      backupKey,
    };
  },

  async create(input: CreateNovelInput): Promise<Novel> {
    return dbCall<Novel>('create_novel', { input }, () => {
      const novels = getLocalNovels();
      const now = nowISO();
      const novel: Novel = {
        id: generateId(),
        title: input.title,
        subtitle: input.subtitle,
        description: input.description ?? '',
        genre: input.genre || '未分类',
        coverPath: undefined,
        coverUrl: undefined,
        status: 'draft',
        totalWordCount: 0,
        totalWords: 0,
        targetWordCount: input.targetWordCount ?? 0,
        targetWords: input.targetWordCount ?? 0,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
        volumes: [],
      };
      const normalized = normalizeNovel(novel) ?? novel;
      novels.unshift(normalized);
      saveLocalNovels(novels);
      return normalized;
    });
  },

  async update(id: string, input: UpdateNovelInput): Promise<Novel | null> {
    return dbCall<Novel>('update_novel', { id, input }, () => {
      const novels = getLocalNovels();
      const idx = novels.findIndex((n) => n.id === id);
      if (idx === -1) return null as unknown as Novel;

      const updated: Novel = {
        ...novels[idx],
        ...input,
        totalWordCount: input.totalWordCount ?? novels[idx].totalWordCount,
        totalWords: input.totalWordCount ?? novels[idx].totalWords,
        targetWordCount: input.targetWordCount ?? novels[idx].targetWordCount,
        targetWords: input.targetWordCount ?? novels[idx].targetWords,
        updatedAt: toIsoDateOrNow(new Date()),
      };
      const normalized = normalizeNovel(updated) ?? updated;
      novels[idx] = normalized;
      saveLocalNovels(novels);
      return normalized;
    });
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_novel', { id }, () => {
      const novels = getLocalNovels().filter((n) => n.id !== id);
      saveLocalNovels(novels);
    });
  },
};
