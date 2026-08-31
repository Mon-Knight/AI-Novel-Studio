import { useCallback, useEffect, useRef, useState } from 'react';
import { chapterSummarizeService } from '../../services/ai/chapterSummarizeService';
import { isAiRequestCancelled, throwIfAiRequestCancelled } from '../../services/ai/aiCancellation';
import { chapterContextPersistenceService } from '../../services/context/chapterContextPersistenceService';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { appLogger } from '../../services/observability/appLogger';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import { describeUnknownError } from '../../utils/errorMessage';
import { showError, showInfo } from '../../utils/nativeDialog';

type ChapterUpdate = Chapter[] | ((chapters: Chapter[]) => Chapter[]);

interface UseWorkspaceSummaryInput {
  novelId?: string;
  activeChapter?: Chapter;
  currentDraft: ChapterDraft | null;
  contentAvailable: boolean;
  setChapters(update: ChapterUpdate): void;
  bumpContextVersion(): void;
}

export function useWorkspaceSummary({
  novelId,
  activeChapter,
  currentDraft,
  contentAvailable,
  setChapters,
  bumpContextVersion,
}: UseWorkspaceSummaryInput) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<ChapterSummarizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exists, setExists] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeChapterId = activeChapter?.id ?? '';

  useEffect(() => {
    let cancelled = false;
    if (!activeChapterId) {
      setExists(false);
      return undefined;
    }
    void chapterSummaryService.getByChapterId(activeChapterId).then(
      (existing) => {
        if (!cancelled) setExists(Boolean(existing));
      },
      (readError: unknown) => {
        appLogger.error('[WritingWorkspace] failed to read chapter summary state', readError);
        if (!cancelled) {
          setExists(false);
          void showError({
            title: '章节上下文读取失败',
            message:
              readError instanceof Error ? readError.message : '无法读取当前章节的上下文状态。',
            testId: 'error-notice',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeChapterId]);

  const generate = useCallback(async () => {
    if (!novelId || !activeChapter || !currentDraft || abortRef.current) return;
    if (!contentAvailable || currentDraft.contentState?.status === 'unavailable') {
      setError('完整正文暂时无法读取，已阻止生成章节总结。');
      return;
    }
    if (!currentDraft.isAdopted) {
      await showInfo({
        title: '请先采用正文',
        message: '请先点击写作工作台右侧的「采用」，确认当前正文后再生成章节总结。',
      });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const generated = await chapterSummarizeService.summarize(
        {
          novelId,
          chapterId: activeChapter.id,
          adoptedDraftId: currentDraft.id,
          chapterTitle: activeChapter.title,
          chapterOutline: activeChapter.outline,
          adoptedContent: currentDraft.content,
        },
        { signal: controller.signal, cancel: () => controller.abort() },
      );
      throwIfAiRequestCancelled(controller.signal);
      setResult(generated);
      setDialogOpen(true);
    } catch (generationError) {
      setError(
        controller.signal.aborted || isAiRequestCancelled(generationError)
          ? ''
          : describeUnknownError(generationError, '总结生成失败'),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [novelId, activeChapter, currentDraft, contentAvailable]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
  }, [activeChapterId]);

  const save = useCallback(
    async (edited: ChapterSummarizeResult) => {
      if (!novelId || !activeChapter || !currentDraft) return;
      try {
        await chapterContextPersistenceService.save({
          novelId,
          chapterId: activeChapter.id,
          adoptedDraftId: currentDraft.id,
          summary: {
            novelId,
            chapterId: activeChapter.id,
            volumeId: activeChapter.volumeId,
            adoptedDraftId: currentDraft.id,
            summary: edited.summary,
            keyEvents: edited.keyEvents,
            characterChanges: edited.characterChanges,
            relationshipChanges: edited.relationshipChanges,
            newForeshadows: edited.newForeshadows,
            resolvedForeshadows: edited.resolvedForeshadows,
            nextChapterHints: edited.nextChapterHints,
            coreEvents: edited.coreEvents,
            protagonistStateChange: edited.protagonistStateChange,
            importantCharacterChanges: edited.importantCharacterChanges,
            settingChanges: edited.settingChanges,
            newLocations: edited.newLocations,
            newItemsOrAbilities: edited.newItemsOrAbilities,
            foreshadowing: edited.foreshadowing,
            unresolvedQuestions: edited.unresolvedQuestions,
            factsMustRemember: edited.factsMustRemember,
            nextChapterHook: edited.nextChapterHook,
            draftVersion: currentDraft.versionNo,
          },
          contextRecords: edited.contextRecords.map((record) => ({
            ...record,
            novelId,
            chapterId: activeChapter.id,
            volumeId: activeChapter.volumeId,
            draftVersion: currentDraft.versionNo,
          })),
          characterStates: edited.characterChanges.flatMap((change) =>
            change.characterId
              ? [
                  {
                    novelId,
                    characterId: change.characterId,
                    chapterId: activeChapter.id,
                    stateSummary: change.stateSummary,
                    relationshipChanges: change.relationshipChanges,
                    goalChanges: change.goalChanges,
                    location: change.location,
                    healthState: change.healthState,
                    knowledgeState: change.knowledgeState,
                  },
                ]
              : [],
          ),
        });
        setChapters((chapters) =>
          chapters.map((chapter) =>
            chapter.id === activeChapter.id ? { ...chapter, status: 'summarized' } : chapter,
          ),
        );
        bumpContextVersion();
        setDialogOpen(false);
        setExists(true);
        setResult(null);
      } catch (saveError) {
        setError(describeUnknownError(saveError, '保存失败'));
      }
    },
    [novelId, activeChapter, currentDraft, bumpContextVersion, setChapters],
  );

  const regenerate = useCallback(async () => {
    setError('');
    await generate();
  }, [generate]);

  return {
    dialogOpen,
    setDialogOpen,
    result,
    setResult,
    loading,
    error,
    setError,
    exists,
    generate,
    stop,
    save,
    regenerate,
  };
}
