import { lsGet, nowISO } from './db';
import type { ChapterDraft } from '../../types/ai';
import type { DraftContentState } from '../../types/draftContentState';
import { normalizeAppError } from '../../types/appError';
import { countTextWords } from '../../utils/contentHash';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const DRAFTS_LIST_KEY_PREFIX = 'ai_novel_studio_drafts_list_';
const CHAPTERS_STORAGE_KEY = 'ai_novel_studio_chapters';
const CHAPTER_SUMMARIES_STORAGE_KEY = 'ai_novel_studio_chapter_summaries';
const CONTEXT_RECORDS_STORAGE_KEY = 'ai_novel_studio_context_records';

export type LocalDraftStore = { revision: number; drafts: ChapterDraft[] };

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

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

export function normalizeDraft(raw: unknown): ChapterDraft | null {
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
    wordCount: toNumber(item.wordCount ?? item.word_count, countTextWords(content)),
    isAdopted: toBoolean(item.isAdopted ?? item.is_adopted),
    aiTaskId: item.aiTaskId ?? item.ai_task_id ?? undefined,
    note: item.note,
    largeTextRefId: item.largeTextRefId ?? item.large_text_ref_id ?? undefined,
    contentState: item.contentState,
    createdAt: item.createdAt ?? item.created_at ?? now,
    updatedAt: item.updatedAt ?? item.updated_at ?? now,
  };
}

export function normalizeDrafts(items: unknown): ChapterDraft[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeDraft)
    .filter((item): item is ChapterDraft => item !== null)
    .sort((a, b) => a.versionNo - b.versionNo);
}

function unicodeScalarLength(content: string): number {
  return Array.from(content).length;
}

export async function readyState(
  content: string,
  contentHash?: string,
): Promise<DraftContentState> {
  return {
    status: 'ready',
    content,
    contentHash: contentHash ?? (await computeContentSha256(content)),
    contentLength: unicodeScalarLength(content),
  };
}

export function unavailableState(
  preview: string,
  value: unknown,
  traceId: string,
): Extract<DraftContentState, { status: 'unavailable' }> {
  const error = normalizeAppError(value, '完整正文暂时无法读取。', { traceId });
  const details = error.details;
  return {
    status: 'unavailable',
    preview: preview || undefined,
    errorCode: error.code === 'UNKNOWN_ERROR' ? 'LARGE_TEXT_CONTENT_UNAVAILABLE' : error.code,
    retryable: error.retryable || error.code === 'UNKNOWN_ERROR',
    expectedHash:
      typeof details?.expectedHash === 'string'
        ? details.expectedHash
        : typeof details?.expected_hash === 'string'
          ? details.expected_hash
          : undefined,
    actualHash:
      typeof details?.actualHash === 'string'
        ? details.actualHash
        : typeof details?.actual_hash === 'string'
          ? details.actual_hash
          : undefined,
    error:
      error.code === 'UNKNOWN_ERROR'
        ? { ...error, code: 'LARGE_TEXT_CONTENT_UNAVAILABLE', retryable: true }
        : error,
  };
}

export function normalizeReadState(
  raw: unknown,
  preview: string,
  traceId: string,
): DraftContentState {
  if (!raw || typeof raw !== 'object') return unavailableState(preview, raw, traceId);
  const wrapper = raw as Record<string, unknown>;
  const stateRaw = (wrapper.contentState ?? wrapper.content_state ?? wrapper) as Record<
    string,
    unknown
  >;
  if (!stateRaw || typeof stateRaw !== 'object') return unavailableState(preview, raw, traceId);
  if (stateRaw.status === 'ready') {
    const content = typeof stateRaw.content === 'string' ? stateRaw.content : null;
    const contentHash =
      typeof stateRaw.contentHash === 'string'
        ? stateRaw.contentHash
        : typeof stateRaw.content_hash === 'string'
          ? stateRaw.content_hash
          : null;
    const contentLength = toNumber(stateRaw.contentLength ?? stateRaw.content_length, -1);
    if (content !== null && contentHash && contentLength === unicodeScalarLength(content)) {
      return { status: 'ready', content, contentHash, contentLength };
    }
    return unavailableState(
      preview,
      {
        code: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
        message: '正文读取结果缺少完整性字段。',
        retryable: true,
        traceId,
      },
      traceId,
    );
  }
  return unavailableState(
    preview,
    {
      code:
        typeof stateRaw.errorCode === 'string'
          ? stateRaw.errorCode
          : typeof stateRaw.error_code === 'string'
            ? stateRaw.error_code
            : 'LARGE_TEXT_CONTENT_UNAVAILABLE',
      message: typeof stateRaw.message === 'string' ? stateRaw.message : '完整正文暂时无法读取。',
      retryable: stateRaw.retryable !== false,
      traceId,
      details: {
        expectedHash: stateRaw.expectedHash ?? stateRaw.expected_hash,
        actualHash: stateRaw.actualHash ?? stateRaw.actual_hash,
      },
    },
    traceId,
  );
}

