import { useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  QualityCheckItem,
  QualityCheckReport,
  QualityCheckStatistics,
} from '../../../types/qualityCheck';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../../types/workspaceSafety';
import { chapterQualityGateService } from '../../../services/ai/chapterQualityGateService';
import {
  getQualityFixRoundAvailability,
  qualityFixService,
} from '../../../services/ai/qualityFixService';
import type { FixComparison, FixScopeValidation } from '../../../services/ai/qualityFixService';
import { fixRunStore } from '../../../services/ai/fixRunStore';
import {
  getContextForChapterTask,
  buildContextPromptSection,
} from '../../../services/prompt/contextReaderService';
import {
  qualityCheckService,
  computeStatistics,
} from '../../../services/quality/qualityCheckService';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { describeUnknownError } from '../../../utils/errorMessage';
import { resolveCurrentQualityRequest } from '../../../features/quality/qualityRequestSafety';
import type { QualityOperationPhase } from './CheckPanelView';

interface UseQualityFixActionOptions {
  novelId?: string;
  chapter?: Chapter;
  currentDraft: ChapterDraft | null;
  activeReport: QualityCheckReport | null;
  viewingHistory: boolean;
  effectiveContentHash: string;
  currentDraftId?: string;
  currentDraftVersion?: number;
  reportOutdated: boolean;
  activeItems: QualityCheckItem[];
  statistics: QualityCheckStatistics;
  historyReports: QualityCheckReport[];
  loading: boolean;
  activeOperationRef: MutableRefObject<AbortController | null>;
  beginOperation: () => AbortController | null;
  finishOperation: (controller: AbortController) => void;
  updateOperationPhase: (controller: AbortController, phase: QualityOperationPhase) => void;
  mountedRef: MutableRefObject<boolean>;
  liveNovelIdRef: MutableRefObject<string>;
  liveChapterIdRef: MutableRefObject<string>;
  showAiModal?: (title: string, subtitle?: string) => void;
  updateAiModal?: (stage: string, progress: number) => void;
  hideAiModal?: () => void;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
  onApplyAiText?: (payload: AiTextApplyPayload) => Promise<boolean>;
  syncUp: (report: QualityCheckReport | null, items: QualityCheckItem[]) => void;
  setCurrentDraft: Dispatch<SetStateAction<ChapterDraft | null>>;
  setHistoryReports: Dispatch<SetStateAction<QualityCheckReport[]>>;
  setSelectedReportId: Dispatch<SetStateAction<string>>;
}

