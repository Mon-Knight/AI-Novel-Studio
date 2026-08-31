import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { aiTaskRuntimeService } from '../../services/ai-tasks/aiTaskRuntimeService';
import { artifactDecisionService } from '../../services/conversation/artifactDecisionService';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import { novelRepository } from '../../services/database/novelRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { appLogger } from '../../services/observability/appLogger';
import { createTraceId, logWorkspaceError } from '../../services/workspace/workspaceErrorService';
import type { ChapterDraft } from '../../types/ai';
import { normalizeAppError } from '../../types/appError';
import type { Chapter } from '../../types/chapter';
import type { ReviewCandidateDocument } from '../../types/conversation';
import type { DraftContentState } from '../../types/draftContentState';
import type { EditorContentSnapshot } from '../../types/workspaceSafety';
import type { Novel } from '../../types/novel';
import type { Volume } from '../../types/volume';
import { countTextWords } from '../../utils/contentHash';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import {
  MonotonicDocumentLoadGuard,
  resolveGuardedDocumentLoad,
  validateDraftDocumentTarget,
} from './documentSafety';
import { CHAPTER_DOCUMENT_LOAD_ERROR } from './workspaceDocumentMessages';

const NOVEL_LOAD_RETRY_DELAYS_MS = [120, 240, 480];

export type ChapterDocumentLoadState =
  | { status: 'ready'; chapterId?: string }
  | { status: 'loading'; chapterId: string }
  | { status: 'error'; chapterId: string; message: string };

export type WorkspaceLoadState = 'loading' | 'ready' | 'novel_not_found' | 'error';

type ChapterUpdate = Chapter[] | ((current: Chapter[]) => Chapter[]);

interface WorkspaceLoaderRefs {
  activeNovelId: MutableRefObject<string>;
  activeChapterId: MutableRefObject<string>;
  editorSnapshot: MutableRefObject<EditorContentSnapshot>;
  currentDraft: MutableRefObject<ChapterDraft | null>;
}

