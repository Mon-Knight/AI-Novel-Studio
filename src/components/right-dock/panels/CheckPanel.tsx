import { appLogger } from '../../../services/observability/appLogger';
import { useMemo, useState } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type {
  QualityCheckReport,
  QualityCheckItem,
  QualityIssueStatus,
  QualityIssueFilter,
} from '../../../types/qualityCheck';
import {
  qualityCheckService,
  computeStatistics,
} from '../../../services/quality/qualityCheckService';
import { qualityCheckAiService } from '../../../services/ai/qualityCheckAiService';
import { qualityFixService } from '../../../services/ai/qualityFixService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { confirmInfo } from '../../../utils/nativeDialog';
import { countTextWords, hashTextContent } from '../../../utils/contentHash';
import { describeUnknownError } from '../../../utils/errorMessage';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../../types/workspaceSafety';
import { resolveCurrentQualityRequest } from '../../../features/quality/qualityRequestSafety';

import { CheckPanelView } from './CheckPanelView';
import { useQualityPanelInfrastructure } from './useQualityPanelInfrastructure';
import { useQualityFixAction } from './useQualityFixAction';
interface CheckPanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
  onAdopted?: () => void;
  /** 定位到正文指定位置的回调 (v1.7.16 支持 paragraphIndex) */
  onLocateText?: (
    startOffset: number,
    endOffset: number,
    quote?: string,
    paragraphIndex?: number,
  ) => void;
  /** v1.7.19 质量检查状态持久化 */
  qcReport?: QualityCheckReport | null;
  qcItems?: QualityCheckItem[];
  onQcChange?: (report: QualityCheckReport | null, items: QualityCheckItem[]) => void;
  currentEditorContent?: string;
  currentEditorWordCount?: number;
  currentEditorDirty?: boolean;
  currentContentHash?: string;
  currentDraftId?: string;
  currentDraftVersion?: number;
  onApplyAiText?: (payload: AiTextApplyPayload) => Promise<boolean>;
  /** v1.7.19 全局 AI 弹窗 */
  showAiModal?: (title: string, subtitle?: string) => void;
  updateAiModal?: (stage: string, progress: number) => void;
  hideAiModal?: () => void;
}

