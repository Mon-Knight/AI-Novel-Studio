/**
 * AI Novel Studio - 章节 Repository
 */
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';

const CHAPTERS_KEY = 'ai_novel_studio_chapters';

type ChapterRecord = Partial<Chapter> & {
  novel_id?: string;
  volume_id?: string | null;
  chapter_number?: number;
  order_index?: number;
  sort_order?: number;
  adopted_draft_id?: string;
  word_count?: number;
  current_words?: number;
  target_word_count?: number | null;
  target_words?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
};

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeChapter(raw: unknown): Chapter | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as ChapterRecord;
  const id = typeof item.id === 'string' ? item.id : '';
  const novelId = typeof item.novelId === 'string' ? item.novelId : item.novel_id;
  const title = typeof item.title === 'string' ? item.title : '';
  if (!id || !novelId || !title) return null;

  const orderIndex = toNumber(item.orderIndex ?? item.order_index, 0);
  const wordCount = toNumber(item.wordCount ?? item.word_count, 0);
  // v1.0.37: 不再强制默认4000，允许undefined以支持输出控制方案覆盖
  const rawTarget = item.targetWordCount ?? item.target_word_count;
  const targetWordCount = (typeof rawTarget === 'number' && rawTarget > 0) ? rawTarget : undefined;
  const now = nowISO();

  return {
    id,
    novelId,
    volumeId: item.volumeId ?? item.volume_id ?? undefined,
    title,
    outline: item.outline ?? '',
    goal: item.goal ?? '',
    chapterNumber: toNumber(item.chapterNumber ?? item.chapter_number, orderIndex + 1),
    orderIndex,
    sortOrder: toNumber(item.sortOrder ?? item.sort_order, orderIndex),
    status: item.status ?? 'not_started',
    adoptedDraftId: item.adoptedDraftId ?? item.adopted_draft_id ?? undefined,
    wordCount,
    currentWords: toNumber(item.currentWords ?? item.current_words, wordCount),
    targetWordCount,
    targetWords: toNumber(item.targetWords ?? item.target_words, targetWordCount ?? 0),
    drafts: Array.isArray(item.drafts) ? item.drafts : [],
    summary: item.summary,
    createdAt: item.createdAt ?? item.created_at ?? now,
    updatedAt: item.updatedAt ?? item.updated_at ?? now,
    deletedAt: item.deletedAt ?? item.deleted_at,
  };
}

function normalizeChapters(items: unknown): Chapter[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeChapter)
    .filter((item): item is Chapter => item !== null)
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

function getLocalChapters(): Chapter[] {
  const chapters = normalizeChapters(lsGet<unknown>(CHAPTERS_KEY));
  lsSet(CHAPTERS_KEY, chapters);
  return chapters;
}

function saveLocalChapters(items: Chapter[]): void {
  lsSet(CHAPTERS_KEY, items);
}

export const chapterRepository = {
  async getByNovelId(novelId: string): Promise<Chapter[]> {
    const items = await dbCall<unknown[]>('get_chapters_by_novel_id', { novelId }, () =>
      getLocalChapters().filter((ch) => ch.novelId === novelId).sort((a, b) => a.orderIndex - b.orderIndex),
    );
    const chapters = normalizeChapters(items);
    console.info(`[chapterService] listChaptersByNovelId novelId=${novelId} count=${chapters.length}`);
    return chapters;
  },

  async getByVolumeId(volumeId: string): Promise<Chapter[]> {
    const items = await dbCall<unknown[]>('get_chapters_by_volume_id', { volumeId }, () =>
      getLocalChapters().filter((ch) => ch.volumeId === volumeId).sort((a, b) => a.orderIndex - b.orderIndex),
    );
    return normalizeChapters(items);
  },

  async getById(id: string): Promise<Chapter | null> {
    const item = await dbCall<unknown | null>('get_chapter_by_id', { id }, () =>
      getLocalChapters().find((ch) => ch.id === id) ?? null,
    );
    return normalizeChapter(item);
  },

  async create(input: CreateChapterInput): Promise<Chapter> {
    console.info(`[chapterService] createChapter input novelId=${input.novelId} volumeId=${input.volumeId ?? ''} title=${input.title}`);
    const before = await chapterRepository.getByNovelId(input.novelId);
    const siblings = before.filter((ch) => (ch.volumeId ?? '') === (input.volumeId ?? ''));
    const maxOrder = siblings.reduce((max, ch) => Math.max(max, ch.orderIndex), -1);
    // v1.0.37: 不强制设默认4000，允许从输出控制方案继承
    const preparedInput = {
      ...input,
      title: input.title.trim(),
      outline: input.outline ?? '',
      goal: input.goal ?? '',
      orderIndex: input.orderIndex ?? maxOrder + 1,
      targetWordCount: input.targetWordCount,
    };
    console.info(`[chapterService] before save count=${before.length}`);

    const createdRaw = await dbCall<unknown>('create_chapter', { input: preparedInput }, () => {
      const items = getLocalChapters();
      const now = nowISO();
      const status = preparedInput.outline ? 'outline_ready' : 'not_started';
      const chapter: Chapter = {
        id: generateId(),
        novelId: preparedInput.novelId,
        volumeId: preparedInput.volumeId,
        title: preparedInput.title,
        outline: preparedInput.outline,
        goal: preparedInput.goal,
        chapterNumber: preparedInput.orderIndex + 1,
        orderIndex: preparedInput.orderIndex,
        sortOrder: preparedInput.orderIndex,
        status: status as Chapter['status'],
        wordCount: 0,
        currentWords: 0,
        targetWordCount: preparedInput.targetWordCount,
        targetWords: preparedInput.targetWordCount ?? 0,
        drafts: [],
        createdAt: now,
        updatedAt: now,
      };
      items.push(chapter);
      saveLocalChapters(items);
      return chapter;
    });
    const created = normalizeChapter(createdRaw);
    if (!created?.id) throw new Error('章节创建返回无效数据');

    const after = await chapterRepository.getByNovelId(input.novelId);
    console.info(`[chapterService] after save count=${after.length}`);
    console.info(`[chapterService] created id=${created.id}`);
    if (!after.some((chapter) => chapter.id === created.id)) {
      throw new Error('章节创建后无法读取，请检查存储');
    }
    return created;
  },

  async update(id: string, input: UpdateChapterInput): Promise<Chapter | null> {
    const updatedRaw = await dbCall<unknown>('update_chapter', { id, input }, () => {
      const items = getLocalChapters();
      const idx = items.findIndex((ch) => ch.id === id);
      if (idx === -1) return null as unknown as Chapter;
      const updated = { ...items[idx], ...input, updatedAt: nowISO() };
      if (input.targetWordCount !== undefined) {
        updated.targetWords = input.targetWordCount;
      }
      items[idx] = updated;
      saveLocalChapters(items);
      return updated;
    });
    return normalizeChapter(updatedRaw);
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_chapter', { id }, () => {
      const items = getLocalChapters().filter((ch) => ch.id !== id);
      saveLocalChapters(items);
    });
  },
};