interface UseWorkspaceChapterLoaderInput {
  novelId?: string;
  requestedChapterId?: string | null;
  requestedDraftId?: string;
  requestedArtifactId?: string;
  requestedAuthorizationId?: string;
  refs: WorkspaceLoaderRefs;
  setNovel(value: Novel | null): void;
  setVolumes(value: Volume[]): void;
  setChapters(value: ChapterUpdate): void;
  setActiveChapterId(value: string): void;
  setCurrentDraft(value: ChapterDraft | null): void;
  setDraftWordCount(value: number): void;
  setDirty(value: boolean): void;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getNovelForWorkspace(novelId: string): Promise<Novel | null> {
  for (let attempt = 0; attempt <= NOVEL_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    const found = await novelRepository.getById(novelId);
    if (found) return found;
    const delay = NOVEL_LOAD_RETRY_DELAYS_MS[attempt];
    if (delay) {
      appLogger.info('[Workspace] novel not found on first read, retrying...', {
        novelId,
        attempt: attempt + 1,
        delay,
      });
      await wait(delay);
    }
  }
  const allNovels = await novelRepository.getAll().catch((error) => {
    appLogger.warn('[Workspace] failed to recheck novel list after missing novel', {
      novelId,
      error,
    });
    return [];
  });
  return allNovels.find((item) => item.id === novelId) ?? null;
}

export function useWorkspaceChapterLoader({
  novelId,
  requestedChapterId,
  requestedDraftId,
  requestedArtifactId,
  requestedAuthorizationId,
  refs,
  setNovel,
  setVolumes,
  setChapters,
  setActiveChapterId,
  setCurrentDraft,
  setDraftWordCount,
  setDirty,
}: UseWorkspaceChapterLoaderInput) {
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [loadState, setLoadState] = useState<WorkspaceLoadState>('loading');
  const [reviewCandidate, setReviewCandidate] = useState<ReviewCandidateDocument | null>(null);
  const reviewCandidateRef = useRef<ReviewCandidateDocument | null>(null);
  const [chapterDocumentLoad, setChapterDocumentLoad] = useState<ChapterDocumentLoadState>({
    status: 'ready',
  });
  const [contentLoadError, setContentLoadError] = useState<Extract<
    DraftContentState,
    { status: 'unavailable' }
  > | null>(null);
  const [retryingContent, setRetryingContent] = useState(false);
  const documentLoadGuardRef = useRef(new MonotonicDocumentLoadGuard());
  const documentBlockedRef = useRef(false);
  const isChapterDocumentBlocked =
    chapterDocumentLoad.status === 'loading' ||
    (chapterDocumentLoad.status === 'error' &&
      chapterDocumentLoad.chapterId === refs.activeChapterId.current);
  documentBlockedRef.current = isChapterDocumentBlocked;

  const updateReviewCandidate = useCallback((candidate: ReviewCandidateDocument | null) => {
    reviewCandidateRef.current = candidate;
    setReviewCandidate(candidate);
  }, []);

  const commitActiveChapter = useCallback(
    (chapterId: string) => {
      documentLoadGuardRef.current.invalidate();
      refs.activeChapterId.current = chapterId;
      setActiveChapterId(chapterId);
      setCurrentDraft(null);
      setContentLoadError(null);
      refs.currentDraft.current = null;
    },
    [refs.activeChapterId, refs.currentDraft, setActiveChapterId, setCurrentDraft],
  );

  const loadChapterDraft = useCallback(
    async (
      chapterId: string,
      activateOnSuccess = false,
      selectedDraftId?: string,
      candidateArtifactId?: string,
      candidateAuthorizationId?: string,
    ) => {
      const requestNovelId = refs.activeNovelId.current;
      if (!requestNovelId) return false;
      const target = { novelId: requestNovelId, chapterId };
      const token = documentLoadGuardRef.current.issue(target);
      documentBlockedRef.current = true;
      setChapterDocumentLoad({ status: 'loading', chapterId });
      setContentLoadError(null);
      try {
        if (candidateAuthorizationId) {
          const auth = await artifactDecisionService.getAuthorization(candidateAuthorizationId);
          if (!auth || auth.status === 'expired') {
            throw new Error('审阅授权不存在或已失效。');
          }
          if (auth.novelId !== requestNovelId || auth.chapterId !== chapterId) {
            throw new Error('审阅授权与当前作品或章节不匹配。');
          }
          if (candidateArtifactId && auth.artifactId !== candidateArtifactId) {
            throw new Error('审阅授权与产物标识不匹配。');
          }
          if (auth.status === 'consumed') {
            if (!auth.consumedByDraftId) {
              throw new Error('审阅授权已消费，但缺少采用草稿引用。');
            }
            const adoptedDraft = await draftVersionService.getById(
              chapterId,
              auth.consumedByDraftId,
            );
            if (
              !adoptedDraft ||
              !adoptedDraft.isAdopted ||
              adoptedDraft.novelId !== requestNovelId ||
              adoptedDraft.chapterId !== chapterId
            ) {
              throw new Error('审阅授权已消费，但采用草稿状态不一致。');
            }
            if (activateOnSuccess) commitActiveChapter(chapterId);
            updateReviewCandidate(null);
            setCurrentDraft(adoptedDraft);
            refs.currentDraft.current = adoptedDraft;
            setDraftWordCount(adoptedDraft.wordCount);
            setDirty(false);
            documentBlockedRef.current = false;
            setChapterDocumentLoad({ status: 'ready', chapterId });
            return true;
          }
          const artifactBundle = await aiTaskRuntimeService
            .getArtifact(auth.artifactId)
            .catch(() => null);
          if (!artifactBundle?.rawContent) {
            throw new Error('候选产物正文为空或无法读取。');
          }
          const computedHash = await computeContentSha256(artifactBundle.rawContent);
          if (
            artifactBundle.artifact.contentHash &&
            !computedHash.startsWith('fallback_') &&
            computedHash.toLowerCase() !== artifactBundle.artifact.contentHash.toLowerCase()
          ) {
            throw new Error('候选产物内容哈希校验失败。');
          }
          if (activateOnSuccess) commitActiveChapter(chapterId);
          const candidateDoc: ReviewCandidateDocument = {
            authorizationId: auth.authorizationId,
            artifactId: auth.artifactId,
            content: artifactBundle.rawContent,
            contentHash: artifactBundle.artifact.contentHash || computedHash,
            chapterId,
            novelId: requestNovelId,
          };
          updateReviewCandidate(candidateDoc);
          setCurrentDraft(null);
          refs.currentDraft.current = null;
          setDraftWordCount(countTextWords(candidateDoc.content));
          setDirty(false);
          documentBlockedRef.current = false;
          setChapterDocumentLoad({ status: 'ready', chapterId });
          return true;
        }

        updateReviewCandidate(null);
        const draftRequest = selectedDraftId
          ? draftVersionService.getById(chapterId, selectedDraftId).then((draft) => {
              if (!draft) throw new Error('指定的候选草稿不存在或不属于当前章节。');
              return draft;
            })
          : draftVersionService.getLatestByChapterId(chapterId);
        const resolved = await resolveGuardedDocumentLoad(
          documentLoadGuardRef.current,
          token,
          draftRequest,
          () =>
            activateOnSuccess
              ? target
              : { novelId: refs.activeNovelId.current, chapterId: refs.activeChapterId.current },
        );
        if (!resolved.accepted || refs.activeNovelId.current !== requestNovelId) return false;
        const draft = resolved.value;
        if (draft) {
          const draftDecision = validateDraftDocumentTarget(draft, target);
          if (!draftDecision.ok) throw new Error(draftDecision.message);
        }
        if (activateOnSuccess) commitActiveChapter(chapterId);
        setCurrentDraft(draft);
        refs.currentDraft.current = draft;
        setDraftWordCount(draft?.wordCount || 0);
        setDirty(false);
        documentBlockedRef.current = false;
        setChapterDocumentLoad({ status: 'ready', chapterId });
        return true;
      } catch (error) {
        appLogger.warn('[Workspace] blocked an unsafe chapter draft load', { chapterId, error });
        if (
          token.epoch === documentLoadGuardRef.current.currentEpoch &&
          refs.activeNovelId.current === requestNovelId &&
          (activateOnSuccess || refs.activeChapterId.current === chapterId)
        ) {
          documentBlockedRef.current = refs.activeChapterId.current === chapterId;
          setChapterDocumentLoad({
            status: 'error',
            chapterId,
            message: CHAPTER_DOCUMENT_LOAD_ERROR,
          });
        }
        const traceId = createTraceId('workspace-draft-load');
        const normalized = normalizeAppError(error, '完整正文暂时无法读取。', { traceId });
        logWorkspaceError('workspace_draft_load_failed', normalized, {
          traceId,
          novelId: requestNovelId,
          chapterId,
        });
        if (
          token.epoch === documentLoadGuardRef.current.currentEpoch &&
          refs.activeChapterId.current === chapterId &&
          refs.activeNovelId.current === requestNovelId
        ) {
          setContentLoadError({
            status: 'unavailable',
            errorCode:
              normalized.code === 'UNKNOWN_ERROR'
                ? 'LARGE_TEXT_CONTENT_UNAVAILABLE'
                : normalized.code,
            retryable: normalized.retryable || normalized.code === 'UNKNOWN_ERROR',
            error:
              normalized.code === 'UNKNOWN_ERROR'
                ? { ...normalized, code: 'LARGE_TEXT_CONTENT_UNAVAILABLE', retryable: true }
                : normalized,
          });
        }
        return false;
      }
    },
    [
      commitActiveChapter,
      refs.activeChapterId,
      refs.activeNovelId,
      refs.currentDraft,
      setCurrentDraft,
      setDirty,
      setDraftWordCount,
      updateReviewCandidate,
    ],
  );

  const retryActiveChapterContent = useCallback(async () => {
    const chapterId = refs.activeChapterId.current;
    if (!chapterId || retryingContent) return;
    setRetryingContent(true);
    try {
      await loadChapterDraft(chapterId);
    } finally {
      setRetryingContent(false);
    }
  }, [loadChapterDraft, refs.activeChapterId, retryingContent]);

  useEffect(() => {
    if (!novelId) return undefined;
    let cancelled = false;
    setPageLoading(true);
    setPageError('');
    setLoadState('loading');
    void Promise.allSettled([
      getNovelForWorkspace(novelId),
      volumeRepository.getByNovelId(novelId),
      chapterRepository.getByNovelId(novelId),
    ]).then(([novelResult, volumeResult, chapterResult]) => {
      if (cancelled) return;
      if (novelResult.status === 'fulfilled') {
        if (novelResult.value) setNovel(novelResult.value);
        else {
          setLoadState('novel_not_found');
          setPageLoading(false);
          return;
        }
      } else {
        setPageError('作品加载失败');
        setLoadState('error');
        setPageLoading(false);
        return;
      }
      if (volumeResult.status === 'fulfilled') setVolumes(volumeResult.value);
      if (chapterResult.status === 'fulfilled') {
        const chapters = chapterResult.value;
        setChapters(chapters);
        const targetId =
          requestedChapterId && chapters.some((chapter) => chapter.id === requestedChapterId)
            ? requestedChapterId
            : chapters[0]?.id;
        if (targetId) {
          void loadChapterDraft(
            targetId,
            true,
            targetId === requestedChapterId ? requestedDraftId : undefined,
            targetId === requestedChapterId ? requestedArtifactId : undefined,
            targetId === requestedChapterId ? requestedAuthorizationId : undefined,
          );
        } else {
          setChapterDocumentLoad({ status: 'ready' });
        }
      }
      setLoadState('ready');
      setPageLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    loadChapterDraft,
    novelId,
    requestedArtifactId,
    requestedAuthorizationId,
    requestedChapterId,
    requestedDraftId,
    setChapters,
    setNovel,
    setVolumes,
  ]);

  useEffect(() => {
    if (!novelId || loadState !== 'ready') return undefined;
    let cancelled = false;
    const refreshChapterTree = async () => {
      const latest = await chapterRepository.getByNovelId(novelId).catch(() => null);
      if (!cancelled && latest) setChapters(latest);
      const activeId = refs.activeChapterId.current;
      if (
        !cancelled &&
        activeId &&
        !refs.currentDraft.current &&
        !reviewCandidateRef.current &&
        !refs.editorSnapshot.current.isDirty &&
        !documentBlockedRef.current
      ) {
        await loadChapterDraft(activeId);
      }
    };
    const intervalId = window.setInterval(() => void refreshChapterTree(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    loadChapterDraft,
    loadState,
    novelId,
    refs.activeChapterId,
    refs.currentDraft,
    refs.editorSnapshot,
    setChapters,
  ]);

  const retryChapterDraftLoad = useCallback(() => {
    if (chapterDocumentLoad.status !== 'error') return;
    void loadChapterDraft(
      chapterDocumentLoad.chapterId,
      chapterDocumentLoad.chapterId !== refs.activeChapterId.current,
    );
  }, [chapterDocumentLoad, loadChapterDraft, refs.activeChapterId]);

  return {
    pageLoading,
    pageError,
    loadState,
    setLoadState,
    reviewCandidate,
    chapterDocumentLoad,
    setChapterDocumentLoad,
    contentLoadError,
    setContentLoadError,
    retryingContent,
    isChapterDocumentBlocked,
    documentBlockedRef,
    commitActiveChapter,
    loadChapterDraft,
    retryActiveChapterContent,
    retryChapterDraftLoad,
  };
}
