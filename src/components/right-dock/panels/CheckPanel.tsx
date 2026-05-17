import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type { QualityCheckReport, QualityCheckItem, QualityIssueSeverity } from '../../../types/qualityCheck';
import { QualityIssueTypeLabels, QualityIssueSeverityLabels, QualityIssueSeverityColors } from '../../../types/qualityCheck';
import { qualityCheckService } from '../../../services/quality/qualityCheckService';
import { qualityCheckAiService } from '../../../services/ai/qualityCheckAiService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { aiSettingsService } from '../../../services/ai/aiClient';

interface CheckPanelProps {
  novelId?: string; chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void; onAdopted?: () => void;
}

function CheckPanel({ novelId, chapter }: CheckPanelProps) {
  const [report, setReport] = useState<QualityCheckReport | null>(null);
  const [items, setItems] = useState<QualityCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);

  const loadLatest = useCallback(async () => {
    if (!chapter?.id) return;
    const [r, d] = await Promise.all([
      qualityCheckService.getLatestReport(chapter.id),
      draftVersionService.getLatestByChapterId(chapter.id),
    ]);
    setReport(r); setCurrentDraft(d);
    if (r) setItems(await qualityCheckService.getItemsByReportId(r.id)); else setItems([]);
  }, [chapter?.id]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const handleRunCheck = async () => {
    if (!novelId || !chapter) return;
    if (!currentDraft || currentDraft.content.length < 10) { setError('正文过短，请先生成或编辑正文'); return; }
    setLoading(true); setError('');
    try {
      const rpt = await qualityCheckService.createReport({ novelId, chapterId: chapter.id, draftId: currentDraft.id });
      const result = await qualityCheckAiService.runCheck({
        novelId, chapterId: chapter.id, draftId: currentDraft.id,
        draftContent: currentDraft.content, chapterTitle: chapter.title,
        chapterOutline: chapter.outline, chapterGoal: chapter.goal,
      });
      const saved = await qualityCheckService.saveResult({ reportId: rpt.id, novelId, chapterId: chapter.id, draftId: currentDraft.id, result });
      setReport(saved.report); setItems(saved.items);
    } catch (e: any) { setError(e.message || '检查失败'); }
    finally { setLoading(false); }
  };

  const handleToggleResolved = async (itemId: string, resolved: boolean) => {
    await qualityCheckService.setItemResolved(itemId, resolved);
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, isResolved: resolved } : i));
  };

  const severityCount = items.reduce((acc, i) => { acc[i.severity] = (acc[i.severity] || 0) + 1; return acc; }, {} as Record<string, number>);
  const resolvedCount = items.filter((i) => i.isResolved).length;

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;

  const aiSettings = aiSettingsService.getSettings();

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
      <div className="panel-section">
        <div className="panel-section-title">🔍 质量检查</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>第{chapter.chapterNumber}章 {chapter.title}</div>
        {currentDraft && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>草稿 v{currentDraft.versionNo}（{currentDraft.wordCount} 字）</div>}
        <button className="btn btn-primary btn-sm" onClick={handleRunCheck} disabled={loading} style={{ width: '100%' }}>
          {loading ? '⏳ 检查中...' : '🔍 开始质量检查'}
        </button>
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{error}</div>}
      </div>

      {report && report.status === 'completed' && (
        <div className="panel-section">
          <div className="panel-section-title">📊 检查结果</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: (report.overallScore ?? 0) >= 80 ? 'var(--color-success)' : (report.overallScore ?? 0) >= 60 ? 'var(--color-warning)' : 'var(--color-error)' }}>{report.overallScore ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>/ 100</div>
          </div>
          {report.summary && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{report.summary}</div>}
        </div>
      )}

      {items.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">📋 问题统计（{items.length}）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {(['critical','high','medium','low'] as QualityIssueSeverity[]).map((s) => severityCount[s] ? (
              <span key={s} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: QualityIssueSeverityColors[s] + '20', color: QualityIssueSeverityColors[s] }}>{QualityIssueSeverityLabels[s]}: {severityCount[s]}</span>
            ) : null)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>已处理 {resolvedCount}/{items.length}</div>
        </div>
      )}

      {items.map((item) => (
        <div key={item.id} className="panel-section" style={{ borderLeft: `3px solid ${QualityIssueSeverityColors[item.severity]}`, opacity: item.isResolved ? 0.6 : 1, paddingLeft: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: QualityIssueSeverityColors[item.severity] + '20', color: QualityIssueSeverityColors[item.severity], fontWeight: 500 }}>{QualityIssueSeverityLabels[item.severity]}</span>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)' }}>{QualityIssueTypeLabels[item.issueType]}</span>
          </div>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 3 }}>{item.title}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{item.description}</div>
          {item.evidence && <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-muted)', marginTop: 4, padding: '4px 6px', background: 'var(--color-bg-primary)', borderRadius: 3 }}>📝 {item.evidence}</div>}
          {item.suggestion && <div style={{ fontSize: 11, color: 'var(--color-primary)', marginTop: 3 }}>💡 {item.suggestion}</div>}
          <div style={{ marginTop: 6 }}>
            <button className={`btn btn-sm ${item.isResolved ? 'btn-secondary' : 'btn-primary'}`} onClick={() => handleToggleResolved(item.id, !item.isResolved)}>
              {item.isResolved ? '✅ 已处理' : '标记处理'}
            </button>
          </div>
        </div>
      ))}

      {!report && !loading && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: 16 }}>点击上方按钮对当前草稿进行质量检查</div>
      )}
    </div>
  );
}

export default CheckPanel;
