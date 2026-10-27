import { appLogger } from '../observability/appLogger';
/**
 * Chapter draft persistence facade.
 *
 * Tauri writes use one authoritative atomic command. Large-text read failures
 * are represented as `contentState: unavailable`; preview text is never put in
 * `draft.content` and therefore cannot enter the editor or an AI prompt.
 */
import { dbCall, generateId, nowISO } from './db';
import { isTauriRuntime } from '../tauri/runtime';
import { chapterSummaryService } from '../context/chapterSummaryService';
import type { ChapterDraft, CreateChapterDraftInput, DraftSource } from '../../types/ai';
import type { LargeTextSaveProgress } from '../../types/largeTextSave';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { countTextWords } from '../../utils/contentHash';
import {
  createOperationId,
  createTraceId,
  logWorkspaceError,
} from '../workspace/workspaceErrorService';

import {
  captureBrowserAdoptionSnapshot,
  localDraftContentHash,
  localDraftStoreChanged,
  normalizeDraft,
  normalizeDrafts,
  normalizeReadState,
  readLocalDraftStore as readBrowserDraftStore,
  readyState,
  restoreBrowserAdoptionSnapshot,
  saveLocalDrafts,
  updateLocalChapterAdoption,
  unavailableState,
  withBrowserDraftLock,
  writeLocalDraftStore,
  type BrowserAdoptionSnapshot,
  type LocalDraftStore,
} from './draftBrowserPersistence';

type AtomicSaveRecord = {
  operationId?: string;
  operation_id?: string;
  traceId?: string;
  trace_id?: string;
  draft?: unknown;
  disposition?: unknown;
  contentHash?: string;
  content_hash?: string;
  contentLength?: number;
  content_length?: number;
  storageMode?: string;
  storage_mode?: string;
  idempotentReplay?: boolean;
  idempotent_replay?: boolean;
};

type UpdateDraftBase = Pick<
  ChapterDraft,
  'id' | 'novelId' | 'chapterId' | 'title' | 'content' | 'versionNo' | 'isAdopted' | 'contentState'
>;

// A retry of the same business payload must reuse its operationId. Entries are
// removed only after an authoritative success; changed content/base identity
// naturally produces a different key.
const pendingOperationIds = new Map<string, string>();

function unicodeScalarLength(content: string): number {
  return Array.from(content).length;
}

