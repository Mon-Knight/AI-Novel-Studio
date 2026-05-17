/**
 * AI Novel Studio - 小说 Repository
 */
import type { Novel, CreateNovelInput, UpdateNovelInput } from '../../types/novel';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';
import { mockNovels } from '../../features/novels/mockNovels';

const NOVELS_KEY = 'ai_novel_studio_novels';

function normalizeNovel(raw: any): Novel | null {
  if (!raw || typeof raw !== 'object') return null;
  const now = nowISO();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    title: typeof raw.title === 'string' && raw.title ? raw.title : '未命名作品',
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    genre: typeof raw.genre === 'string' && raw.genre ? raw.genre : '未分类',
    coverPath: typeof raw.coverPath === 'string' ? raw.coverPath : undefined,
    coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : undefined,
    status: isValidStatus(raw.status) ? raw.status : 'draft',
    currentVolumeId: typeof raw.currentVolumeId === 'string' ? raw.currentVolumeId : undefined,
    currentChapterId: typeof raw.currentChapterId === 'string' ? raw.currentChapterId : undefined,
    totalWordCount: safeNumber(raw.totalWordCount),
    totalWords: safeNumber(raw.totalWords),
    targetWordCount: safeNumber(raw.targetWordCount),
    targetWords: safeNumber(raw.targetWords),
    lastOpenedAt: safeDate(raw.lastOpenedAt) || undefined,
    createdAt: safeDate(raw.createdAt) || now,
    updatedAt: safeDate(raw.updatedAt) || safeDate(raw.createdAt) || now,
    deletedAt: safeDate(raw.deletedAt) || undefined,
    volumes: Array.isArray(raw.volumes) ? raw.volumes : [],
  } as Novel;
}

function isValidStatus(s: unknown): s is string {
  const valid = ['draft', 'planning', 'writing', 'paused', 'completed', 'archived'];
  return typeof s === 'string' && valid.includes(s);
}

function safeNumber(v: unknown): number {
  if (typeof v === 'number' && !isNaN(v)) return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function safeDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeNovels(list: any[]): Novel[] {
  return list.map(normalizeNovel).filter((n): n is Novel => n !== null);
}

function getLocalNovels(): Novel[] {
  const stored = lsGet<any[]>(NOVELS_KEY);
  if (stored && Array.isArray(stored)) {
    const normalized = normalizeNovels(stored);
    // 如果有修复，写回
    if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
      lsSet(NOVELS_KEY, normalized);
    }
    if (normalized.length > 0) return normalized;
  }
  // 首次使用或全部数据损坏，用 mock 种子
  const seed = mockNovels.map((n) => normalizeNovel({
    ...n,
    totalWordCount: n.totalWords,
    targetWordCount: n.targetWords,
    totalWords: n.totalWords,
    targetWords: n.targetWords,
  })).filter((n): n is Novel => n !== null);
  lsSet(NOVELS_KEY, seed);
  return seed;
}

function saveLocalNovels(novels: Novel[]): void {
  lsSet(NOVELS_KEY, novels);
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

  async repairData(): Promise<{ before: number; after: number }> {
    const raw = lsGet<any[]>(NOVELS_KEY);
    const before = Array.isArray(raw) ? raw.length : 0;
    // 备份原始数据
    if (raw) lsSet(NOVELS_KEY + '_backup', raw);
    const normalized = normalizeNovels(Array.isArray(raw) ? raw : []);
    lsSet(NOVELS_KEY, normalized);
    return { before, after: normalized.length };
  },

  async create(input: CreateNovelInput): Promise<Novel> {
    return dbCall<Novel>('create_novel', { input }, () => {
      const novels = getLocalNovels();
      const now = nowISO();
      const novel: Novel = {
        id: generateId(),
        title: input.title,
        subtitle: input.subtitle,
        description: input.description,
        genre: input.genre,
        coverPath: undefined,
        coverUrl: undefined,
        status: 'draft',
        totalWordCount: 0,
        totalWords: 0,
        targetWordCount: input.targetWordCount,
        targetWords: input.targetWordCount ?? 0,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
        volumes: [],
      };
      novels.unshift(novel);
      saveLocalNovels(novels);
      return novel;
    });
  },

  async update(id: string, input: UpdateNovelInput): Promise<Novel | null> {
    return dbCall<Novel>('update_novel', { id, input }, () => {
      const novels = getLocalNovels();
      const idx = novels.findIndex((n) => n.id === id);
      if (idx === -1) return null as unknown as Novel;

      const now = nowISO();
      const updated: Novel = {
        ...novels[idx],
        ...input,
        totalWordCount: input.totalWordCount ?? novels[idx].totalWordCount,
        totalWords: input.totalWordCount ?? novels[idx].totalWords,
        targetWords: input.targetWordCount ?? novels[idx].targetWords,
        targetWordCount: input.targetWordCount ?? novels[idx].targetWordCount,
        updatedAt: now,
      };
      novels[idx] = updated;
      saveLocalNovels(novels);
      return updated;
    });
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_novel', { id }, () => {
      const novels = getLocalNovels().filter((n) => n.id !== id);
      saveLocalNovels(novels);
    });
  },
};
