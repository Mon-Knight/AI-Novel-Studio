/**
 * AI Novel Studio - 章节草稿版本服务
 * Tauri 桌面端使用 SQLite，浏览器开发态使用 localStorage。
 * 支持大文本分片保存（超过 100KB 自动使用分片管道）。
 */
import { dbCall, lsGet, generateId, nowISO } from '../database/db';
import { abortLargeTextSave, uploadLargeTextChunks } from '../largeTextSave';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';
import { chapterSummaryService } from '../context/chapterSummaryService';
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

interface ReadLargeTextContentOutput {
  documentId: string;
  content: string;
  totalChars: number;
  totalBytes: number;
}

interface CommitLargeTextDraftOutput {
  draft: unknown;
  cleanupWarning?: string | null;
}

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

function countCharacters(text: string): number {
  let count = 0;
  for (const _character of text) {
    count += 1;
  }
  return count;
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
  return normalizeDrafts(lsGet<unknown>(draftsKey(chapterId)));
}

function saveLocalDrafts(chapterId: string, drafts: ChapterDraft[]): void {
  localStorage.setItem(draftsKey(chapterId), JSON.stringify(drafts));
}

/**
 * 从大文本存储中读取完整内容
 */
async function readFullContent(largeTextRefId: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error('large_text_read_unavailable: 浏览器模式没有独立的大文本存储');
  }

  const result = await tauriInvoke<ReadLargeTextContentOutput>('read_large_text_content', {
    input: { documentId: largeTextRefId },
  });
  if (
    !result
    || result.documentId !== largeTextRefId
    || typeof result.content !== 'string'
    || typeof result.totalChars !== 'number'
    || typeof result.totalBytes !== 'number'
  ) {
    throw new Error(`large_text_read_invalid_response: document_id=${largeTextRefId}`);
  }

  const actualChars = countCharacters(result.content);
  const actualBytes = new TextEncoder().encode(result.content).byteLength;
  if (result.totalChars !== actualChars || result.totalBytes !== actualBytes) {
    throw new Error(
      `large_text_read_metadata_mismatch: document_id=${largeTextRefId}`,
    );
  }
  return result.content;
}

async function hydrateDraft(draft: ChapterDraft): Promise<ChapterDraft> {
  if (!draft.largeTextRefId || !isTauriRuntime()) {
    return draft;
  }

  const content = await readFullContent(draft.largeTextRefId);
  return {
    ...draft,
    content,
    wordCount: countWords(content),
  };
}