function operationIdFor(key: string): string {
  const existing = pendingOperationIds.get(key);
  if (existing) return existing;
  if (pendingOperationIds.size >= 100) {
    const oldest = pendingOperationIds.keys().next().value as string | undefined;
    if (oldest) pendingOperationIds.delete(oldest);
  }
  const operationId = createOperationId();
  pendingOperationIds.set(key, operationId);
  return operationId;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readLocalDraftStore(chapterId: string): LocalDraftStore {
  return readBrowserDraftStore(chapterId, normalizeDrafts);
}

function getLocalDrafts(chapterId: string): ChapterDraft[] {
  return readLocalDraftStore(chapterId).drafts;
}

async function hydrateDraftContent(draft: ChapterDraft): Promise<ChapterDraft> {
  if (!draft.largeTextRefId || !isTauriRuntime()) {
    const state = await readyState(draft.content);
    return { ...draft, contentState: state };
  }
  const preview = draft.content;
  const traceId = createTraceId('draft-read');
  try {
    const raw = await dbCall<unknown>('read_chapter_draft_content', {
      input: {
        novelId: draft.novelId,
        chapterId: draft.chapterId,
        draftId: draft.id,
        traceId,
      },
    });
    const wrapper = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const returnedDraftId = wrapper.draftId ?? wrapper.draft_id;
    const returnedVersion = wrapper.draftVersion ?? wrapper.draft_version;
    if (
      (typeof returnedDraftId === 'string' && returnedDraftId !== draft.id) ||
      (typeof returnedVersion === 'number' && returnedVersion !== draft.versionNo)
    ) {
      throw {
        code: 'LARGE_TEXT_REFERENCE_INVALID',
        message: '正文读取结果与目标草稿不一致。',
        retryable: false,
        traceId,
      };
    }
    const state = normalizeReadState(raw, preview, traceId);
    return {
      ...draft,
      // Critical invariant: preview never occupies the editable content field.
      content: state.status === 'ready' ? state.content : '',
      wordCount: state.status === 'ready' ? countTextWords(state.content) : draft.wordCount,
      contentState: state,
    };
  } catch (error) {
    const state = unavailableState(preview, error, traceId);
    logWorkspaceError('draft_content_read_failed', error, {
      traceId,
      novelId: draft.novelId,
      chapterId: draft.chapterId,
      draftId: draft.id,
      draftVersion: draft.versionNo,
    });
    return { ...draft, content: '', contentState: state };
  }
}

async function getAuthoritativeDraftById(
  chapterId: string,
  draftId: string,
): Promise<ChapterDraft | null> {
  const traceId = createTraceId('draft-authoritative-read');
  const raw = await dbCall<unknown[]>('get_drafts_by_chapter_id', { chapterId, traceId }, () =>
    getLocalDrafts(chapterId),
  );
  const target = normalizeDrafts(raw).find((draft) => draft.id === draftId);
  return target ? hydrateDraftContent(target) : null;
}

async function normalizeAtomicSave(
  raw: unknown,
  expected: {
    operationId: string;
    traceId: string;
    novelId: string;
    chapterId: string;
    draftId?: string;
    draftVersion?: number;
    content: string;
    contentHash: string;
  },
): Promise<ChapterDraft> {
  if (!raw || typeof raw !== 'object') {
    throw {
      code: 'DATABASE_TRANSACTION_FAILED',
      message: '原子保存未返回结果。',
      retryable: true,
      traceId: expected.traceId,
      operationId: expected.operationId,
    };
  }
  const record = raw as AtomicSaveRecord;
  const returnedOperationId = record.operationId ?? record.operation_id;
  const returnedHash = record.contentHash ?? record.content_hash;
  const returnedLength = toNumber(record.contentLength ?? record.content_length, -1);
  const draft = normalizeDraft(record.draft);
  const disposition = record.disposition;
  let dispositionMatches = false;
  if (draft) {
    if (!expected.draftId) {
      dispositionMatches = disposition === 'created_new';
    } else if (disposition === 'updated_existing') {
      dispositionMatches =
        draft.id === expected.draftId &&
        (expected.draftVersion === undefined || draft.versionNo === expected.draftVersion);
    } else if (disposition === 'forked_from_adopted') {
      dispositionMatches =
        draft.id !== expected.draftId &&
        (expected.draftVersion === undefined || draft.versionNo > expected.draftVersion);
    }
  }
  if (
    returnedOperationId !== expected.operationId ||
    returnedHash !== expected.contentHash ||
    returnedLength !== unicodeScalarLength(expected.content) ||
    !draft ||
    draft.novelId !== expected.novelId ||
    draft.chapterId !== expected.chapterId ||
    draft.isAdopted ||
    !dispositionMatches
  ) {
    throw {
      code: 'DOCUMENT_HASH_MISMATCH',
      message: '原子保存返回的正文身份校验失败。',
      retryable: false,
      traceId: record.traceId ?? record.trace_id ?? expected.traceId,
      operationId: expected.operationId,
    };
  }
  return {
    ...draft,
    content: expected.content,
    wordCount: countTextWords(expected.content),
    contentState: await readyState(expected.content, expected.contentHash),
  };
}

export const draftVersionService = {
  async getByChapterId(chapterId: string): Promise<ChapterDraft[]> {
    const traceId = createTraceId('draft-list');
    const raw = await dbCall<unknown[]>('get_drafts_by_chapter_id', { chapterId, traceId }, () =>
      getLocalDrafts(chapterId),
    );
    return Promise.all(normalizeDrafts(raw).map(hydrateDraftContent));
  },

  async getPageByChapterId(
    chapterId: string,
    page = 1,
    size = 20,
  ): Promise<{ items: ChapterDraft[]; total: number }> {
    const normalizedPage = Math.max(1, Math.trunc(page));
    const normalizedSize = Math.min(100, Math.max(1, Math.trunc(size)));
    const traceId = createTraceId('draft-list-page');
    const [raw, total] = await Promise.all([
      dbCall<unknown[]>(
        'get_drafts_by_chapter_id',
        { chapterId, page: normalizedPage, size: normalizedSize, traceId },
        () => {
          const drafts = getLocalDrafts(chapterId).sort(
            (left, right) => right.versionNo - left.versionNo,
          );
          const start = (normalizedPage - 1) * normalizedSize;
          return drafts.slice(start, start + normalizedSize);
        },
      ),
      dbCall<number>(
        'count_drafts_by_chapter_id',
        { chapterId },
        () => getLocalDrafts(chapterId).length,
      ),
    ]);
    const items = await Promise.all(normalizeDrafts(raw).map(hydrateDraftContent));
    items.sort((left, right) => right.versionNo - left.versionNo);
    return { items, total };
  },

  async getLatestByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const traceId = createTraceId('draft-latest');
    const raw = await dbCall<unknown | null>(
      'get_latest_draft_by_chapter_id',
      { chapterId, traceId },
      () => {
        const drafts = getLocalDrafts(chapterId);
        return drafts.sort((left, right) => right.versionNo - left.versionNo)[0] ?? null;
      },
    );
    const draft = normalizeDraft(raw);
    return draft ? hydrateDraftContent(draft) : null;
  },

  async getById(chapterId: string, draftId: string): Promise<ChapterDraft | null> {
    const normalizedChapterId = chapterId.trim();
    const normalizedDraftId = draftId.trim();
    if (!normalizedChapterId || !normalizedDraftId) return null;
    const traceId = createTraceId('draft-by-id');
    const raw = await dbCall<unknown | null>(
      'get_draft_by_chapter_and_id',
      { chapterId: normalizedChapterId, draftId: normalizedDraftId, traceId },
      () =>
        getLocalDrafts(normalizedChapterId).find((draft) => draft.id === normalizedDraftId) ?? null,
    );
    const draft = normalizeDraft(raw);
    if (draft && (draft.chapterId !== normalizedChapterId || draft.id !== normalizedDraftId)) {
      throw new Error('草稿读取结果与请求目标不一致。');
    }
    return draft ? hydrateDraftContent(draft) : null;
  },

  async getAdoptedByChapterId(chapterId: string): Promise<ChapterDraft | null> {
    const traceId = createTraceId('draft-adopted');
    const raw = await dbCall<unknown | null>(
      'get_adopted_draft_by_chapter_id',
      { chapterId, traceId },
      () => getLocalDrafts(chapterId).find((draft) => draft.isAdopted) ?? null,
    );
    const draft = normalizeDraft(raw);
    return draft ? hydrateDraftContent(draft) : null;
  },

  async create(
    input: CreateChapterDraftInput,
    onProgress?: (progress: LargeTextSaveProgress) => void,
  ): Promise<ChapterDraft> {
    if (!isTauriRuntime()) {
      const contentState = await readyState(input.content);
      // Compute the content before taking the synchronous localStorage
      // snapshot. Once the snapshot is read there is no await before the
      // revisioned write, so two browser tabs cannot overwrite one another's
      // draft list or reuse the same version number.
      return withBrowserDraftLock(input.chapterId, async () => {
        const store = readLocalDraftStore(input.chapterId);
        const drafts = store.drafts;
        const now = nowISO();
        const draft: ChapterDraft = {
          id: generateId(),
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: input.title,
          content: input.content,
          source: input.source,
          versionNo: drafts.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1,
          wordCount: countTextWords(input.content),
          isAdopted: false,
          aiTaskId: input.aiTaskId,
          note: input.note,
          contentState,
          createdAt: now,
          updatedAt: now,
        };
        drafts.push(draft);
        writeLocalDraftStore(input.chapterId, { revision: store.revision + 1, drafts });
        return draft;
      });
    }

    const traceId = createTraceId('draft-save');
    const currentContentHash = await computeContentSha256(input.content);
    const operationKey = JSON.stringify([
      'create',
      input.novelId,
      input.chapterId,
      currentContentHash,
      input.source,
      input.title ?? '',
      input.aiTaskId ?? '',
      input.note ?? '',
    ]);
    const explicitOperationId = input.operationId?.trim();
    if (input.operationId !== undefined && !explicitOperationId) {
      throw {
        code: 'OPERATION_PAYLOAD_CONFLICT',
        message: '显式 operationId 不能为空。',
        retryable: false,
        traceId,
      };
    }
    const operationId = explicitOperationId ?? operationIdFor(operationKey);
    onProgress?.({ stage: 'finalizing', percent: 20, message: '正在原子保存正文…' });
    try {
      const raw = await dbCall<unknown>('save_chapter_draft_atomic', {
        input: {
          operationId,
          traceId,
          novelId: input.novelId,
          chapterId: input.chapterId,
          currentContentHash,
          content: input.content,
          wordCount: countTextWords(input.content),
          source: input.source,
          title: input.title,
          aiTaskId: input.aiTaskId,
          note: input.note,
        },
      });
      const draft = await normalizeAtomicSave(raw, {
        operationId,
        traceId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        content: input.content,
        contentHash: currentContentHash,
      });
      if (!explicitOperationId) pendingOperationIds.delete(operationKey);
      onProgress?.({ stage: 'done', percent: 100, message: '正文已保存' });
      return draft;
    } catch (error) {
      onProgress?.({ stage: 'error', percent: 0, message: '保存失败' });
      throw logWorkspaceError('draft_atomic_create_failed', error, {
        traceId,
        operationId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        contentHash: currentContentHash,
      });
    }
  },

  async update(
    id: string,
    chapterId: string,
    content: string,
    source: DraftSource = 'user_edited',
    onProgress?: (progress: LargeTextSaveProgress) => void,
    baseDraft?: UpdateDraftBase,
  ): Promise<ChapterDraft> {
    if (!isTauriRuntime()) {
      const nextContentState = await readyState(content);
      const expectedBaseHash = baseDraft ? await localDraftContentHash(baseDraft) : undefined;

      // The browser fallback has no SQLite transaction. Use a small
      // revisioned optimistic CAS around the localStorage list instead. Hash
      // computation may yield to another tab, so the store is read again
      // before the final synchronous write and retried if its revision moved.
      return withBrowserDraftLock(chapterId, async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const observed = readLocalDraftStore(chapterId);
          const index = observed.drafts.findIndex((draft) => draft.id === id);
          if (index < 0) {
            throw {
              code: 'TARGET_DRAFT_NOT_FOUND',
              message: '草稿不存在或不属于当前章节。',
              retryable: false,
            };
          }
          const current = observed.drafts[index];
          const currentHash = await localDraftContentHash(current);
          const latest = readLocalDraftStore(chapterId);
          if (localDraftStoreChanged(observed, latest)) continue;

          if (baseDraft) {
            if (
              baseDraft.id !== current.id ||
              baseDraft.novelId !== current.novelId ||
              baseDraft.chapterId !== current.chapterId ||
              baseDraft.versionNo !== current.versionNo ||
              baseDraft.isAdopted !== current.isAdopted
            ) {
              throw {
                code: 'DOCUMENT_VERSION_CONFLICT',
                message: '保存基线与浏览器草稿版本不一致。',
                retryable: false,
              };
            }
            if (expectedBaseHash !== currentHash) {
              throw {
                code: 'DOCUMENT_HASH_MISMATCH',
                message: '浏览器草稿正文已在保存前发生变化。',
                retryable: false,
              };
            }
          }

          const timestamp = nowISO();
          const updated: ChapterDraft = {
            ...current,
            id: current.isAdopted ? generateId() : current.id,
            content,
            source,
            versionNo: current.isAdopted
              ? latest.drafts.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1
              : current.versionNo,
            wordCount: countTextWords(content),
            isAdopted: false,
            aiTaskId: current.isAdopted ? undefined : current.aiTaskId,
            note: current.isAdopted ? undefined : current.note,
            contentState: nextContentState,
            createdAt: current.isAdopted ? timestamp : current.createdAt,
            updatedAt: timestamp,
          };
          const nextDrafts = [...latest.drafts];
          if (current.isAdopted) nextDrafts.push(updated);
          else nextDrafts[index] = updated;
          writeLocalDraftStore(chapterId, {
            revision: latest.revision + 1,
            drafts: nextDrafts,
          });
          return updated;
        }

        throw {
          code: 'DOCUMENT_VERSION_CONFLICT',
          message: '浏览器草稿在保存期间发生变化，请重新加载后重试。',
          retryable: false,
        };
      });
    }

    // Refresh the authoritative row even when the editor supplies a base.
    // Adoption can commit while the IPC is in flight, making the editor's
    // isAdopted flag stale without changing the正文 hash or version number.
    const persisted = await getAuthoritativeDraftById(chapterId, id);
    if (!persisted) {
      throw {
        code: 'TARGET_DRAFT_NOT_FOUND',
        message: '目标草稿不存在。',
        retryable: false,
      };
    }
    if (persisted.id !== id || persisted.chapterId !== chapterId) {
      throw {
        code: 'LARGE_TEXT_REFERENCE_INVALID',
        message: '保存基线与目标草稿不一致。',
        retryable: false,
      };
    }
    if (baseDraft) {
      if (
        baseDraft.id !== persisted.id ||
        baseDraft.novelId !== persisted.novelId ||
        baseDraft.chapterId !== persisted.chapterId ||
        baseDraft.versionNo !== persisted.versionNo
      ) {
        throw {
          code: 'DOCUMENT_VERSION_CONFLICT',
          message: '保存基线与数据库草稿版本不一致。',
          retryable: false,
        };
      }
      if (
        baseDraft.contentState?.status === 'ready' &&
        persisted.contentState?.status === 'ready' &&
        baseDraft.contentState.contentHash !== persisted.contentState.contentHash
      ) {
        throw {
          code: 'DOCUMENT_HASH_MISMATCH',
          message: '数据库正文已在保存前发生变化。',
          retryable: false,
        };
      }
    }
    if (persisted.contentState?.status !== 'ready') {
      throw (
        persisted.contentState?.error ?? {
          code: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
          message: '完整正文不可用，已阻止保存。',
          retryable: true,
        }
      );
    }

    const traceId = createTraceId('draft-save');
    const currentContentHash = await computeContentSha256(content);
    const operationKey = JSON.stringify([
      'update',
      persisted.novelId,
      chapterId,
      id,
      persisted.versionNo,
      persisted.contentState.contentHash,
      currentContentHash,
      source,
      persisted.title ?? '',
    ]);
    const operationId = operationIdFor(operationKey);
    onProgress?.({ stage: 'finalizing', percent: 20, message: '正在原子保存正文…' });
    try {
      const raw = await dbCall<unknown>('save_chapter_draft_atomic', {
        input: {
          operationId,
          traceId,
          novelId: persisted.novelId,
          chapterId,
          draftId: id,
          draftVersion: persisted.versionNo,
          baseContentHash: persisted.contentState.contentHash,
          currentContentHash,
          content,
          wordCount: countTextWords(content),
          source,
          title: persisted.title,
        },
      });
      const draft = await normalizeAtomicSave(raw, {
        operationId,
        traceId,
        novelId: persisted.novelId,
        chapterId,
        draftId: id,
        draftVersion: persisted.versionNo,
        content,
        contentHash: currentContentHash,
      });
      pendingOperationIds.delete(operationKey);
      onProgress?.({ stage: 'done', percent: 100, message: '正文已保存' });
      return draft;
    } catch (error) {
      onProgress?.({ stage: 'error', percent: 0, message: '保存失败' });
      throw logWorkspaceError('draft_atomic_update_failed', error, {
        traceId,
        operationId,
        novelId: persisted.novelId,
        chapterId,
        draftId: id,
        draftVersion: persisted.versionNo,
        contentHash: currentContentHash,
      });
    }
  },

  async adopt(
    draftId: string,
    chapterId: string,
    options: {
      actor?: 'user' | 'autonomous_full_auto';
      afterFormalAdoption?: (draft: ChapterDraft) => Promise<void>;
    } = {},
  ): Promise<ChapterDraft> {
    const target = await this.getById(chapterId, draftId);
    if (!target) {
      throw { code: 'TARGET_DRAFT_NOT_FOUND', message: '目标草稿不存在。', retryable: false };
    }
    if (target.contentState?.status !== 'ready') {
      throw (
        target.contentState?.error ?? {
          code: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
          message: '完整正文不可用，已阻止采用。',
          retryable: true,
        }
      );
    }
    const traceId = createTraceId('draft-adopt');
    const browserSnapshot = !isTauriRuntime() ? captureBrowserAdoptionSnapshot(chapterId) : null;
    let localAdoptionCommitted = false;
    let localAdoptedDraftChanged = false;
    let raw: unknown | null;
    try {
      raw = await dbCall<unknown | null>(
        'adopt_chapter_draft',
        { draftId, chapterId, traceId },
        () =>
          withBrowserDraftLock(chapterId, async () => {
            const drafts = getLocalDrafts(chapterId);
            const localTarget = drafts.find((draft) => draft.id === draftId);
            if (!localTarget) {
              throw new Error('draft_adopt_target_mismatch: 草稿不存在或不属于当前章节');
            }
            localAdoptedDraftChanged = drafts.find((draft) => draft.isAdopted)?.id !== draftId;

            let adopted: ChapterDraft | null = null;
            const updated = drafts.map((draft) => {
              if (draft.id === draftId) {
                adopted = { ...draft, isAdopted: true, updatedAt: nowISO() };
                return adopted;
              }
              return { ...draft, isAdopted: false };
            });
            saveLocalDrafts(chapterId, updated, normalizeDrafts);
            const adoptedResult = adopted as ChapterDraft | null;
            if (adoptedResult && browserSnapshot) {
              // Existing browser profiles may have drafts without a chapter
              // cache row. Preserve that compatibility while synchronizing
              // every real chapter row with the formal adoption fact.
              updateLocalChapterAdoption(chapterId, adoptedResult.novelId, adoptedResult);
            }
            localAdoptionCommitted = true;
            return adopted;
          }),
      );
    } catch (error) {
      if (browserSnapshot && localAdoptionCommitted) {
        try {
          restoreBrowserAdoptionSnapshot(browserSnapshot);
        } catch (rollbackError) {
          const failure = new Error('浏览器章节采用失败，且本地事实回滚未完整成功。');
          Object.assign(failure, { cause: error, rollbackError });
          throw failure;
        }
      }
      throw error;
    }
    const adopted = normalizeDraft(raw);
    if (
      !adopted ||
      adopted.id !== draftId ||
      adopted.chapterId !== chapterId ||
      !adopted.isAdopted
    ) {
      if (browserSnapshot && localAdoptionCommitted)
        restoreBrowserAdoptionSnapshot(browserSnapshot);
      throw {
        code: 'DOCUMENT_VERSION_CONFLICT',
        message: '正文采用结果无效。',
        retryable: true,
        traceId,
      };
    }

    if (!isTauriRuntime() && localAdoptedDraftChanged) {
      try {
        await chapterSummaryService.markExpired(chapterId);
      } catch (error) {
        try {
          if (browserSnapshot) restoreBrowserAdoptionSnapshot(browserSnapshot);
        } catch (rollbackError) {
          const rollbackFailure = new Error(
            '正文采用后的上下文过期失败，且草稿采用状态未能完整回滚。',
          );
          Object.assign(rollbackFailure, { cause: error, rollbackError });
          throw rollbackFailure;
        }
        throw error;
      }
    }
    const adoptedWithContent = {
      ...adopted,
      content: target.content,
      contentState: target.contentState,
    };
    if (!isTauriRuntime() && options.afterFormalAdoption) {
      try {
        await options.afterFormalAdoption(adoptedWithContent);
      } catch (error) {
        try {
          if (browserSnapshot) restoreBrowserAdoptionSnapshot(browserSnapshot);
        } catch (rollbackError) {
          const failure = new Error('浏览器章节采用后授权消费失败，且本地事实回滚未完整成功。');
          Object.assign(failure, { cause: error, rollbackError });
          throw failure;
        }
        throw error;
      }
    }
    try {
      const { autonomousPostChapterService, runAutonomousPostChapterAnalysis } =
        await import('../autonomous-creation/autonomousPostChapterRuntime');
      const plan = await autonomousPostChapterService.markAdopted(adoptedWithContent);
      if (plan) {
        void runAutonomousPostChapterAnalysis(plan.planId, adoptedWithContent).catch((error) =>
          appLogger.warn('[AutonomousCreation] 章节收束候选生成失败', error),
        );
      }
    } catch (error) {
      appLogger.warn('[AutonomousCreation] 章节采用进度同步失败', error);
    }
    if (options.actor !== 'autonomous_full_auto') {
      const { autonomousSchedulerWorker } =
        await import('../autonomous-creation/autonomousSchedulerWorker');
      try {
        await autonomousSchedulerWorker.promoteUserAdoptedDraft(adoptedWithContent);
      } catch (error) {
        // The formal chapter adoption above is already committed. Scheduler
        // projection is a post-commit convenience and must not turn a
        // successful adoption into a false failure. Startup/plan recovery can
        // reconcile this projection later from the adopted draft fact.
        appLogger.warn('[AutonomousCreation] 章节采用后调度投影失败', {
          novelId: adoptedWithContent.novelId,
          chapterId: adoptedWithContent.chapterId,
          draftId: adoptedWithContent.id,
          error,
        });
      }
    }
    const { ingestAdoptedDraftMemorySafe } = await import('../memory/adoptedDraftMemory');
    await ingestAdoptedDraftMemorySafe(adoptedWithContent);
    return adoptedWithContent;
  },

  async delete(id: string, chapterId: string): Promise<void> {
    const traceId = createTraceId('draft-delete');
    await dbCall<void>('delete_chapter_draft', { id, chapterId, traceId }, () =>
      saveLocalDrafts(
        chapterId,
        getLocalDrafts(chapterId).filter((draft) => draft.id !== id),
        normalizeDrafts,
      ),
    );
  },

  captureBrowserAdoptionState(chapterId: string): BrowserAdoptionSnapshot | null {
    if (isTauriRuntime()) return null;
    return captureBrowserAdoptionSnapshot(chapterId);
  },

  restoreBrowserAdoptionState(snapshot: BrowserAdoptionSnapshot): void {
    if (isTauriRuntime()) throw new Error('桌面端采用回滚必须由 SQLite 事务完成。');
    restoreBrowserAdoptionSnapshot(snapshot);
  },
};
