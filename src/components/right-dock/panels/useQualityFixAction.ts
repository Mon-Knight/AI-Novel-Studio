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
import { qualityCheckAiService } from '../../../services/ai/qualityCheckAiService';
import { qualityFixService } from '../../../services/ai/qualityFixService';
import type {
  FixComparison,
  FixScopeValidation,
  QualityFixRun,
} from '../../../services/ai/qualityFixService';
import { fixRunStore } from '../../../services/ai/fixRunStore';
import {
  getContextForChapterTask,
  buildContextPromptSection,
} from '../../../services/prompt/contextReaderService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import {
  qualityCheckService,
  computeStatistics,
} from '../../../services/quality/qualityCheckService';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { hashTextContent } from '../../../utils/contentHash';
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

  useEffect(() => {
    setFixLoading(false);
    setFixStage('');
    setFixProgress(0);
    setFixComparison(null);
    setFixScopeValidation(null);
    setFixError('');
    setLastFixRunId('');
    setSourceDraftId('');
    hideAiModal?.();
  }, [novelId, chapter?.id, hideAiModal]);

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

    if (fixLoading || loading || activeOperationRef.current) return; // v1.7.20 防重复
    const controller = beginOperation();
    if (!controller) return;
    const { signal } = controller;
    let activeFixRun: QualityFixRun | null = null;
    let candidateDraft: ChapterDraft | null = null;
    let terminalCommitStarted = false;
    setFixLoading(true);
    setFixError('');
    setFixComparison(null);
    setFixProgress(0);
    setSourceDraftId(currentDraft.id);
    showAiModal?.('AI 正在修复并复检', 'AI 正在根据质量问题自动优化正文……');
    try {
      throwIfAiRequestCancelled(signal);
      updateAiModal?.('正在分析待处理问题...', 5);
      const ignored = activeItems.filter((i) => i.status === 'ignored');

      updateAiModal?.('正在读取上下文...', 15);

      // 读取章节上下文
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

      updateAiModal?.('正在生成修订版正文...', 30);
      const { fixResult, fixRun, scopeValidation } = await qualityFixService.runFix(
        {
          novelId,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterOutline: chapter.outline,
          currentDraft,
          pendingIssues: pending,
          ignoredIssues: ignored,
          beforeReportId: activeReport.id,
          beforeScore: activeReport.overallScore || 0,
          beforePendingCount: statistics.pending,
          beforeSeriousCount: statistics.critical,
          chapterContext,
        },
        { signal, cancel: () => controller.abort() },
      );
      activeFixRun = fixRun;
      throwIfAiRequestCancelled(signal);
      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setFixScopeValidation(scopeValidation);
      }

      // v1.7.19 修稿范围门控：范围越界 → 拒绝，不创建候选草稿
      if (!scopeValidation.passed) {
        fixRun.status = 'failed';
        fixRun.failureReason = scopeValidation.rejectReason || '修稿范围校验未通过';
        fixRun.warnings = JSON.stringify(scopeValidation.warnings);
        throwIfAiRequestCancelled(signal);
        terminalCommitStarted = true;
        updateOperationPhase(controller, 'committing');
        await fixRunStore.save(fixRun);
        throw new Error(scopeValidation.rejectReason || '修稿范围越界，修订版未采用');
      }

      // 保存上下文信息到 fixRun
      fixRun.usedContextIds = JSON.stringify(usedCtxIds);
      fixRun.skippedContextIds = JSON.stringify(skippedCtxIds);
      fixRun.warnings = JSON.stringify(ctxWarnings);
      throwIfAiRequestCancelled(signal);
      updateOperationPhase(controller, 'committing');
      await fixRunStore.save(fixRun);
      throwIfAiRequestCancelled(signal);
      updateOperationPhase(controller, 'available');
      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setLastFixRunId(fixRun.id);
      }

      if (fixRun.status === 'failed') {
        if (
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          setFixError(fixRun.failureReason || 'AI 修稿失败');
          setFixLoading(false);
        }
        return;
      }

      updateAiModal?.('正在保存新草稿版本...', 60);
      throwIfAiRequestCancelled(signal);
      updateOperationPhase(controller, 'committing');
      candidateDraft = await draftVersionService.create({
        novelId,
        chapterId: chapter.id,
        title: chapter.title,
        content: fixResult.revisedContent,
        source: 'ai_regenerated',
      });
      throwIfAiRequestCancelled(signal);
      updateOperationPhase(controller, 'available');
      const newDraft = candidateDraft;

      fixRun.targetDraftId = newDraft.id;
      fixRun.targetDraftVersion = newDraft.versionNo;

      updateAiModal?.('正在重新质量检查...', 75);
      const fixedContentHash = hashTextContent(fixResult.revisedContent);
      const checkResult = await qualityCheckAiService.runCheck(
        {
          novelId,
          chapterId: chapter.id,
          draftId: newDraft.id,
          volumeId: chapter.volumeId,
          draftContent: fixResult.revisedContent,
          chapterTitle: chapter.title,
          chapterOutline: chapter.outline,
          chapterGoal: chapter.goal,
          contentHash: fixedContentHash,
          wordCount: newDraft.wordCount,
        },
        { signal, cancel: () => controller.abort() },
      );
      throwIfAiRequestCancelled(signal);

      updateAiModal?.('正在对比修复效果...', 90);
      const candidateCheckedAt = new Date().toISOString();
      const afterItemsForStats: QualityCheckItem[] = checkResult.items.map((it, index) => ({
        id: `candidate-${index}`,
        reportId: 'candidate',
        novelId,
        chapterId: chapter.id,
        draftId: newDraft.id,
        issueType: (it.issueType || 'other') as QualityCheckItem['issueType'],
        severity: (it.severity || 'medium') as QualityCheckItem['severity'],
        title: it.title || '',
        description: it.description || '',
        category: it.category,
        evidence: it.evidence,
        suggestion: it.suggestion,
        quote: it.quote,
        startOffset: it.startOffset,
        endOffset: it.endOffset,
        paragraphIndex: it.paragraphIndex,
        issueKey: `candidate-${index}`,
        status: 'pending',
        createdAt: candidateCheckedAt,
        updatedAt: candidateCheckedAt,
      }));
      const afterStats = computeStatistics(afterItemsForStats);
      const comparison = qualityFixService.compareResults(
        fixRun.beforeScore,
        checkResult.overallScore,
        fixRun.beforePendingCount,
        afterStats.pending,
        fixRun.beforeSeriousCount,
        afterStats.critical,
        activeItems.length,
        afterItemsForStats.length,
        statistics.high,
        afterStats.high,
        fixResult.fixedIssueKeys.length,
      );
      if (
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setFixComparison(comparison);
      }
      fixRun.targetContentHash = fixedContentHash;
      fixRun.afterScore = checkResult.overallScore;
      fixRun.afterPendingCount = afterStats.pending;
      fixRun.afterSeriousCount = afterStats.critical;
      fixRun.fixedIssueIds = activeItems
        .filter((i) => fixResult.fixedIssueKeys.includes(i.issueKey))
        .map((i) => i.id);
      fixRun.newIssueIds = afterItemsForStats.map((i) => i.issueKey);

      throwIfAiRequestCancelled(signal);
      terminalCommitStarted = true;
      updateOperationPhase(controller, 'committing');
      if (comparison.isBetter) {
        updateAiModal?.('正在保存通过复检的质量结果...', 95);
        const rpt2 = await qualityCheckService.createReport({
          novelId,
          chapterId: chapter.id,
          draftId: newDraft.id,
          contentHash: fixedContentHash,
          contentLength: fixResult.revisedContent.length,
          checkedAt: candidateCheckedAt,
        });
        const saved2 = await qualityCheckService.saveResult({
          reportId: rpt2.id,
          novelId,
          chapterId: chapter.id,
          draftId: newDraft.id,
          result: checkResult,
          draftVersion: newDraft.versionNo,
          contentHash: fixedContentHash,
          contentLength: fixResult.revisedContent.length,
          checkedAt: candidateCheckedAt,
          aiTaskId: checkResult.aiTaskId,
        });
        fixRun.afterReportId = saved2.report?.id || rpt2.id;
        fixRun.status = 'adopted';

        updateAiModal?.('正在更新问题状态...', 98);
        for (const key of fixResult.fixedIssueKeys) {
          const item = activeItems.find((i) => i.issueKey === key);
          if (item)
            await qualityCheckService.updateIssueStatus(item.id, 'resolved').catch(() => {});
        }

        const refreshed = await qualityCheckService
          .getChapterIssues(chapter.id)
          .catch(() => saved2);
        const reports = await resolveCurrentQualityRequest(
          () => qualityCheckService.listReports(requestChapterId).catch(() => historyReports),
          () =>
            liveNovelIdRef.current === requestNovelId &&
            liveChapterIdRef.current === requestChapterId,
        );
        if (reports) {
          setHistoryReports(reports);
          setSelectedReportId(refreshed.report?.id || '');
        }

        // 复检确认更好后，才同步新草稿到当前写作工作台。
        const resultMetadata: DraftResultMetadata = {
          resultId: newDraft.id,
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
          setCurrentDraft(newDraft);
        }
        if (
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          if (onGenerated) {
            onGenerated(newDraft, resultMetadata);
          } else {
            await onApplyAiText?.({
              ...resultMetadata,
              mode: 'replace_all',
              text: fixResult.revisedContent,
              source: 'quality_check',
            });
          }
        }

        if (
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          syncUp(
            refreshed.report
              ? {
                  ...refreshed.report,
                  contentHash: fixedContentHash,
                  contentLength: fixResult.revisedContent.length,
                  checkedAt: candidateCheckedAt,
                }
              : null,
            refreshed.items,
          );
        }
      } else {
        fixRun.status = 'success';
        if (
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          setFixStage('修复候选已保存为草稿，因复检未明显变好，当前正文保持不变');
        }
      }
      await fixRunStore.save(fixRun).catch(() => {});

      // 标记旧章节上下文和卷上下文过期
      if (comparison.isBetter) {
        await chapterSummaryService.markExpired(chapter.id);
        const allRecords = await contextRecordService.getByNovelId(novelId);
        for (const r of allRecords) {
          if (
            r.contextType === 'volume_summary' &&
            r.volumeId === chapter.volumeId &&
            !r.isExpired
          ) {
            await contextRecordService.update(r.id, { isExpired: true });
          }
        }
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
      const cancelled = !terminalCommitStarted && (signal.aborted || isAiRequestCancelled(e));
      if (cancelled) {
        const cleanup: Promise<unknown>[] = [];
        if (candidateDraft) {
          cleanup.push(draftVersionService.delete(candidateDraft.id, requestChapterId));
        }
        if (activeFixRun) {
          activeFixRun.status = 'cancelled';
          activeFixRun.failureReason = undefined;
          activeFixRun.targetDraftId = undefined;
          activeFixRun.targetDraftVersion = undefined;
          activeFixRun.updatedAt = new Date().toISOString();
          cleanup.push(fixRunStore.save(activeFixRun));
        }
        await Promise.allSettled(cleanup);
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
    lastFixRunId,
    setFixStage,
    setFixComparison,
    handleAIFix,
    resetAfterStop,
  };
}