export type BrowserAdoptionSnapshot = {
  chapterId: string;
  drafts: string | null;
  chapters: string | null;
  summaries: string | null;
  contexts: string | null;
};

export function draftsKey(chapterId: string): string {
  return `${DRAFTS_LIST_KEY_PREFIX}${chapterId}`;
}

export function readLocalDraftStore(
  chapterId: string,
  normalizeDrafts: (items: unknown) => ChapterDraft[],
): LocalDraftStore {
  const raw = lsGet<unknown>(draftsKey(chapterId));
  if (Array.isArray(raw)) return { revision: 0, drafts: normalizeDrafts(raw) };
  if (raw && typeof raw === 'object') {
    const record = raw as { revision?: unknown; drafts?: unknown };
    const revision =
      typeof record.revision === 'number' && Number.isFinite(record.revision)
        ? Math.trunc(record.revision)
        : 0;
    return { revision: Math.max(0, revision), drafts: normalizeDrafts(record.drafts) };
  }
  return { revision: 0, drafts: [] };
}

export function writeLocalDraftStore(chapterId: string, store: LocalDraftStore): void {
  localStorage.setItem(draftsKey(chapterId), JSON.stringify(store));
}

export function saveLocalDrafts(
  chapterId: string,
  drafts: ChapterDraft[],
  normalizeDrafts: (items: unknown) => ChapterDraft[],
): void {
  const current = readLocalDraftStore(chapterId, normalizeDrafts);
  writeLocalDraftStore(chapterId, { revision: current.revision + 1, drafts });
}

export function localDraftStoreChanged(before: LocalDraftStore, after: LocalDraftStore): boolean {
  return (
    before.revision !== after.revision ||
    JSON.stringify(before.drafts) !== JSON.stringify(after.drafts)
  );
}

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

export function withBrowserDraftLock<T>(chapterId: string, callback: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: BrowserLockManager } }).navigator?.locks;
  if (!locks) return callback();
  return locks.request(`ai-novel-studio:drafts:${chapterId}`, { mode: 'exclusive' }, callback);
}

export async function localDraftContentHash(
  draft: Pick<ChapterDraft, 'content' | 'contentState'>,
): Promise<string> {
  const state = draft.contentState;
  if (
    state?.status === 'ready' &&
    state.content === draft.content &&
    /^[a-f0-9]{64}$/i.test(state.contentHash)
  ) {
    return state.contentHash.toLowerCase();
  }
  return (await computeContentSha256(draft.content)).toLowerCase();
}

export function captureBrowserAdoptionSnapshot(chapterId: string): BrowserAdoptionSnapshot {
  return {
    chapterId,
    drafts: localStorage.getItem(draftsKey(chapterId)),
    chapters: localStorage.getItem(CHAPTERS_STORAGE_KEY),
    summaries: localStorage.getItem(CHAPTER_SUMMARIES_STORAGE_KEY),
    contexts: localStorage.getItem(CONTEXT_RECORDS_STORAGE_KEY),
  };
}

function restoreStorageValue(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

export function restoreBrowserAdoptionSnapshot(snapshot: BrowserAdoptionSnapshot): void {
  const failures: unknown[] = [];
  for (const [key, value] of [
    [draftsKey(snapshot.chapterId), snapshot.drafts],
    [CHAPTERS_STORAGE_KEY, snapshot.chapters],
    [CHAPTER_SUMMARIES_STORAGE_KEY, snapshot.summaries],
    [CONTEXT_RECORDS_STORAGE_KEY, snapshot.contexts],
  ] as const) {
    try {
      restoreStorageValue(key, value);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    const error = new Error('浏览器采用补偿未能完整恢复本地事实。');
    Object.assign(error, { rollbackErrors: failures });
    throw error;
  }
}

export function updateLocalChapterAdoption(
  chapterId: string,
  novelId: string,
  draft: ChapterDraft,
): boolean {
  const raw = lsGet<unknown>(CHAPTERS_STORAGE_KEY);
  if (!Array.isArray(raw)) return false;
  const index = raw.findIndex(
    (item) =>
      Boolean(item) && typeof item === 'object' && (item as { id?: unknown }).id === chapterId,
  );
  if (index < 0) return false;
  const chapter = raw[index] as Record<string, unknown>;
  const chapterNovelId = chapter.novelId ?? chapter.novel_id;
  if (chapterNovelId !== novelId) {
    throw {
      code: 'REVIEW_AUTHORIZATION_SCOPE_MISMATCH',
      message: '章节与采用草稿不属于同一作品。',
      retryable: false,
    };
  }
  const now = nowISO();
  raw[index] = {
    ...chapter,
    adoptedDraftId: draft.id,
    adopted_draft_id: undefined,
    status: 'adopted',
    wordCount: draft.wordCount,
    currentWords: draft.wordCount,
    updatedAt: now,
    updated_at: now,
  };
  localStorage.setItem(CHAPTERS_STORAGE_KEY, JSON.stringify(raw));
  return true;
}
