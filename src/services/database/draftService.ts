/**
 * AI Novel Studio - 章节草稿服务（轻量版）
 * v0.4.0 使用 localStorage，v0.5.0+ 可替换为 SQLite
 */
import { lsGet, lsSet, lsRemove, generateId, nowISO } from './db';

export type DraftSource =
  | 'manual_placeholder'
  | 'ai_generated'
  | 'ai_regenerated'
  | 'user_edited'
  | 'ai_polished'
  | 'imported';

export interface ChapterDraftPreview {
  id: string;
  novelId: string;
  chapterId: string;
  content: string;
  source: DraftSource;
  wordCount: number;
  isAdopted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDraftInput {
  novelId: string;
  chapterId: string;
  content: string;
  source?: DraftSource;
}

const DRAFT_KEY_PREFIX = 'ai_novel_studio_draft_';

function draftKey(chapterId: string): string {
  return `${DRAFT_KEY_PREFIX}${chapterId}`;
}

function countWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  // 中文字数 + 英文单词数
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

export const draftService = {
  async getByChapterId(chapterId: string): Promise<ChapterDraftPreview | null> {
    const stored = lsGet<ChapterDraftPreview>(draftKey(chapterId));
    return stored ?? null;
  },

  async save(input: SaveDraftInput): Promise<ChapterDraftPreview> {
    const existing = lsGet<ChapterDraftPreview>(draftKey(input.chapterId));
    const now = nowISO();
    const wordCount = countWords(input.content);

    const draft: ChapterDraftPreview = existing
      ? {
          ...existing,
          content: input.content,
          source: input.source || 'user_edited',
          wordCount,
          updatedAt: now,
        }
      : {
          id: generateId(),
          novelId: input.novelId,
          chapterId: input.chapterId,
          content: input.content,
          source: input.source || 'manual_placeholder',
          wordCount,
          isAdopted: false,
          createdAt: now,
          updatedAt: now,
        };

    lsSet(draftKey(input.chapterId), draft);
    return draft;
  },

  async clear(chapterId: string): Promise<void> {
    lsRemove(draftKey(chapterId));
  },
};
