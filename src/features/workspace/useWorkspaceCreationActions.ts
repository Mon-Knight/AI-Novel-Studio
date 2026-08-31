import { useCallback, useState, type MutableRefObject } from 'react';
import {
  createChapterInVolume,
  createFirstVolumeAndChapter,
  createVolumeForNovel,
} from '../../services/chapters/chapterCreationService';
import { chapterRepository } from '../../services/database/chapterRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { appLogger } from '../../services/observability/appLogger';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { EditorContentSnapshot } from '../../types/workspaceSafety';
import type { LeaveDecision, WorkspaceLeaveRequest } from '../../types/workspaceLeave';
import type { Volume } from '../../types/volume';
import { describeUnknownError } from '../../utils/errorMessage';
import { showError, showInfo } from '../../utils/nativeDialog';
import type { ChapterDocumentLoadState, WorkspaceLoadState } from './useWorkspaceChapterLoader';

type ChapterUpdate = Chapter[] | ((current: Chapter[]) => Chapter[]);
type RequestWorkspaceLeave = (request: WorkspaceLeaveRequest) => Promise<LeaveDecision>;

interface WorkspaceCreationRefs {
  activeChapterId: MutableRefObject<string>;
  currentDraft: MutableRefObject<ChapterDraft | null>;
  editorSnapshot: MutableRefObject<EditorContentSnapshot>;
  chapterGoalDirty: MutableRefObject<boolean>;
  documentBlocked: MutableRefObject<boolean>;
}

interface UseWorkspaceCreationActionsInput {
  novelId?: string;
  refs: WorkspaceCreationRefs;
  requestWorkspaceLeave: RequestWorkspaceLeave;
  commitActiveChapter(chapterId: string): void;
  setVolumes(value: Volume[]): void;
  setChapters(value: ChapterUpdate): void;
  setCurrentDraft(value: ChapterDraft | null): void;
  setDraftWordCount(value: number): void;
  setDirty(value: boolean): void;
  setChapterGoalDirty(value: boolean): void;
  setLoadState(value: WorkspaceLoadState): void;
  setChapterDocumentLoad(value: ChapterDocumentLoadState): void;
  clearContentLoadError(): void;
}

