/**
 * AI Novel Studio - 章节草稿版本服务（v0.5.0 增强版）
 * 支持多版本草稿、采用确认
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ChapterDraft, CreateChapterDraftInput, DraftSource } from '../../types/ai';

const DRAFTS_LIST_KEY_PREFIX = 'ai_novel_studio_drafts_list_';

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

export const draftVersionService = {
  /** 获取某章节的所有草稿 */
  async getByChapterId(chapterId: string): Promise<ChapterDraft[]> {
    return lsGet<ChapterDraft[]>(draftsKey(chapterId)) ?? [];
  },

  /** 获取最新草稿 */
  async getLatestByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    if (drafts.length === 0) return null;
    return drafts.sort((a, b) => b.versionNo - a.versionNo)[0];
  },

  /** 获取已采用的草稿 */
  async getAdoptedByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    return drafts.find((d) => d.isAdopted) ?? null;
  },

  /** 创建新草稿版本 */
  async create(input: CreateChapterDraftInput): Promise<ChapterDraft> {
    const drafts = await this.getByChapterId(input.chapterId);
    const maxVersion = drafts.reduce((max, d) => Math.max(max, d.versionNo), 0);
    const now = nowISO();
    const wordCount = countWords(input.content);

    const draft: ChapterDraft = {
      id: generateId(),
      novelId: input.novelId,
      chapterId: input.chapterId,
      title: input.title,
      content: input.content,
      source: input.source,
      versionNo: maxVersion + 1,
      wordCount,
      isAdopted: false,
      aiTaskId: input.aiTaskId,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    };

    drafts.push(draft);
    lsSet(draftsKey(input.chapterId), drafts);
    return draft;
  },

  /** 更新草稿内容 */
  async update(id: string, chapterId: string, content: string, source?: DraftSource): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    const idx = drafts.findIndex((d) => d.id === id);
    if (idx === -1) return null;

    drafts[idx] = {
      ...drafts[idx],
      content,
      source: source || 'user_edited',
      wordCount: countWords(content),
      updatedAt: nowISO(),
    };
    lsSet(draftsKey(chapterId), drafts);
    return drafts[idx];
  },

  /** 确认采用某个草稿 */
  async adopt(draftId: string, chapterId: string): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    let adopted: ChapterDraft | null = null;

    const updated = drafts.map((d) => {
      if (d.id === draftId) {
        adopted = { ...d, isAdopted: true, updatedAt: nowISO() };
        return adopted;
      }
      return { ...d, isAdopted: false };
    });

    lsSet(draftsKey(chapterId), updated);
    return adopted;
  },

  /** 删除草稿 */
  async delete(id: string, chapterId: string): Promise<void> {
    const drafts = (await this.getByChapterId(chapterId)).filter((d) => d.id !== id);
    lsSet(draftsKey(chapterId), drafts);
  },
};
