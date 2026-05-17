/**
 * AI Novel Studio - 章节草稿版本服务
 * Tauri 桌面端使用 SQLite，浏览器开发态使用 localStorage。
 */
import { dbCall, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ChapterDraft, CreateChapterDraftInput, DraftSource } from '../../types/ai';

const DRAFTS_LIST_KEY_PREFIX = 'ai_novel_studio_drafts_list_';

type DraftRecord = Partial<ChapterDraft> & {
  novel_id?: string;
  chapter_id?: string;
  version_no?: number;
  word_count?: number;
  is_adopted?: boolean | number;
  ai_task_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

function draftsKey(chapterId: string): string {
  return `${DRAFTS_LIST_KEY_PREFIX}${chapterId}`;
}

function countWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

function normalizeDraft(raw: unknown): ChapterDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as DraftRecord;
  const id = typeof item.id === 'string' ? item.id : '';
  const novelId = typeof item.novelId === 'string' ? item.novelId : item.novel_id;
  const chapterId = typeof item.chapterId === 'string' ? item.chapterId : item.chapter_id;
  const content = typeof item.content === 'string' ? item.content : '';
  if (!id || !novelId || !chapterId) return null;

  const now = nowISO();
  return {
    id,
    novelId,
    chapterId,
    title: item.title,
    content,
    source: item.source ?? 'manual_placeholder',
    versionNo: toNumber(item.versionNo ?? item.version_no, 1),
    wordCount: toNumber(item.wordCount ?? item.word_count, countWords(content)),
    isAdopted: toBoolean(item.isAdopted ?? item.is_adopted),
    aiTaskId: item.aiTaskId ?? item.ai_task_id ?? undefined,
    note: item.note,
    createdAt: item.createdAt ?? item.created_at ?? now,
    updatedAt: item.updatedAt ?? item.updated_at ?? now,
  };
}

function normalizeDrafts(items: unknown): ChapterDraft[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeDraft)
    .filter((item): item is ChapterDraft => item !== null)
    .sort((a, b) => a.versionNo - b.versionNo);
}

function getLocalDrafts(chapterId: string): ChapterDraft[] {
  const drafts = normalizeDrafts(lsGet<unknown>(draftsKey(chapterId)));
  lsSet(draftsKey(chapterId), drafts);
  return drafts;
}

function saveLocalDrafts(chapterId: string, drafts: ChapterDraft[]): void {
  lsSet(draftsKey(chapterId), drafts);
}

export const draftVersionService = {
  async getByChapterId(chapterId: string): Promise<ChapterDraft[]> {
    const drafts = await dbCall<unknown[]>(
      'get_drafts_by_chapter_id',
      { chapterId },
      () => getLocalDrafts(chapterId),
    );
    return normalizeDrafts(drafts);
  },

  async getLatestByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const draft = await dbCall<unknown | null>(
      'get_latest_draft_by_chapter_id',
      { chapterId },
      () => {
        const drafts = getLocalDrafts(chapterId);
        if (drafts.length === 0) return null;
        return drafts.sort((a, b) => b.versionNo - a.versionNo)[0];
      },
    );
    return normalizeDraft(draft);
  },

  async getAdoptedByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    return drafts.find((d) => d.isAdopted) ?? null;
  },

  async create(input: CreateChapterDraftInput): Promise<ChapterDraft> {
    const draft = await dbCall<unknown>(
      'create_chapter_draft',
      { input },
      () => {
        const drafts = getLocalDrafts(input.chapterId);
        const maxVersion = drafts.reduce((max, d) => Math.max(max, d.versionNo), 0);
        const now = nowISO();
        const localDraft: ChapterDraft = {
          id: generateId(),
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: input.title,
          content: input.content,
          source: input.source,
          versionNo: maxVersion + 1,
          wordCount: countWords(input.content),
          isAdopted: false,
          aiTaskId: input.aiTaskId,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        };

        drafts.push(localDraft);
        saveLocalDrafts(input.chapterId, drafts);
        return localDraft;
      },
    );
    const normalized = normalizeDraft(draft);
    if (!normalized?.id) throw new Error('草稿创建返回无效数据');
    return normalized;
  },

  async update(id: string, chapterId: string, content: string, source?: DraftSource): Promise<ChapterDraft | null> {
    const draft = await dbCall<unknown | null>(
      'update_chapter_draft',
      { id, chapterId, content, source },
      () => {
        const drafts = getLocalDrafts(chapterId);
        const idx = drafts.findIndex((d) => d.id === id);
        if (idx === -1) return null;

        drafts[idx] = {
          ...drafts[idx],
          content,
          source: source || 'user_edited',
          wordCount: countWords(content),
          updatedAt: nowISO(),
        };
        saveLocalDrafts(chapterId, drafts);
        return drafts[idx];
      },
    );
    return normalizeDraft(draft);
  },

  async adopt(draftId: string, chapterId: string): Promise<ChapterDraft | null> {
    const draft = await dbCall<unknown | null>(
      'adopt_chapter_draft',
      { draftId, chapterId },
      () => {
        const drafts = getLocalDrafts(chapterId);
        let adopted: ChapterDraft | null = null;

        const updated = drafts.map((d) => {
          if (d.id === draftId) {
            adopted = { ...d, isAdopted: true, updatedAt: nowISO() };
            return adopted;
          }
          return { ...d, isAdopted: false };
        });

        saveLocalDrafts(chapterId, updated);
        return adopted;
      },
    );
    return normalizeDraft(draft);
  },

  async delete(id: string, chapterId: string): Promise<void> {
    await dbCall<void>(
      'delete_chapter_draft',
      { id, chapterId },
      () => {
        const drafts = getLocalDrafts(chapterId).filter((d) => d.id !== id);
        saveLocalDrafts(chapterId, drafts);
      },
    );
  },
};