export function useWorkspaceCreationActions({
  novelId,
  refs,
  requestWorkspaceLeave,
  commitActiveChapter,
  setVolumes,
  setChapters,
  setCurrentDraft,
  setDraftWordCount,
  setDirty,
  setChapterGoalDirty,
  setLoadState,
  setChapterDocumentLoad,
  clearContentLoadError,
}: UseWorkspaceCreationActionsInput) {
  const [creating, setCreating] = useState(false);

  const activateCreatedChapter = useCallback(
    (result: { chapter: Chapter; draft: ChapterDraft }) => {
      setChapterGoalDirty(false);
      refs.chapterGoalDirty.current = false;
      commitActiveChapter(result.chapter.id);
      setLoadState('ready');
      setCurrentDraft(result.draft);
      refs.currentDraft.current = result.draft;
      refs.documentBlocked.current = false;
      setChapterDocumentLoad({ status: 'ready', chapterId: result.chapter.id });
      clearContentLoadError();
      setDraftWordCount(0);
      setDirty(false);
    },
    [
      clearContentLoadError,
      commitActiveChapter,
      refs.chapterGoalDirty,
      refs.currentDraft,
      refs.documentBlocked,
      setChapterDocumentLoad,
      setChapterGoalDirty,
      setCurrentDraft,
      setDirty,
      setDraftWordCount,
      setLoadState,
    ],
  );

  const handleCreateFirstChapter = useCallback(
    async (chapterTitle?: string, targetWordCount?: number) => {
      if (!novelId || creating) {
        appLogger.warn('[Workspace] createFirstChapter skipped', { novelId, creating });
        return;
      }
      setCreating(true);
      try {
        const result = await createFirstVolumeAndChapter(novelId, {
          chapterTitle: chapterTitle?.trim() || '第1章',
          targetWordCount,
        });
        const [volumes, chapters] = await Promise.all([
          volumeRepository.getByNovelId(novelId),
          chapterRepository.getByNovelId(novelId),
        ]);
        setVolumes(volumes);
        setChapters(chapters);
        activateCreatedChapter(result);
        appLogger.info('[Workspace] first chapter created', {
          chapterId: result.chapter.id,
          volumeCount: volumes.length,
          chapterCount: chapters.length,
        });
      } catch (error) {
        appLogger.error('[Workspace] createFirstChapter failed', error);
        await showError({
          title: '创建章节失败',
          message: describeUnknownError(error, '创建首章失败'),
        });
      } finally {
        setCreating(false);
      }
    },
    [activateCreatedChapter, creating, novelId, setChapters, setVolumes],
  );

  const handleCreateVolume = useCallback(
    async (title: string) => {
      if (!novelId) throw new Error('novelId 缺失');
      appLogger.info('[Workspace] creating volume', { titleLength: title.length });
      await createVolumeForNovel(novelId, title);
      setVolumes(await volumeRepository.getByNovelId(novelId));
    },
    [novelId, setVolumes],
  );

  const handleCreateChapter = useCallback(
    async (volumeId: string, title: string, targetWordCount?: number) => {
      if (!novelId) throw new Error('novelId 缺失');
      const decision = await requestWorkspaceLeave({
        reason: 'chapter_create',
        targetNovelId: novelId,
        continueAction: async () => {
          const guardedChapterId = refs.activeChapterId.current;
          const guardedSnapshot = { ...refs.editorSnapshot.current };
          const guardedGoalDirty = refs.chapterGoalDirty.current;
          const result = volumeId
            ? await createChapterInVolume(novelId, volumeId, title, { targetWordCount })
            : await createFirstVolumeAndChapter(novelId, { chapterTitle: title, targetWordCount });
          const [volumes, chapters] = await Promise.all([
            volumeRepository.getByNovelId(novelId),
            chapterRepository.getByNovelId(novelId),
          ]);
          setVolumes(volumes);
          setChapters(chapters);

          const activate = () => {
            activateCreatedChapter(result);
            appLogger.info('[Workspace] chapter created and activated', {
              chapterId: result.chapter.id,
            });
          };
          if (refs.activeChapterId.current !== guardedChapterId) {
            await showInfo({
              title: '新章节已创建',
              message: '创建期间当前章节已经切换。新章节已保留在目录中，未覆盖当前编辑器。',
            });
            return;
          }
          const liveSnapshot = refs.editorSnapshot.current;
          const editorChangedSinceGuard =
            liveSnapshot.chapterId !== guardedSnapshot.chapterId ||
            liveSnapshot.draftId !== guardedSnapshot.draftId ||
            liveSnapshot.draftVersion !== guardedSnapshot.draftVersion ||
            liveSnapshot.contentHash !== guardedSnapshot.contentHash ||
            liveSnapshot.isDirty !== guardedSnapshot.isDirty;
          const goalChangedSinceGuard = refs.chapterGoalDirty.current !== guardedGoalDirty;
          if (editorChangedSinceGuard || goalChangedSinceGuard) {
            const followupDecision = await requestWorkspaceLeave({
              reason: 'chapter_create',
              targetNovelId: novelId,
              targetChapterId: result.chapter.id,
              continueAction: activate,
            });
            if (followupDecision === 'save_failed') {
              throw new Error('新章节已创建，但切换前保存当前工作区失败。');
            }
            if (followupDecision !== 'proceed') {
              await showInfo({
                title: '新章节已创建',
                message: '已保留创建期间的新编辑内容；新章节可从左侧目录打开。',
              });
            }
            return;
          }
          activate();
        },
      });
      if (decision === 'cancel') {
        throw { code: 'WORKSPACE_LEAVE_CANCELLED', message: '已取消创建章节。' };
      }
      if (decision === 'save_failed') {
        throw new Error('创建章节后的工作区切换失败，请刷新章节列表确认结果后再重试。');
      }
    },
    [
      activateCreatedChapter,
      novelId,
      refs.activeChapterId,
      refs.chapterGoalDirty,
      refs.editorSnapshot,
      requestWorkspaceLeave,
      setChapters,
      setVolumes,
    ],
  );

  return {
    creating,
    handleCreateFirstChapter,
    handleCreateVolume,
    handleCreateChapter,
  };
}
