import { useState, useEffect, useCallback } from 'react';
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
import type { FixComparison } from '../../../services/ai/qualityFixService';
import { fixRunStore } from '../../../services/ai/fixRunStore';
import { getContextForChapterTask, buildContextPromptSection } from '../../../services/prompt/contextReaderService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { runWithLoading } from '../../../lib/runWithLoading';

interface CheckPanelProps {
  novelId?: string; chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void; onAdopted?: () => void;
  /** 定位到正文指定位置的回调 (v1.7.16 支持 paragraphIndex) */
  onLocateText?: (startOffset: number, endOffset: number, quote?: string, paragraphIndex?: number) => void;
}

const FILTER_OPTIONS: QualityIssueFilter[] = ['all', 'pending', 'resolved', 'ignored'];

function CheckPanel({ novelId, chapter, onLocateText }: CheckPanelProps) {
  const [report, setReport] = useState<QualityCheckReport | null>(null);
  const [items, setItems] = useState<QualityCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);
  const [filter, setFilter] = useState<QualityIssueFilter>('all');
  const [locateMessage, setLocateMessage] = useState('');

  // v1.7.16 AI 修稿状态
  const [fixLoading, setFixLoading] = useState(false);
  const [fixStage, setFixStage] = useState('');
  const [fixComparison, setFixComparison] = useState<FixComparison | null>(null);
  const [fixError, setFixError] = useState('');
  const [lastFixRunId, setLastFixRunId] = useState<string>('');
  const [sourceDraftId, setSourceDraftId] = useState<string>('');

  const statistics = computeStatistics(items);
  const filteredItems = filter === 'all' ? items : items.filter((i) => i.status === filter);

  const loadLatest = useCallback(async () => {
    if (!chapter?.id) return;
    try {
      const [result, d] = await Promise.all([
        qualityCheckService.getChapterIssues(chapter.id),
        draftVersionService.getLatestByChapterId(chapter.id),
      ]);
      setReport(result.report);
      setItems(result.items);
      setCurrentDraft(d);
    } catch {
      // 回退到旧方式
      const [r, d] = await Promise.all([
        qualityCheckService.getLatestReport(chapter.id),
        draftVersionService.getLatestByChapterId(chapter.id),
      ]);
      setReport(r); setCurrentDraft(d);
      if (r) {
        const its = await qualityCheckService.getItemsByReportId(r.id);
        setItems(its);
      } else {
        setItems([]);
      }
    }
  }, [chapter?.id]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const handleRunCheck = async () => {
    if (!novelId || !chapter) return;
    if (!currentDraft || currentDraft.content.length < 10) {
      setError('正文过短，请先生成或编辑正文'); return;
    }
    setLoading(true); setError(''); setLocateMessage('');
    try {
      await runWithLoading(
        {
          title: 'AI 正在质量检查',
          initialMessage: '正在准备检查参数……',
          successMessage: '质量检查完成',
          errorMessage: '质量检查失败',
        },
        async ({ setMessage, setStage, setPercent }) => {
          setStage('创建检查报告……');
          setPercent(5);
          const rpt = await qualityCheckService.createReport({
            novelId, chapterId: chapter.id, draftId: currentDraft.id,
          });

          setMessage('正在分析正文……');
          setStage('AI 正在检查逻辑、设定和文笔……');
          setPercent(30);
          const result = await qualityCheckAiService.runCheck({
            novelId, chapterId: chapter.id, draftId: currentDraft.id,
            volumeId: chapter.volumeId,
            draftContent: currentDraft.content, chapterTitle: chapter.title,
            chapterOutline: chapter.outline, chapterGoal: chapter.goal,
          });

          setMessage('正在保存检查结果……');
          setPercent(80);
          const saved = await qualityCheckService.saveResult({
            reportId: rpt.id, novelId, chapterId: chapter.id,
            draftId: currentDraft.id, result,
            draftVersion: currentDraft.versionNo,
          });
          setReport(saved.report);
          setItems(saved.items);
          setFilter('all');
          setPercent(100);
        },
      );
    } catch (e: any) { setError(e.message || '检查失败'); }
    finally { setLoading(false); }
  };

  /** 更新问题状态 */
  const handleStatusChange = async (itemId: string, newStatus: QualityIssueStatus) => {
    const prevItems = [...items];
    // 乐观更新
    setItems((prev) =>
      prev.map((i) => i.id === itemId ? { ...i, status: newStatus, resolvedAt: newStatus === 'resolved' ? new Date().toISOString() : i.resolvedAt } : i),
    );
    try {
      await qualityCheckService.updateIssueStatus(itemId, newStatus);
    } catch {
      // 回滚
      setItems(prevItems);
      setError('状态更新失败');
    }
  };

  /** AI 修稿并复检 (v1.7.16) */
  const handleAIFix = async () => {
    if (!novelId || !chapter || !currentDraft || !report) return;
    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;

    setFixLoading(true); setFixError(''); setFixComparison(null);
    setSourceDraftId(currentDraft.id);
    try {
      setFixStage('正在分析待处理问题...');
      const ignored = items.filter((i) => i.status === 'ignored');

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

      setFixStage('正在 AI 修稿...');
      const { fixResult, fixRun } = await qualityFixService.runFix({
        novelId, chapterId: chapter.id, chapterTitle: chapter.title,
        chapterOutline: chapter.outline, currentDraft,
        pendingIssues: pending, ignoredIssues: ignored,
        beforeReportId: report.id,
        beforeScore: report.overallScore || 0,
        beforePendingCount: statistics.pending,
        beforeSeriousCount: statistics.critical,
        chapterContext,
      });

      // 保存上下文信息到 fixRun
      (fixRun as any).usedContextIds = usedCtxIds;
      (fixRun as any).skippedContextIds = skippedCtxIds;
      (fixRun as any).warnings = ctxWarnings;
      await fixRunStore.save(fixRun);
      setLastFixRunId(fixRun.id);

      if (fixRun.status === 'failed') {
        setFixError(fixRun.failureReason || 'AI 修稿失败');
        setFixLoading(false);
        return;
      }

      // 阶段3: 保存新草稿
      setFixStage('正在保存新草稿版本...');
      const newDraft = await draftVersionService.create({
        novelId, chapterId: chapter.id,
        title: chapter.title,
        content: fixResult.revisedContent,
        source: 'ai_fix' as any,
      });

      fixRun.targetDraftId = newDraft.id;
      fixRun.targetDraftVersion = newDraft.versionNo;

      // 更新当前草稿为新版本
      setCurrentDraft(newDraft);

      // 阶段4: 重新质量检查
      setFixStage('正在重新质量检查...');
      const rpt2 = await qualityCheckService.createReport({
        novelId, chapterId: chapter.id, draftId: newDraft.id,
      });
      const checkResult = await qualityCheckAiService.runCheck({
        novelId, chapterId: chapter.id, draftId: newDraft.id,
        volumeId: chapter.volumeId,
        draftContent: fixResult.revisedContent,
        chapterTitle: chapter.title,
        chapterOutline: chapter.outline, chapterGoal: chapter.goal,
      });
      const saved2 = await qualityCheckService.saveResult({
        reportId: rpt2.id, novelId, chapterId: chapter.id,
        draftId: newDraft.id, result: checkResult,
        draftVersion: newDraft.versionNo,
      });

      // 阶段5: 对比
      setFixStage('正在对比修复效果...');
      const afterItems = saved2.items;
      const afterStats = computeStatistics(afterItems);
      const comparison = qualityFixService.compareResults(
        fixRun.beforeScore, checkResult.overallScore,
        fixRun.beforePendingCount, afterStats.pending,
        fixRun.beforeSeriousCount, afterStats.critical,
        items.length, afterItems.length,
        statistics.high, afterStats.high,
        fixResult.fixedIssueKeys.length,
      );
      setFixComparison(comparison);

      // 阶段6: 更新问题状态
      setFixStage('正在更新问题状态...');
      if (comparison.isBetter) {
        for (const key of fixResult.fixedIssueKeys) {
          const item = items.find((i) => i.issueKey === key);
          if (item) await qualityCheckService.updateIssueStatus(item.id, 'resolved').catch(() => {});
        }
      }

      // 更新报告和问题列表
      setReport(saved2.report);
      setItems(saved2.items);

      // 标记旧章节上下文和卷上下文过期
      if (comparison.isBetter) {
        await chapterSummaryService.markExpired(chapter.id).catch(() => {});
        // v1.7.17: 同时过期卷上下文
        const allRecords = await contextRecordService.getByNovelId(novelId).catch(() => []);
        for (const r of allRecords) {
          if (r.contextType === 'volume_summary' && r.volumeId === chapter.volumeId && !r.isExpired) {
            await contextRecordService.update(r.id, { isExpired: true }).catch(() => {});
          }
        }
      }

      setFixStage('AI 修复完成');
    } catch (e: any) {
      setFixError(e.message || 'AI 修稿失败');
    } finally {
      setFixLoading(false);
      setTimeout(() => setFixStage(''), 3000);
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

        {/* v1.7.16 AI 修复并复检 */}
        {report && statistics.pending > 0 && (
          <button
            className="btn btn-sm"
            onClick={handleAIFix}
            disabled={fixLoading}
            style={{
              width: '100%', marginTop: 6,
              background: fixLoading ? 'var(--color-bg-hover)' : '#7c3aed',
              color: '#fff', border: 'none',
            }}
          >
            {fixLoading ? `⏳ ${fixStage || '修复中...'}` : '🤖 AI 修复并复检'}
          </button>
        )}
        {fixStage && !fixLoading && (
          <div style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4 }}>✅ {fixStage}</div>
        )}
        {fixError && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{fixError}</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{error}</div>}
      </div>

      {/* 检查结果区 */}
      {report && report.status === 'completed' && (
        <div className="panel-section">
          <div className="panel-section-title">📊 检查结果</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              fontSize: 28, fontWeight: 700,
              color: (report.overallScore ?? 0) >= 80 ? 'var(--color-success)'
                : (report.overallScore ?? 0) >= 60 ? 'var(--color-warning)' : 'var(--color-error)',
            }}>
              {report.overallScore ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>/ 100</div>
          </div>
          {report.summary && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {report.summary}
            </div>
          )}
        </div>
      )}

      {/* v1.7.16 AI 修复对比结果 */}
      {fixComparison && (
        <div className="panel-section" style={{
          border: `1px solid ${fixComparison.isBetter ? '#22c55e40' : fixComparison.isWorse ? '#ef444440' : '#f59e0b40'}`,
          background: fixComparison.isBetter ? '#22c55e08' : fixComparison.isWorse ? '#ef444408' : '#f59e0b08',
          borderRadius: 6, padding: 10,
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: fixComparison.isBetter ? '#16a34a' : fixComparison.isWorse ? '#dc2626' : '#d97706' }}>
            {fixComparison.isBetter ? '✅ 修复成功' : fixComparison.isWorse ? '⚠️ 修复效果不佳' : '📊 修复效果一般'}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.8 }}>
            <div>修复前：{fixComparison.beforeScore} 分，待处理 {fixComparison.beforePendingCount}，严重 {fixComparison.beforeSeriousCount}</div>
            <div>修复后：{fixComparison.afterScore} 分，待处理 {fixComparison.afterPendingCount}，严重 {fixComparison.afterSeriousCount}</div>
            <div style={{ marginTop: 4 }}>
              已修复 {fixComparison.fixedIssueCount} 个问题
              {fixComparison.newIssueCount > 0 && <span style={{ color: '#d97706' }}>，新增 {fixComparison.newIssueCount} 个问题</span>}
            </div>
          </div>
          {fixComparison.isBetter && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4, fontWeight: 500 }}>
              已自动采用修复后版本，原版本保留可回退。
            </div>
          )}
          {/* 回退按钮 */}
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={async () => {
                if (!sourceDraftId || !chapter || !currentDraft) return;
                const drafts = await draftVersionService.getByChapterId(chapter.id);
                const source = drafts.find((d: any) => d.id === sourceDraftId);
                if (source) {
                  setCurrentDraft(source);
                  await qualityFixService.revertFixRun(lastFixRunId);
                  setFixComparison(null);
                  setFixStage('已回退到修稿前版本');
                  setTimeout(() => setFixStage(''), 3000);
                }
              }}
              style={{ flex: 1, fontSize: 11 }}
            >
              ↩️ 回退原版本
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                await qualityFixService.adoptFixRun(lastFixRunId);
                setFixStage('已确认采用修复后版本');
                setTimeout(() => setFixStage(''), 3000);
              }}
              style={{ flex: 1, fontSize: 11 }}
            >
              ✅ 确认采用
            </button>
          </div>
        </div>
      )}

      {/* 统计区 */}
      {items.length > 0 && (
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
      {items.length > 0 && (
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
      {!report && !loading && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: 16 }}>
          点击上方按钮对当前草稿进行质量检查
        </div>
      )}

      {/* 筛选后无结果 */}
      {report && filteredItems.length === 0 && items.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: 16 }}>
          当前筛选条件下没有匹配的问题
        </div>
      )}
    </div>
  );
}

export default CheckPanel;
