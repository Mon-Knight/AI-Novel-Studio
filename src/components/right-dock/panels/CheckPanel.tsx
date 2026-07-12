import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type {
  QualityCheckReport, QualityCheckItem, QualityIssueSeverity,
  QualityIssueStatus, QualityIssueFilter,
} from '../../../types/qualityCheck';
import {
  QualityIssueTypeLabels, QualityIssueSeverityLabels, QualityIssueSeverityColors,
  QualityIssueStatusLabels, QualityIssueFilterLabels,
} from '../../../types/qualityCheck';
import { qualityCheckService, computeStatistics } from '../../../services/quality/qualityCheckService';
import { qualityCheckAiService } from '../../../services/ai/qualityCheckAiService';
import { qualityFixService } from '../../../services/ai/qualityFixService';
import type { FixComparison, FixScopeValidation } from '../../../services/ai/qualityFixService';
import { fixRunStore } from '../../../services/ai/fixRunStore';
import { getContextForChapterTask, buildContextPromptSection } from '../../../services/prompt/contextReaderService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { confirmInfo } from '../../../utils/nativeDialog';
import { countTextWords, hashTextContent } from '../../../utils/contentHash';
import { computeContentSha256 } from '../../../utils/contentIntegrity';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../../types/workspaceSafety';
import type { PlacementProposal } from '../../../types/placement';
import { placementApplyService } from '../../../services/ai-tasks/placementApplyService';

interface FixCandidate {
  artifactId: string;
  taskId: string;
  proposal: PlacementProposal;
  content: string;
  novelId: string;
  chapterId: string;
  contentHash: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  baseContentHash: string;
  fixRunId: string;
  fixedIssueIds: string[];
}

interface CheckPanelProps {
  novelId?: string; chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void; onAdopted?: () => void;
  /** 定位到正文指定位置的回调 (v1.7.16 支持 paragraphIndex) */
  onLocateText?: (startOffset: number, endOffset: number, quote?: string, paragraphIndex?: number) => void;
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

const FILTER_OPTIONS: QualityIssueFilter[] = ['all', 'pending', 'resolved', 'ignored'];

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
  const liveChapterIdRef = useRef(chapter?.id || '');
  liveChapterIdRef.current = chapter?.id || '';
  const liveNovelIdRef = useRef(novelId || '');
  liveNovelIdRef.current = novelId || '';
  const loadEpochRef = useRef(0);
  const [report, setReport] = useState<QualityCheckReport | null>(qcReport ?? null);
  const [items, setItems] = useState<QualityCheckItem[]>(qcItems ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);
  const [filter, setFilter] = useState<QualityIssueFilter>('all');
  const [locateMessage, setLocateMessage] = useState('');

  // v1.7.19 同步 props → local
  useEffect(() => { if (qcReport !== undefined) setReport(qcReport); }, [qcReport]);
  useEffect(() => { if (qcItems !== undefined) setItems(qcItems); }, [qcItems]);
  // 反方向同步 local → parent
  const syncUp = useCallback((r: QualityCheckReport | null, it: QualityCheckItem[]) => {
    setReport(r); setItems(it);
    onQcChange?.(r, it);
  }, [onQcChange]);

  // v1.7.16/v1.7.18 AI 修稿状态
  const [fixLoading, setFixLoading] = useState(false);
  const [fixStage, setFixStage] = useState('');
  const [fixProgress, setFixProgress] = useState(0);
  const [fixComparison, setFixComparison] = useState<FixComparison | null>(null);
  const [fixScopeValidation, setFixScopeValidation] = useState<FixScopeValidation | null>(null);
  const [fixError, setFixError] = useState('');
  const [lastFixRunId, setLastFixRunId] = useState<string>('');
  const [sourceDraftId, setSourceDraftId] = useState<string>('');
  const [fixCandidate, setFixCandidate] = useState<FixCandidate | null>(null);

  useEffect(() => {
    setFixLoading(false);
    setFixStage('');
    setFixProgress(0);
    setFixComparison(null);
    setFixScopeValidation(null);
    setFixError('');
    setLastFixRunId('');
    setSourceDraftId('');
    setFixCandidate(null);
    hideAiModal?.();
  }, [novelId, chapter?.id, hideAiModal]);

