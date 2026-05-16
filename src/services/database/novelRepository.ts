/**
 * AI Novel Studio - 小说 Repository
 */
import type { Novel, CreateNovelInput, UpdateNovelInput } from '../../types/novel';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';
import { mockNovels } from '../../features/novels/mockNovels';

const NOVELS_KEY = 'ai_novel_studio_novels';

function getLocalNovels(): Novel[] {
  const stored = lsGet<Novel[]>(NOVELS_KEY);
  if (stored) return stored;
  // 首次使用，用 mock 数据初始化（保留 v0.1.0 兼容）
  const seed = mockNovels.map((n) => ({
    ...n,
    subtitle: undefined as string | undefined,
    coverPath: undefined as string | undefined,
    totalWordCount: n.totalWords,
    targetWordCount: n.targetWords,
    totalWords: n.totalWords,
    targetWords: n.targetWords,
    lastOpenedAt: undefined as string | undefined,
    deletedAt: undefined as string | undefined,
  }));
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