export function useQualityFixAction({
  novelId,
  chapter,
  currentDraft,
  activeReport,
  viewingHistory,
  effectiveContentHash,
  currentDraftId,
  currentDraftVersion,
  reportOutdated,
  activeItems,
  statistics,
  historyReports,
  loading,
  activeOperationRef,
  beginOperation,
  finishOperation,
  updateOperationPhase,
  mountedRef,
  liveNovelIdRef,
  liveChapterIdRef,
  showAiModal,
  updateAiModal,
  hideAiModal,
  onGenerated,
  onApplyAiText,
  syncUp,
  setCurrentDraft,
  setHistoryReports,
  setSelectedReportId,
}: UseQualityFixActionOptions) {
  const [fixLoading, setFixLoading] = useState(false);
  const [fixStage, setFixStage] = useState('');
  const [fixProgress, setFixProgress] = useState(0);
  const [fixComparison, setFixComparison] = useState<FixComparison | null>(null);
  const [fixScopeValidation, setFixScopeValidation] = useState<FixScopeValidation | null>(null);
  const [fixError, setFixError] = useState('');
  const [lastFixRunId, setLastFixRunId] = useState('');
  const [sourceDraftId, setSourceDraftId] = useState('');
  const [fixRoundUsed, setFixRoundUsed] = useState(false);

  useEffect(() => {
    setFixLoading(false);
    setFixStage('');
    setFixProgress(0);
    setFixComparison(null);
    setFixScopeValidation(null);
    setFixError('');
    setLastFixRunId('');
    setSourceDraftId('');
    setFixRoundUsed(false);
    hideAiModal?.();
  }, [novelId, chapter?.id, hideAiModal]);

  useEffect(() => {
    let alive = true;
    const chapterId = chapter?.id;
    const draftId = currentDraft?.id;
    if (!chapterId || !draftId) {
      setFixRoundUsed(false);
      return () => {
        alive = false;
      };
    }
    void getQualityFixRoundAvailability(chapterId, draftId)
      .then((availability) => {
        if (alive) {
          setFixRoundUsed(availability === 'completed' || availability === 'exhausted');
        }
      })
      .catch(() => {
        if (alive) setFixRoundUsed(false);
      });
    return () => {
      alive = false;
    };
  }, [chapter?.id, currentDraft?.id]);

  const handleAIFix = async () => {
    if (!novelId || !chapter || !currentDraft || !activeReport || viewingHistory) return;
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    const requestBaseHash = effectiveContentHash;
    const requestSourceDraftId = currentDraftId || currentDraft.id;
    const requestSourceRevision = currentDraftVersion || currentDraft.versionNo;
    if (reportOutdated) {
      setFixError('当前正文已修改，请先重新进行质量检测后再使用 AI 修复。');
      return;
    }
    const pending = activeItems.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;
    if (fixRoundUsed) {
      setFixError('当前正文已使用过唯一一轮外部 AI 修稿，请转人工处理。');
      return;
    }

    if (fixLoading || loading || activeOperationRef.current) return; // v1.7.20 防重复
    const controller = beginOperation();
    if (!controller) return;
    const { signal } = controller;
    setFixLoading(true);
    setFixError('');
    setFixComparison(null);
    setFixProgress(0);
    setSourceDraftId(currentDraft.id);
    setFixRoundUsed(true);
    showAiModal?.('AI 正在修复并复检', 'AI 正在根据质量问题自动优化正文……');
    try {
      throwIfAiRequestCancelled(signal);
      updateAiModal?.('正在分析待处理问题...', 5);
      updateAiModal?.('正在读取上下文...', 15);

      let chapterContext: string | undefined;
      let usedCtxIds = '';
      let skippedCtxIds = '';
      let ctxWarnings = '';
      try {
        const ctxResult = await getContextForChapterTask({
          novelId,
          chapterId: chapter.id,
          volumeId: chapter.volumeId,
          taskType: 'quality_fix',
        });
        if (ctxResult.chapterSummaries.length > 0 || ctxResult.volumeContexts.length > 0) {
          chapterContext = buildContextPromptSection(ctxResult);
        }
        usedCtxIds = JSON.stringify(
          ctxResult.chapterContexts
            .map((c) => c.id)
            .concat(ctxResult.volumeContexts.map((v) => v.id)),
        );
        skippedCtxIds = JSON.stringify([]);
        ctxWarnings = JSON.stringify(ctxResult.warnings);
      } catch {
        /* non-critical */
      }
      throwIfAiRequestCancelled(signal);

      updateAiModal?.('正在定点修稿并复评...', 30);
      setFixProgress(30);
      const result = await chapterQualityGateService.runRepairAndRecheck(
        {
          novelId,
          chapterId: chapter.id,
          volumeId: chapter.volumeId,
          chapterTitle: chapter.title,
          chapterOutline: chapter.outline,
          chapterGoal: chapter.goal,
          draft: currentDraft,
          report: activeReport,
          items: activeItems,
          chapterContext,
        },
        {
          signal,
          cancel: () => controller.abort(),
          requestIdPrefix: `quality-panel:${activeReport.id}`,
        },
      );
      throwIfAiRequestCancelled(signal);
      const fixRun = result.repairRun;
      if (!fixRun) throw new Error('质量修稿没有返回运行记录。');
      fixRun.usedContextIds = usedCtxIds;
      fixRun.skippedContextIds = skippedCtxIds;
      fixRun.warnings = ctxWarnings || fixRun.warnings;
      await fixRunStore.save(fixRun);
      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setFixScopeValidation(result.scopeValidation ?? null);
        setLastFixRunId(fixRun.id);
      }

      updateAiModal?.('正在对比修复效果...', 90);
      setFixProgress(90);
      const afterStats = computeStatistics(result.finalItems);
      const comparison = qualityFixService.compareResults(
        result.initialScore,
        result.finalScore,
        statistics.pending,
        afterStats.pending,
        statistics.critical + statistics.high,
        afterStats.critical + afterStats.high,
        activeItems.length,
        result.finalItems.length,
        statistics.high,
        afterStats.high,
        fixRun.fixedIssueIds.length,
      );
      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setFixComparison(comparison);
      }

      throwIfAiRequestCancelled(signal);
      updateOperationPhase(controller, 'committing');
      const reports = await resolveCurrentQualityRequest(
        () => qualityCheckService.listReports(requestChapterId).catch(() => historyReports),
        () =>
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId,
      );
      if (reports) {
        setHistoryReports(reports);
        setSelectedReportId(result.finalReport.id);
      }

      const resultMetadata: DraftResultMetadata = {
        resultId: result.finalDraft.id,
        novelId,
        chapterId: requestChapterId,
        sourceDraftId: requestSourceDraftId,
        sourceRevision: requestSourceRevision,
        baseContentHash: requestBaseHash,
        source: 'quality_check',
      };
      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setCurrentDraft(result.finalDraft);
        syncUp(result.finalReport, result.finalItems);
        if (onGenerated) {
          onGenerated(result.finalDraft, resultMetadata);
        } else {
          await onApplyAiText?.({
            ...resultMetadata,
            mode: 'replace_all',
            text: result.finalDraft.content,
            source: 'quality_check',
          });
        }
        setFixStage(
          result.qualityGatePassed
            ? `质量门禁通过：${result.finalScore} 分，critical/high 均为 0`
            : `修稿和复评已完成：${result.finalScore} 分，仍需人工确认处理`,
        );
      }

      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        hideAiModal?.();
        setFixLoading(false);
        setTimeout(() => {
          if (
            liveNovelIdRef.current === requestNovelId &&
            liveChapterIdRef.current === requestChapterId
          ) {
            setFixStage('');
          }
        }, 3000);
      }
    } catch (e: unknown) {
      const cancelled = signal.aborted || isAiRequestCancelled(e);
      if (cancelled) {
        if (
          mountedRef.current &&
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          setFixError('');
          setFixComparison(null);
          setFixScopeValidation(null);
          hideAiModal?.();
        }
        return;
      }
      updateOperationPhase(controller, 'committing');
      if (
        !mountedRef.current ||
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      const msg = describeUnknownError(e, 'AI 修稿失败');
      setFixError(msg);
      updateAiModal?.(`失败: ${msg}`, 0);
      await new Promise((r) => setTimeout(r, 2500));
      hideAiModal?.();
      setFixLoading(false);
    } finally {
      if (mountedRef.current) setFixLoading(false);
      finishOperation(controller);
    }
  };

  const resetAfterStop = () => {
    setFixLoading(false);
    setFixError('');
  };

  return {
    fixLoading,
    fixStage,
    fixProgress,
    fixComparison,
    fixScopeValidation,
    fixError,
    sourceDraftId,
    fixRoundUsed,
    lastFixRunId,
    setFixStage,
    setFixComparison,
    handleAIFix,
    resetAfterStop,
  };
}