  const activeReport = report?.chapterId === chapter?.id ? report : null;
  const activeItems = activeReport ? items.filter((item) => item.chapterId === chapter?.id) : [];
  const effectiveContent = currentEditorContent ?? currentDraft?.content ?? '';
  const effectiveContentHash = currentContentHash || hashTextContent(effectiveContent);
  const reportOutdated = !!activeReport && (
    !activeReport.contentHash
    || activeReport.contentHash !== effectiveContentHash
    || !currentDraftId
    || activeReport.draftId !== currentDraftId
    || activeReport.draftVersion === undefined
    || currentDraftVersion === undefined
    || activeReport.draftVersion !== currentDraftVersion
    || Boolean(currentEditorDirty)
  );
  const statistics = computeStatistics(activeItems);
  const filteredItems = filter === 'all' ? activeItems : activeItems.filter((i) => i.status === filter);

  const loadLatest = useCallback(async () => {
    if (!novelId || !chapter?.id) return;
    const requestEpoch = ++loadEpochRef.current;
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    setCurrentDraft(null);
    try {
      const d = await draftVersionService.getLatestByChapterId(chapter.id);
      if (loadEpochRef.current !== requestEpoch
        || liveNovelIdRef.current !== requestNovelId
        || liveChapterIdRef.current !== requestChapterId) return;
      if (d && (d.novelId !== requestNovelId || d.chapterId !== requestChapterId)) {
        throw new Error('草稿与质量检查目标不一致');
      }
      setCurrentDraft(d);
      if (qcReport?.chapterId === chapter.id) return;
      const result = await qualityCheckService.getChapterIssues(chapter.id);
      if (loadEpochRef.current !== requestEpoch
        || liveNovelIdRef.current !== requestNovelId
        || liveChapterIdRef.current !== requestChapterId) return;
      syncUp(result.report, result.items);
    } catch (error) {
      if (loadEpochRef.current !== requestEpoch
        || liveNovelIdRef.current !== requestNovelId
        || liveChapterIdRef.current !== requestChapterId) return;
      console.error('[QualityCheck] failed to load latest report', error);
      setError(error instanceof Error ? error.message : '加载质量检查报告失败');
    }
  }, [novelId, chapter?.id, qcReport?.chapterId, syncUp]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

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
    if (loading) return; // v1.7.20 防重复点击
    setLoading(true); setError(''); setLocateMessage('');
    showAiModal?.('AI 正在质量检查', 'AI 正在检查逻辑、设定和文笔……');
    try {
      updateAiModal?.('正在准备检查参数……', 10);
      let sourceDraft = currentDraft?.novelId === novelId && currentDraft.chapterId === requestChapterId
        ? currentDraft
        : null;
      const needsSnapshotDraft = !sourceDraft || sourceDraft.content !== sourceContent || currentEditorDirty;
      if (needsSnapshotDraft) {
        updateAiModal?.('正在保存当前正文快照……', 18);
        sourceDraft = await draftVersionService.create({
          novelId,
          chapterId: chapter.id,
          title: `${chapter.title} - 质量检查快照`,
          content: sourceContent,
          source: 'user_edited',
          note: '质量检查正文快照',
        });
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
      const rpt = await qualityCheckService.createReport({
        novelId, chapterId: chapter.id, draftId: sourceDraft.id,
        contentHash,
        contentLength: sourceContent.length,
        checkedAt,
      });

      updateAiModal?.('正在请求 AI 质量检查……', 35);
      const result = await qualityCheckAiService.runCheck({
        novelId, chapterId: chapter.id, draftId: sourceDraft.id,
        volumeId: chapter.volumeId,
        draftContent: sourceContent, chapterTitle: chapter.title,
        chapterOutline: chapter.outline, chapterGoal: chapter.goal,
        contentHash,
        draftVersion: sourceDraft.versionNo,
        useUnifiedPipeline: true,
        wordCount: sourceWordCount,
      });

      if (!result || (!result.items && !result.summary)) {
        throw new Error('AI 返回内容为空，质量检查未完成。');
      }

      updateAiModal?.('正在保存检查结果……', 80);
      const saved = await qualityCheckService.saveResult({
        reportId: rpt.id, novelId, chapterId: chapter.id,
        draftId: sourceDraft.id, result,
        draftVersion: sourceDraft.versionNo,
        contentHash,
        contentLength: sourceContent.length,
        checkedAt,
      });

      if (liveNovelIdRef.current !== novelId || liveChapterIdRef.current !== requestChapterId) {
        hideAiModal?.();
        return;
      }

      updateAiModal?.('正在加载最新结果……', 95);
      syncUp(saved.report ? {
        ...saved.report,
        contentHash,
        contentLength: sourceContent.length,
        checkedAt,
      } : null, saved.items);
      setFilter('all');

      updateAiModal?.('质量检查完成', 100);
      // v1.7.20 成功后延迟关闭弹窗
      await new Promise((r) => setTimeout(r, 500));
      hideAiModal?.();
    } catch (e: any) {
      console.error('[QualityCheck] run failed', e);
      const msg = e?.message || (typeof e === 'string' ? e : '质量检查失败');
      setError(msg);
      // v1.7.20 失败时弹窗显示错误，不立即关闭
      updateAiModal?.(`失败: ${msg}`, 0);
      // 停留 2.5 秒后关闭
      await new Promise((r) => setTimeout(r, 2500));
      hideAiModal?.();
    } finally {
      setLoading(false);
    }
  };

  /** 更新问题状态 */
  const handleStatusChange = async (itemId: string, newStatus: QualityIssueStatus) => {
    const prevItems = [...items];
    const nextItems = items.map((i) =>
      i.id === itemId ? { ...i, status: newStatus, resolvedAt: newStatus === 'resolved' ? new Date().toISOString() : i.resolvedAt } : i,
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

  /** AI 修稿并复检 (v1.7.16) */
  const handleAIFix = async () => {
    if (!novelId || !chapter || !currentDraft || !activeReport) return;
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

    if (fixLoading || loading) return; // v1.7.20 防重复
    setFixLoading(true); setFixError(''); setFixComparison(null); setFixProgress(0);
    setSourceDraftId(currentDraft.id);
    showAiModal?.('AI 正在修复并复检', 'AI 正在根据质量问题自动优化正文……');
    try {
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
          novelId, chapterId: chapter.id, volumeId: chapter.volumeId,
          taskType: 'quality_fix',
        });
        if (ctxResult.chapterSummaries.length > 0 || ctxResult.volumeContexts.length > 0) {
          chapterContext = buildContextPromptSection(ctxResult);
        }
        usedCtxIds = JSON.stringify(ctxResult.chapterContexts.map((c) => c.id).concat(ctxResult.volumeContexts.map((v) => v.id)));
        skippedCtxIds = JSON.stringify([]);
        ctxWarnings = JSON.stringify(ctxResult.warnings);
      } catch { /* non-critical */ }

      updateAiModal?.('正在生成修订版正文...', 30);
      const { fixResult, fixRun, scopeValidation, taskId, artifactId } = await qualityFixService.runFix({
        novelId, chapterId: chapter.id, chapterTitle: chapter.title,
        chapterOutline: chapter.outline, currentDraft,
        pendingIssues: pending, ignoredIssues: ignored,
        beforeReportId: activeReport.id,
        beforeScore: activeReport.overallScore || 0,
        beforePendingCount: statistics.pending,
        beforeSeriousCount: statistics.critical,
        chapterContext,
      });
      if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
        setFixScopeValidation(scopeValidation);
      }

      // v1.7.19 修稿范围门控：范围越界 → 拒绝，不创建候选草稿
      if (!scopeValidation.passed) {
        fixRun.status = 'failed';
        fixRun.failureReason = scopeValidation.rejectReason || '修稿范围校验未通过';
        (fixRun as any).warnings = JSON.stringify(scopeValidation.warnings);
        await fixRunStore.save(fixRun);
        throw new Error(scopeValidation.rejectReason || '修稿范围越界，修订版未采用');
      }

      // 保存上下文信息到 fixRun
      (fixRun as any).usedContextIds = usedCtxIds;
      (fixRun as any).skippedContextIds = skippedCtxIds;
      (fixRun as any).warnings = ctxWarnings;
      await fixRunStore.save(fixRun);
      if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
        setLastFixRunId(fixRun.id);
      }