async function hydrateDrafts(drafts: ChapterDraft[]): Promise<ChapterDraft[]> {
  const hydrated: ChapterDraft[] = [];
  for (const draft of drafts) {
    hydrated.push(await hydrateDraft(draft));
  }
  return hydrated;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function uploadDraftContent(
  draftId: string,
  content: string,
  title: string | undefined,
  onProgress: ((progress: LargeTextSaveProgress) => void) | undefined,
): Promise<string> {
  const result = await uploadLargeTextChunks({
    targetType: 'draft',
    targetId: draftId,
    fieldName: 'content',
    title,
    content,
    onProgress,
  });
  if (!result.success || !result.sessionId) {
    throw new Error(result.error || 'large_text_upload_failed: 未返回保存会话');
  }
  return result.sessionId;
}

async function commitUploadedDraft(
  command: 'commit_large_text_draft_create' | 'commit_large_text_draft_update',
  sessionId: string,
  input: Record<string, unknown>,
  expectedDraftId: string,
  expectedChapterId: string,
  expectedContent: string,
  onProgress: ((progress: LargeTextSaveProgress) => void) | undefined,
): Promise<ChapterDraft> {
  try {
    onProgress?.({ stage: 'finalizing', percent: 85, message: '正在提交正文与草稿...' });
    const result = await tauriInvoke<CommitLargeTextDraftOutput>(command, { input });
    const normalized = normalizeDraft(result?.draft);
    if (
      !normalized
      || normalized.id !== expectedDraftId
      || normalized.chapterId !== expectedChapterId
      || normalized.largeTextRefId !== sessionId
      || normalized.content !== expectedContent
      || normalized.wordCount !== countWords(expectedContent)
    ) {
      throw new Error('large_text_draft_commit_invalid_response: 草稿提交结果无效');
    }

    if (result.cleanupWarning) {
      console.warn('[LARGE_TEXT_CLEANUP_WARNING]', result.cleanupWarning);
    }
    onProgress?.({
      stage: 'done',
      percent: 100,
      message: `保存完成（${countCharacters(normalized.content)} 字符）`,
    });
    return normalized;
  } catch (error: unknown) {
    try {
      await abortLargeTextSave(sessionId);
    } catch {
      // 不用缓存清理错误覆盖原始事务或读取错误。
    }
    const normalizedError = toError(error);
    onProgress?.({
      stage: 'error',
      percent: 0,
      message: `保存失败：${normalizedError.message}`,
      error: normalizedError.message,
    });
    throw normalizedError;
  }
}

export const draftVersionService = {
  async getByChapterId(chapterId: string): Promise<ChapterDraft[]> {
    const drafts = await dbCall<unknown[]>(
      'get_drafts_by_chapter_id',
      { chapterId },
      () => getLocalDrafts(chapterId),
    );
    const normalized = normalizeDrafts(drafts);
    return hydrateDrafts(normalized);
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
    return normalized ? hydrateDraft(normalized) : null;
  },

  async getAdoptedByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const drafts = await this.getByChapterId(chapterId);
    return drafts.find((d) => d.isAdopted) ?? null;
  },

  async create(input: CreateChapterDraftInput, onProgress?: (p: LargeTextSaveProgress) => void): Promise<ChapterDraft> {
    if (isTauriRuntime() && shouldUseLargeTextSave(input.content)) {
      const draftId = generateId();
      const sessionId = await uploadDraftContent(
        draftId,
        input.content,
        input.title,
        onProgress,
      );
      return commitUploadedDraft(
        'commit_large_text_draft_create',
        sessionId,
        {
          sessionId,
          draftId,
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: input.title,
          source: input.source,
          aiTaskId: input.aiTaskId,
          note: input.note,
        },
        draftId,
        input.chapterId,
        input.content,
        onProgress,
      );
    }

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
          content: input.content, // localStorage 保存完整内容
          source: input.source,
          versionNo: maxVersion + 1,
          wordCount: countWords(input.content),
          isAdopted: false,
          aiTaskId: input.aiTaskId,
          note: input.note,
          largeTextRefId: input.largeTextRefId,
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
    return hydrateDraft(normalized);
  },

  async update(id: string, chapterId: string, content: string, source?: DraftSource, onProgress?: (p: LargeTextSaveProgress) => void): Promise<ChapterDraft> {
    if (isTauriRuntime() && shouldUseLargeTextSave(content)) {
      const sessionId = await uploadDraftContent(id, content, undefined, onProgress);
      return commitUploadedDraft(
        'commit_large_text_draft_update',
        sessionId,
        {
          sessionId,
          draftId: id,
          chapterId,
          source,
        },
        id,
        chapterId,
        content,
        onProgress,
      );
    }

    const draft = await dbCall<unknown | null>(
      'update_chapter_draft',
      { id, chapterId, content, source, largeTextRefId: null },
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
          largeTextRefId: undefined,
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
    return hydrateDraft(normalized);
  },

  async adopt(draftId: string, chapterId: string): Promise<ChapterDraft> {
    let localDraftSnapshot: string | null = null;
    let localAdoptedDraftChanged = false;
    const draft = await dbCall<unknown | null>(
      'adopt_chapter_draft',
      { draftId, chapterId },
      () => {
        localDraftSnapshot = localStorage.getItem(draftsKey(chapterId));
        const drafts = getLocalDrafts(chapterId);
        const target = drafts.find((draft) => draft.id === draftId);
        if (!target) {
          throw new Error('draft_adopt_target_mismatch: 草稿不存在或不属于当前章节');
        }
        localAdoptedDraftChanged = drafts.find((item) => item.isAdopted)?.id !== draftId;
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

    if (!isTauriRuntime() && localAdoptedDraftChanged) {
      try {
        await chapterSummaryService.markExpired(chapterId);
      } catch (error) {
        try {
          if (localDraftSnapshot === null) localStorage.removeItem(draftsKey(chapterId));
          else localStorage.setItem(draftsKey(chapterId), localDraftSnapshot);
        } catch (rollbackError) {
          const rollbackFailure = new Error('正文采用后的上下文过期失败，且草稿采用状态未能完整回滚。');
          Object.assign(rollbackFailure, { cause: error, rollbackError });
          throw rollbackFailure;
        }
        throw error;
      }
    }
    return hydrateDraft(normalized);
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
