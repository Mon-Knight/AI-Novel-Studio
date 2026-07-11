/**
 * AI Novel Studio - 章节草稿版本服务
 * Tauri 桌面端使用 SQLite，浏览器开发态使用 localStorage。
 * 支持大文本分片保存（超过 100KB 自动使用分片管道）。
 */
import { dbCall, lsGet, lsSet, generateId, nowISO } from '../database/db';
import { saveLargeTextWithChunks } from '../largeTextSave';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';
import { shouldUseLargeTextSave } from '../../types/largeTextSave';
import type { ChapterDraft, CreateChapterDraftInput, DraftSource } from '../../types/ai';
import type { LargeTextSaveProgress } from '../../types/largeTextSave';

const DRAFTS_LIST_KEY_PREFIX = 'ai_novel_studio_drafts_list_';

type DraftRecord = Partial<ChapterDraft> & {
  novel_id?: string;
  chapter_id?: string;
  version_no?: number;
  word_count?: number;
  is_adopted?: boolean | number;
  ai_task_id?: string | null;
  large_text_ref_id?: string | null;
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
    largeTextRefId: item.largeTextRefId ?? item.large_text_ref_id ?? undefined,
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

/**
 * 从大文本存储中读取完整内容
 */
async function readFullContent(largeTextRefId: string): Promise<string | null> {
  // 检测是否在 Tauri 环境
  if (isTauriRuntime()) {
    try {
      const result = await tauriInvoke<{ content: string }>('read_large_text_content', {
        input: { documentId: largeTextRefId },
      });
      return result?.content ?? null;
    } catch {
      return null;
    }
  }
  // 浏览器模式下内容已在 localStorage 中
  return null;
}

export const draftVersionService = {
  async getByChapterId(chapterId: string): Promise<ChapterDraft[]> {
    const drafts = await dbCall<unknown[]>(
      'get_drafts_by_chapter_id',
      { chapterId },
      () => getLocalDrafts(chapterId),
    );
    const normalized = normalizeDrafts(drafts);

    // 加载大文本完整内容
    for (const draft of normalized) {
      if (draft.largeTextRefId && draft.content.length < 600) {
        const fullContent = await readFullContent(draft.largeTextRefId);
        if (fullContent) {
          draft.content = fullContent;
          draft.wordCount = countWords(fullContent);
        }
      }
    }

    return normalized;
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
    const normalized = normalizeDraft(draft);

    // 加载大文本完整内容
    if (normalized?.largeTextRefId && normalized.content.length < 600) {
      const fullContent = await readFullContent(normalized.largeTextRefId);
      if (fullContent) {
        normalized.content = fullContent;
        normalized.wordCount = countWords(fullContent);
      }
    }

    return normalized;
  },

  async getAdoptedByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    return drafts.find((d) => d.isAdopted) ?? null;
  },

  async create(input: CreateChapterDraftInput, onProgress?: (p: LargeTextSaveProgress) => void): Promise<ChapterDraft> {
    // 如果内容较大，先通过大文本管道保存
    let largeTextRefId: string | undefined;
    let contentForDb = input.content;

    if (shouldUseLargeTextSave(input.content)) {
      onProgress?.({ stage: 'creating', percent: 0, message: '正在准备保存大文本...' });
      const saveResult = await saveLargeTextWithChunks({
        targetType: 'draft',
        targetId: input.chapterId,
        fieldName: 'content',
        title: input.title,
        content: input.content,
        onProgress,
      });

      if (!saveResult.success) {
        throw new Error(saveResult.error || '大文本保存失败');
      }

      if (saveResult.documentId) {
        largeTextRefId = saveResult.documentId;
        // 存储截断预览到 content 字段（前 500 字符）
        contentForDb = input.content.slice(0, 500);
        if (input.content.length > 500) {
          contentForDb += `\n\n[大文本已分片保存，完整内容通过 largeTextRefId 读取: ${largeTextRefId}]`;
        }
      }
    }

    const inputWithRef = { ...input, content: contentForDb, largeTextRefId };

    const draft = await dbCall<unknown>(
      'create_chapter_draft',
      { input: inputWithRef },
      () => {
        const drafts = getLocalDrafts(input.chapterId);
        const maxVersion = drafts.reduce((max, d) => Math.max(max, d.versionNo), 0);
        const now = nowISO();
        const localDraft: ChapterDraft = {
          id: generateId(),
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: input.title,
          content: input.content, // localStorage 保存完整内容
          source: input.source,
          versionNo: maxVersion + 1,
          wordCount: countWords(input.content),
          isAdopted: false,
          aiTaskId: input.aiTaskId,
          note: input.note,
          largeTextRefId,
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

    // 如果是大文本且有 largeTextRefId，加载完整内容
    if (normalized.largeTextRefId) {
      try {
        const fullContent = await readFullContent(normalized.largeTextRefId);
        if (fullContent) {
          normalized.content = fullContent;
        }
      } catch {
        // 读取失败时保留截断预览
        console.warn('无法读取大文本完整内容，使用截断预览');
      }
    }

    return normalized;
  },

  async update(id: string, chapterId: string, content: string, source?: DraftSource, onProgress?: (p: LargeTextSaveProgress) => void): Promise<ChapterDraft> {
    // 如果内容较大，先通过大文本管道保存
    let largeTextRefId: string | undefined;
    let contentForDb = content;

    if (shouldUseLargeTextSave(content)) {
      onProgress?.({ stage: 'creating', percent: 0, message: '正在准备保存大文本...' });
      const saveResult = await saveLargeTextWithChunks({
        targetType: 'draft',
        targetId: chapterId,
        fieldName: 'content',
        content,
        onProgress,
      });

      if (!saveResult.success) {
        throw new Error(saveResult.error || '大文本保存失败');
      }

      if (saveResult.documentId) {
        largeTextRefId = saveResult.documentId;
        contentForDb = content.slice(0, 500);
        if (content.length > 500) {
          contentForDb += `\n\n[大文本已分片保存: ${largeTextRefId}]`;
        }
      }
    }

    const draft = await dbCall<unknown | null>(
      'update_chapter_draft',
      { id, chapterId, content: contentForDb, source, largeTextRefId: largeTextRefId ?? null },
      () => {
        const drafts = getLocalDrafts(chapterId);
        const idx = drafts.findIndex((d) => d.id === id);
        if (idx === -1) {
          throw new Error('draft_update_conflict: 草稿不存在或不属于当前章节');
        }

        drafts[idx] = {
          ...drafts[idx],
          content, // localStorage 保存完整内容
          source: source || 'user_edited',
          wordCount: countWords(content),
          largeTextRefId: largeTextRefId || drafts[idx].largeTextRefId,
          updatedAt: nowISO(),
        };
        saveLocalDrafts(chapterId, drafts);
        return drafts[idx];
      },
    );

    const normalized = normalizeDraft(draft);
    if (!normalized || normalized.id !== id || normalized.chapterId !== chapterId) {
      throw new Error('draft_update_conflict: 草稿更新结果与目标章节不一致');
    }

    // 如果是大文本且有 largeTextRefId，加载完整内容
    if (normalized?.largeTextRefId) {
      try {
        const fullContent = await readFullContent(normalized.largeTextRefId);
        if (fullContent) {
          normalized.content = fullContent;
        }
      } catch {
        console.warn('无法读取大文本完整内容，使用截断预览');
      }
    }

    return normalized;
  },

  async adopt(draftId: string, chapterId: string): Promise<ChapterDraft> {
    const draft = await dbCall<unknown | null>(
      'adopt_chapter_draft',
      { draftId, chapterId },
      () => {
        const drafts = getLocalDrafts(chapterId);
        const target = drafts.find((draft) => draft.id === draftId);
        if (!target) {
          throw new Error('draft_adopt_target_mismatch: 草稿不存在或不属于当前章节');
        }
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
    const normalized = normalizeDraft(draft);
    if (!normalized || normalized.id !== draftId || normalized.chapterId !== chapterId || !normalized.isAdopted) {
      throw new Error('draft_adopt_conflict: 正文采用结果无效');
    }
    return normalized;
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