      if (fixRun.status === 'failed') {
        if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
          setFixError(fixRun.failureReason || 'AI 修稿失败');
          setFixLoading(false);
        }
        return;
      }

      updateAiModal?.('正在重新质量检查...', 75);
      const fixedContentHash = await computeContentSha256(fixResult.revisedContent);
      const checkResult = await qualityCheckAiService.runCheck({
        novelId, chapterId: chapter.id, draftId: requestSourceDraftId,
        volumeId: chapter.volumeId,
        draftContent: fixResult.revisedContent,
        chapterTitle: chapter.title,
        chapterOutline: chapter.outline, chapterGoal: chapter.goal,
        contentHash: fixedContentHash,
        wordCount: countTextWords(fixResult.revisedContent),
      });

      updateAiModal?.('正在对比修复效果...', 90);
      const candidateCheckedAt = new Date().toISOString();
      const afterItemsForStats: QualityCheckItem[] = checkResult.items.map((it, index) => ({
        id: `candidate-${index}`,
        reportId: 'candidate',
        novelId,
        chapterId: chapter.id,
        draftId: requestSourceDraftId,
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
        fixRun.beforeScore, checkResult.overallScore,
        fixRun.beforePendingCount, afterStats.pending,
        fixRun.beforeSeriousCount, afterStats.critical,
        activeItems.length, afterItemsForStats.length,
        statistics.high, afterStats.high,
        fixResult.fixedIssueKeys.length,
      );
      if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
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

      updateAiModal?.('正在建立安全落位建议...', 95);
      const proposal = await placementApplyService.createProposal({
        artifactId,
        target: { novelId: requestNovelId, chapterId: requestChapterId, draftId: requestSourceDraftId },
        browserExpectedVersion: requestSourceRevision,
        browserExpectedHash: requestBaseHash,
      });
      fixRun.status = 'validated';
      if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
        setFixCandidate({
          artifactId,
          taskId,
          proposal,
          content: fixResult.revisedContent,
          novelId: requestNovelId,
          chapterId: requestChapterId,
          contentHash: fixedContentHash,
          sourceDraftId: requestSourceDraftId,
          sourceDraftVersion: requestSourceRevision,
          baseContentHash: requestBaseHash,
          fixRunId: fixRun.id,
          fixedIssueIds: activeItems
            .filter((item) => fixResult.fixedIssueKeys.includes(item.issueKey))
            .map((item) => item.id),
        });
        setFixStage(comparison.isBetter
          ? '修复候选已通过复检，等待确认采用'
          : '修复候选已保存，可查看后决定是否采用');
      }
      await fixRunStore.save(fixRun).catch(() => {});

      if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
        hideAiModal?.();
        setFixLoading(false);
        setTimeout(() => {
          if (liveNovelIdRef.current === requestNovelId && liveChapterIdRef.current === requestChapterId) {
            setFixStage('');
          }
        }, 3000);
      }
    } catch (e: any) {
      if (liveNovelIdRef.current !== requestNovelId || liveChapterIdRef.current !== requestChapterId) return;
      const msg = e.message || 'AI 修稿失败';
      setFixError(msg);
      updateAiModal?.(`失败: ${msg}`, 0);
      await new Promise((r) => setTimeout(r, 2500));
      hideAiModal?.();
      setFixLoading(false);
    }
  };

  const handleConfirmFix = async () => {
    if (!chapter || !novelId || !fixCandidate) return;
    if (fixCandidate.novelId !== novelId || fixCandidate.chapterId !== chapter.id) {
      setFixError('目标已变化：该修稿候选不能应用到当前章节');
      return;
    }
    setFixLoading(true);
    setFixError('');
    try {
      const validation = await placementApplyService.validateProposal(fixCandidate.proposal.proposalId);
      if (validation.stale) {
        throw new Error(validation.reason || '修稿候选目标已变化，请重新生成');
      }
      const plan = await placementApplyService.createPlan({
        proposalId: fixCandidate.proposal.proposalId,
        source: 'ai_fix',
        note: 'AI 修稿确认采用',
        qualityFix: {
          fixRunId: fixCandidate.fixRunId,
          fixedIssueIds: fixCandidate.fixedIssueIds,
        },
      });
      const execution = await placementApplyService.executePlan(plan);
      if (execution.status !== 'completed' || execution.targetLinks.length !== 1) {
        throw new Error('修稿 ApplyPlan 未完整提交，正式状态保持不变');
      }
      const applied = execution.result as { draft?: ChapterDraft; contentHash?: string };
      const adopted = applied.draft;
      if (!adopted?.isAdopted) throw new Error('修稿 ApplyPlan 返回的正文身份无效');

      const resultMetadata: DraftResultMetadata = {
        resultId: adopted.id,
        novelId: fixCandidate.novelId,
        chapterId: fixCandidate.chapterId,
        sourceDraftId: fixCandidate.sourceDraftId,
        sourceRevision: fixCandidate.sourceDraftVersion,
        baseContentHash: fixCandidate.baseContentHash,
        draftVersion: adopted.versionNo,
        contentHash: applied.contentHash || fixCandidate.contentHash,
        taskId: fixCandidate.taskId,
        artifactId: fixCandidate.artifactId,
        source: 'quality_check',
      };
      setCurrentDraft(adopted);
      if (onGenerated) {
        onGenerated(adopted, resultMetadata);
      } else {
        await onApplyAiText?.({
          ...resultMetadata,
          mode: 'replace_all',
          text: adopted.content,
          source: 'quality_check',
        });
      }
      try {
        const refreshed = await qualityCheckService.getChapterIssues(fixCandidate.chapterId);
        syncUp(refreshed.report, refreshed.items);
      } catch { /* 提交后只读刷新失败不改变权威成功 */ }
      setFixStage('已确认采用修复后版本');
      setFixCandidate(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setFixError(message || '采用修稿候选失败，事务已回滚，正式状态未变更');
    } finally {
      setFixLoading(false);
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

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;

  const aiSettings = aiSettingsService.getSettings();

  // 问题状态的 CSS 样式
  const statusStyle = (status: QualityIssueStatus) => {
    switch (status) {
      case 'resolved': return { background: '#22c55e20', color: '#16a34a', border: '1px solid #22c55e40' };
      case 'ignored': return { background: '#6b728020', color: '#6b7280', border: '1px solid #6b728040' };
      default: return { background: '#f59e0b20', color: '#d97706', border: '1px solid #f59e0b40' };
    }
  };

  return (
    <div>
      {/* AI 模式状态 */}
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div className="panel-section-title">🤖 AI 状态</div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div style={{ color: 'var(--color-error)', marginTop: 4 }}>⚠️ 未配置 API Key，请先到设置中心配置</div>
            )}
          </>
        )}
      </div>

      {/* 检查触发区 */}
      <div className="panel-section">
        <div className="panel-section-title">🔍 质量检查</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          第{chapter.chapterNumber}章 {chapter.title}
        </div>
        {currentDraft && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            草稿 v{currentDraft.versionNo}（{currentDraft.wordCount} 字）
          </div>
        )}
        <button className="btn btn-primary btn-sm" onClick={handleRunCheck} disabled={loading} style={{ width: '100%' }}>
          {loading ? '⏳ 检查中...' : '🔍 开始质量检查'}
        </button>

        {/* v1.7.16/v1.7.18 AI 修复并复检 */}
        {activeReport && statistics.pending > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              className="btn btn-sm"
              onClick={handleAIFix}
              disabled={fixLoading || loading}
              style={{
                width: '100%',
                background: fixLoading ? 'var(--color-bg-hover)' : '#7c3aed',
                color: fixLoading ? 'var(--color-text-muted)' : '#fff',
                border: 'none', cursor: fixLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {fixLoading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  ⏳ {fixStage || '修复中...'}
                </span>
              ) : '🤖 AI 修复并复检'}
            </button>
            {fixLoading && (
              <div style={{ marginTop: 6, background: 'var(--color-bg-primary)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${fixProgress}%`, background: '#7c3aed', transition: 'width 0.3s ease' }} />
              </div>
            )}
          </div>
        )}
        {fixStage && !fixLoading && (
          <div style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4 }}>✅ {fixStage}</div>
        )}
        {fixError && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{fixError}</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{error}</div>}
      </div>

      {reportOutdated && (
        <div className="panel-section" style={{
          border: '1px solid #f59e0b55',
          background: '#f59e0b12',
          borderRadius: 6,
          padding: 10,
          color: '#b45309',
          fontSize: 12,
          lineHeight: 1.6,
        }}>
          正文已修改，此检测结果可能已过期。建议重新进行质量检测。
        </div>
      )}

      {/* 检查结果区 */}
      {activeReport && activeReport.status === 'completed' && (
        <div className="panel-section">
          <div className="panel-section-title">📊 检查结果</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              fontSize: 28, fontWeight: 700,
              color: (activeReport.overallScore ?? 0) >= 80 ? 'var(--color-success)'
                : (activeReport.overallScore ?? 0) >= 60 ? 'var(--color-warning)' : 'var(--color-error)',
            }}>
              {activeReport.overallScore ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>/ 100</div>
          </div>
          {activeReport.summary && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {activeReport.summary}
            </div>
          )}
        </div>
      )}

      {/* v1.7.19 AI 修复对比结果（增强版） */}
      {fixComparison && (
        <div className="panel-section" style={{
          border: `1px solid ${fixComparison.isBetter ? '#22c55e40' : fixComparison.isWorse ? '#ef444440' : '#f59e0b40'}`,
          background: fixComparison.isBetter ? '#22c55e08' : fixComparison.isWorse ? '#ef444408' : '#f59e0b08',
          borderRadius: 6, padding: 10,
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: fixComparison.isBetter ? '#16a34a' : fixComparison.isWorse ? '#dc2626' : '#d97706' }}>
            {fixComparison.isBetter ? '✅ 修复候选通过复检' : fixComparison.isWorse ? '⚠️ 修复效果不佳' : '📊 修复效果一般'}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.8 }}>
            <div>修复前：{fixComparison.beforeScore} 分，待处理 {fixComparison.beforePendingCount}，严重 {fixComparison.beforeSeriousCount}</div>
            <div>修复后：{fixComparison.afterScore} 分，待处理 {fixComparison.afterPendingCount}，严重 {fixComparison.afterSeriousCount}</div>
            <div style={{ marginTop: 4 }}>
              已修复 {fixComparison.fixedIssueCount} 个问题
              {fixComparison.newIssueCount > 0 && <span style={{ color: '#d97706' }}>，新增 {fixComparison.newIssueCount} 个问题</span>}
            </div>
          </div>
          {fixScopeValidation && (
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
              范围校验：{fixScopeValidation.passed ? `通过 (${fixScopeValidation.riskLevel})` : `未通过`}
              {fixScopeValidation.warnings.length > 0 && <span> | {fixScopeValidation.warnings.join('; ')}</span>}
            </div>
          )}
          {fixComparison.isBetter && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4, fontWeight: 500 }}>
              候选尚未采用；确认后才会修改正式正文和质量状态。
            </div>
          )}
          {!fixComparison.isBetter && (
            <div style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>
              修稿未能显著改善质量，当前正文保持不变。可查看候选版本后手动采用。
            </div>
          )}
          {/* 回退/采用按钮 */}
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={async () => {
                if (!sourceDraftId || !chapter || !currentDraft) return;
                const drafts = await draftVersionService.getByChapterId(chapter.id);
                const source = drafts.find((d: any) => d.id === sourceDraftId);
                if (source) {
                  await qualityFixService.revertFixRun(lastFixRunId);
                  setFixCandidate(null);
                  setFixComparison(null);
                  setFixStage('已放弃修稿候选，原版本保持不变');
                  setTimeout(() => setFixStage(''), 3000);
                }
              }}
              style={{ flex: 1, fontSize: 11 }}
            >
              ↩️ 回退原版本
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleConfirmFix}
              disabled={!fixCandidate || fixLoading}
              style={{ flex: 1, fontSize: 11 }}
            >
              ✅ 确认采用
            </button>
          </div>
        </div>
      )}

      {/* 统计区 */}
      {activeItems.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">📋 问题统计</div>
          {/* 状态统计 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>总问题：{statistics.total}</span>
            <span style={{ color: '#d97706' }}>待处理：{statistics.pending}</span>
            <span style={{ color: '#16a34a' }}>已处理：{statistics.resolved}</span>
            <span style={{ color: '#6b7280' }}>已忽略：{statistics.ignored}</span>
          </div>
          {/* 严重程度统计 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['critical', 'high', 'medium', 'low'] as QualityIssueSeverity[]).map((s) =>
              statistics[s] > 0 ? (
                <span key={s} style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 3,
                  background: QualityIssueSeverityColors[s] + '20', color: QualityIssueSeverityColors[s],
                }}>
                  {QualityIssueSeverityLabels[s]}：{statistics[s]}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* 筛选按钮 */}
      {activeItems.length > 0 && (
        <div className="panel-section" style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(f)}
                style={{ fontSize: 11, padding: '3px 8px' }}
              >
                {QualityIssueFilterLabels[f]}（{
                  f === 'all' ? statistics.total
                    : f === 'pending' ? statistics.pending
                    : f === 'resolved' ? statistics.resolved
                    : statistics.ignored
                }）
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 定位提示 */}
      {locateMessage && (
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)', padding: '6px 8px',
          background: 'var(--color-bg-primary)', borderRadius: 4, margin: '4px 0',
        }}>
          {locateMessage}
        </div>
      )}

      {/* 问题列表 */}
      {filteredItems.map((item) => (
        <div
          key={item.id}
          className="panel-section"
          style={{
            borderLeft: `3px solid ${QualityIssueSeverityColors[item.severity]}`,
            opacity: item.status === 'resolved' || item.status === 'ignored' ? 0.65 : 1,
            paddingLeft: 10,
          }}
        >
          {/* 标签行 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4, alignItems: 'center' }}>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 3,
              background: QualityIssueSeverityColors[item.severity] + '20',
              color: QualityIssueSeverityColors[item.severity], fontWeight: 500,
            }}>
              {QualityIssueSeverityLabels[item.severity]}
            </span>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 3,
              background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)',
            }}>
              {item.category || QualityIssueTypeLabels[item.issueType]}
            </span>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, ...statusStyle(item.status) }}>
              {QualityIssueStatusLabels[item.status]}
            </span>
          </div>

          {/* 标题 */}
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 3 }}>{item.title}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{item.description}</div>

          {/* 原文引用 */}
          {(item.quote || item.evidence) && (
            <div style={{
              fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-muted)',
              marginTop: 4, padding: '4px 6px', background: 'var(--color-bg-primary)', borderRadius: 3,
            }}>
              📝 {item.quote || item.evidence}
            </div>
          )}

          {/* 建议 */}
          {item.suggestion && (
            <div style={{ fontSize: 11, color: 'var(--color-primary)', marginTop: 3 }}>
              💡 {item.suggestion}
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {/* 定位按钮 */}
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => handleLocate(item)}
              title="定位到正文对应位置"
            >
              📍 定位
            </button>

            {/* 状态相关按钮 */}
            {item.status === 'pending' && (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleStatusChange(item.id, 'resolved')}
                >
                  ✅ 标记已处理
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleStatusChange(item.id, 'ignored')}
                >
                  🚫 忽略
                </button>
              </>
            )}
            {(item.status === 'resolved' || item.status === 'ignored') && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => handleStatusChange(item.id, 'pending')}
              >
                ↩️ 重新打开
              </button>
            )}
          </div>
        </div>
      ))}

      {/* 空状态 */}
      {!activeReport && !loading && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: 16 }}>
          点击上方按钮对当前草稿进行质量检查
        </div>
      )}

      {/* 筛选后无结果 */}
      {activeReport && filteredItems.length === 0 && activeItems.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: 16 }}>
          当前筛选条件下没有匹配的问题
        </div>
      )}
    </div>
  );
}

export default CheckPanel;