function CheckPanel({
  novelId,
  chapter,
  onGenerated,
  onLocateText,
  qcReport,
  qcItems,
  onQcChange,
  currentEditorContent,
  currentEditorWordCount,
  currentEditorDirty,
  currentContentHash,
  currentDraftId,
  currentDraftVersion,
  onApplyAiText,
  showAiModal,
  updateAiModal,
  hideAiModal,
}: CheckPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<QualityIssueFilter>('all');
  const [locateMessage, setLocateMessage] = useState('');

  const {
    liveChapterIdRef,
    liveNovelIdRef,
    mountedRef,
    activeOperationRef,
    operationPhase,
    beginOperation,
    finishOperation,
    updateOperationPhase,
    handleStopOperation,
    report,
    items,
    setItems,
    syncUp,
    currentDraft,
    setCurrentDraft,
    historyReports,
    setHistoryReports,
    selectedReportId,
    setSelectedReportId,
    historyLoading,
    latestReportId,
    handleHistoryChange: changeHistoryReport,
  } = useQualityPanelInfrastructure({
    novelId,
    chapterId: chapter?.id,
    reportProp: qcReport,
    itemsProp: qcItems,
    onChange: onQcChange,
    onError: setError,
  });

  const activeReport = report?.chapterId === chapter?.id ? report : null;
  const activeItems = useMemo(
    () => (activeReport ? items.filter((item) => item.chapterId === chapter?.id) : []),
    [activeReport, chapter?.id, items],
  );
  const effectiveContent = currentEditorContent ?? currentDraft?.content ?? '';
  const effectiveContentHash = currentContentHash || hashTextContent(effectiveContent);
  const reportOutdated =
    !!activeReport &&
    (!activeReport.contentHash ||
      activeReport.contentHash !== effectiveContentHash ||
      !currentDraftId ||
      activeReport.draftId !== currentDraftId ||
      activeReport.draftVersion === undefined ||
      currentDraftVersion === undefined ||
      activeReport.draftVersion !== currentDraftVersion ||
      Boolean(currentEditorDirty));
  const statistics = useMemo(() => computeStatistics(activeItems), [activeItems]);
  const filteredItems = useMemo(
    () => (filter === 'all' ? activeItems : activeItems.filter((item) => item.status === filter)),
    [activeItems, filter],
  );
  const viewingHistory = Boolean(
    activeReport && latestReportId && activeReport.id !== latestReportId,
  );

  const {
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
  } = useQualityFixAction({
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
  });

  const handleStop = () => {
    handleStopOperation();
    setLoading(false);
    setError('');
    resetAfterStop();
    hideAiModal?.();
  };

  const handleHistoryChange = async (reportId: string) => {
    setFilter('all');
    await changeHistoryReport(reportId);
  };

  const handleRunCheck = async () => {
    if (!novelId || !chapter) return;
    const requestChapterId = chapter.id;
    const sourceContent = currentEditorContent ?? currentDraft?.content ?? '';
    const requestBaseHash = currentContentHash || hashTextContent(sourceContent);
    const requestSourceDraftId = currentDraftId || currentDraft?.id;
    const requestSourceRevision = currentDraftVersion || currentDraft?.versionNo;
    const sourceWordCount = currentEditorWordCount ?? countTextWords(sourceContent);
    if (sourceContent.trim().length < 10 || sourceWordCount < 10) {
      setError('正文过短，请先生成或编辑正文');
      return;
    }
    if (sourceWordCount < 300) {
      const ok = await confirmInfo({
        title: '正文较短',
        message: '当前正文不足 300 字，质量检查结果可能有限。是否继续？',
      });
      if (!ok) return;
    }
    if (loading || fixLoading || activeOperationRef.current) return; // v1.7.20 防重复点击
    const controller = beginOperation();
    if (!controller) return;
    const { signal } = controller;
    setLoading(true);
    setError('');
    setLocateMessage('');
    showAiModal?.('AI 正在质量检查', 'AI 正在检查逻辑、设定和文笔……');
    try {
      throwIfAiRequestCancelled(signal);
      updateAiModal?.('正在准备检查参数……', 10);
      let sourceDraft =
        currentDraft?.novelId === novelId && currentDraft.chapterId === requestChapterId
          ? currentDraft
          : null;
      const needsSnapshotDraft =
        !sourceDraft || sourceDraft.content !== sourceContent || currentEditorDirty;
      if (needsSnapshotDraft) {
        updateAiModal?.('正在保存当前正文快照……', 18);
        throwIfAiRequestCancelled(signal);
        updateOperationPhase(controller, 'committing');
        sourceDraft = await draftVersionService.create({
          novelId,
          chapterId: chapter.id,
          title: `${chapter.title} - 质量检查快照`,
          content: sourceContent,
          source: 'user_edited',
          note: '质量检查正文快照',
        });
        throwIfAiRequestCancelled(signal);
        updateOperationPhase(controller, 'available');
        if (liveNovelIdRef.current === novelId && liveChapterIdRef.current === requestChapterId) {
          setCurrentDraft(sourceDraft);
          onGenerated?.(sourceDraft, {
            resultId: sourceDraft.id,
            novelId,
            chapterId: requestChapterId,
            sourceDraftId: requestSourceDraftId,
            sourceRevision: requestSourceRevision,
            baseContentHash: requestBaseHash,
            source: 'quality_check',
          });
        }
      }
      if (!sourceDraft) {
        throw new Error('无法创建质量检查正文快照。');
      }

      const checkedAt = new Date().toISOString();
      const contentHash = hashTextContent(sourceContent);

      updateAiModal?.('正在请求 AI 质量检查……', 35);
      const result = await qualityCheckAiService.runCheck(
        {
          novelId,
          chapterId: chapter.id,
          draftId: sourceDraft.id,
          volumeId: chapter.volumeId,
          draftContent: sourceContent,
          chapterTitle: chapter.title,
          chapterOutline: chapter.outline,
          chapterGoal: chapter.goal,
          contentHash,
          wordCount: sourceWordCount,
        },
        { signal, cancel: () => controller.abort() },
      );
      throwIfAiRequestCancelled(signal);

      if (!result || (!result.items && !result.summary)) {
        throw new Error('AI 返回内容为空，质量检查未完成。');
      }

      updateAiModal?.('正在保存检查结果……', 80);
      throwIfAiRequestCancelled(signal);
      updateOperationPhase(controller, 'committing');
      const rpt = await qualityCheckService.createReport({
        novelId,
        chapterId: chapter.id,
        draftId: sourceDraft.id,
        contentHash,
        contentLength: sourceContent.length,
        checkedAt,
      });
      const saved = await qualityCheckService.saveResult({
        reportId: rpt.id,
        novelId,
        chapterId: chapter.id,
        draftId: sourceDraft.id,
        result,
        draftVersion: sourceDraft.versionNo,
        contentHash,
        contentLength: sourceContent.length,
        checkedAt,
        aiTaskId: result.aiTaskId,
      });

      if (liveNovelIdRef.current !== novelId || liveChapterIdRef.current !== requestChapterId) {
        hideAiModal?.();
        return;
      }

      updateAiModal?.('正在加载最新结果……', 95);
      syncUp(
        saved.report
          ? {
              ...saved.report,
              contentHash,
              contentLength: sourceContent.length,
              checkedAt,
            }
          : null,
        saved.items,
      );
      const reports = await resolveCurrentQualityRequest(
        () => qualityCheckService.listReports(requestChapterId),
        () => liveNovelIdRef.current === novelId && liveChapterIdRef.current === requestChapterId,
      );
      if (!reports) return;
      setHistoryReports(reports);
      setSelectedReportId(saved.report?.id || '');
      setFilter('all');

      updateAiModal?.('质量检查完成', 100);
      // v1.7.20 成功后延迟关闭弹窗
      await new Promise((r) => setTimeout(r, 500));
      hideAiModal?.();
    } catch (e: unknown) {
      if (signal.aborted || isAiRequestCancelled(e)) {
        if (
          mountedRef.current &&
          liveNovelIdRef.current === novelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          setError('');
          hideAiModal?.();
        }
        return;
      }
      updateOperationPhase(controller, 'committing');
      if (
        !mountedRef.current ||
        liveNovelIdRef.current !== novelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      appLogger.error('[QualityCheck] run failed', e);
      const msg = describeUnknownError(e, '质量检查失败');
      setError(msg);
      // v1.7.20 失败时弹窗显示错误，不立即关闭
      updateAiModal?.(`失败: ${msg}`, 0);
      // 停留 2.5 秒后关闭
      await new Promise((r) => setTimeout(r, 2500));
      hideAiModal?.();
    } finally {
      if (mountedRef.current) setLoading(false);
      finishOperation(controller);
    }
  };

  /** 更新问题状态 */
  const handleStatusChange = async (itemId: string, newStatus: QualityIssueStatus) => {
    if (viewingHistory) return;
    const prevItems = [...items];
    const nextItems = items.map((i) =>
      i.id === itemId
        ? {
            ...i,
            status: newStatus,
            resolvedAt: newStatus === 'resolved' ? new Date().toISOString() : i.resolvedAt,
          }
        : i,
    );
    // 乐观更新
    setItems(nextItems);
    onQcChange?.(activeReport, nextItems);
    try {
      await qualityCheckService.updateIssueStatus(itemId, newStatus);
    } catch {
      // 回滚
      setItems(prevItems);
      onQcChange?.(activeReport, prevItems);
      setError('状态更新失败');
    }
  };

  const handleLocate = (item: QualityCheckItem) => {
    if (!onLocateText) {
      setLocateMessage('定位功能需要正文编辑器支持');
      return;
    }
    onLocateText(
      item.startOffset ?? -1,
      item.endOffset ?? -1,
      item.quote || item.evidence,
      item.paragraphIndex,
    );
    setLocateMessage('');
  };

  if (!chapter)
    return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;

  const aiSettings = aiSettingsService.getSettings();

  const handleRevertFix = async () => {
    if (!sourceDraftId || !currentDraft) return;
    const drafts = await draftVersionService.getByChapterId(chapter.id);
    const source = drafts.find((draft) => draft.id === sourceDraftId);
    if (!source) return;
    setCurrentDraft(source);
    await qualityFixService.revertFixRun(lastFixRunId);
    setFixComparison(null);
    setFixStage('?????????');
    setTimeout(() => setFixStage(''), 3000);
  };

  const handleConfirmFix = async () => {
    await qualityFixService.adoptFixRun(lastFixRunId);
    setFixStage('??????????');
    setTimeout(() => setFixStage(''), 3000);
  };

  return (
    <CheckPanelView
      chapter={chapter}
      aiSettings={aiSettings}
      currentDraft={currentDraft}
      loading={loading}
      operationPhase={operationPhase}
      activeReport={activeReport}
      viewingHistory={viewingHistory}
      statistics={statistics}
      fixLoading={fixLoading}
      fixStage={fixStage}
      fixProgress={fixProgress}
      fixError={fixError}
      error={error}
      historyReports={historyReports}
      selectedReportId={selectedReportId}
      historyLoading={historyLoading}
      reportOutdated={reportOutdated}
      fixComparison={fixComparison}
      fixScopeValidation={fixScopeValidation}
      activeItems={activeItems}
      filter={filter}
      locateMessage={locateMessage}
      filteredItems={filteredItems}
      onRunCheck={handleRunCheck}
      onStopOperation={handleStop}
      onAiFix={handleAIFix}
      onHistoryChange={handleHistoryChange}
      onFilterChange={setFilter}
      onLocate={handleLocate}
      onStatusChange={handleStatusChange}
      onRevertFix={handleRevertFix}
      onConfirmFix={handleConfirmFix}
    />
  );
}

export default CheckPanel;
