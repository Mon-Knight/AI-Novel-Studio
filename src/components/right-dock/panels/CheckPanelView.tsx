import type { AiSettings } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type {
  QualityCheckItem,
  QualityCheckReport,
  QualityCheckStatistics,
  QualityIssueFilter,
  QualityIssueSeverity,
  QualityIssueStatus,
} from '../../../types/qualityCheck';
import {
  QualityIssueFilterLabels,
  QualityIssueSeverityColors,
  QualityIssueSeverityLabels,
  QualityIssueStatusLabels,
  QualityIssueTypeLabels,
} from '../../../types/qualityCheck';
import type { FixComparison, FixScopeValidation } from '../../../services/ai/qualityFixService';

export type QualityOperationPhase = 'idle' | 'available' | 'committing' | 'cancelling';

interface CheckPanelViewProps {
  chapter: Chapter;
  aiSettings: AiSettings;
  currentDraft: import('../../../types/ai').ChapterDraft | null;
  loading: boolean;
  operationPhase: QualityOperationPhase;
  activeReport: QualityCheckReport | null;
  viewingHistory: boolean;
  statistics: QualityCheckStatistics;
  fixLoading: boolean;
  fixStage: string;
  fixProgress: number;
  fixError: string;
  fixRoundUsed: boolean;
  error: string;
  historyReports: QualityCheckReport[];
  selectedReportId: string;
  historyLoading: boolean;
  reportOutdated: boolean;
  fixComparison: FixComparison | null;
  fixScopeValidation: FixScopeValidation | null;
  activeItems: QualityCheckItem[];
  filter: QualityIssueFilter;
  locateMessage: string;
  filteredItems: QualityCheckItem[];
  onRunCheck: () => void;
  onStopOperation: () => void;
  onAiFix: () => void;
  onHistoryChange: (reportId: string) => void;
  onFilterChange: (filter: QualityIssueFilter) => void;
  onLocate: (item: QualityCheckItem) => void;
  onStatusChange: (itemId: string, status: QualityIssueStatus) => void;
  onRevertFix: () => void;
  onConfirmFix: () => void;
}

const FILTER_OPTIONS: QualityIssueFilter[] = ['all', 'pending', 'resolved', 'ignored'];

function statusStyle(status: QualityIssueStatus) {
  switch (status) {
    case 'resolved': return { background: 'color-mix(in srgb, var(--color-success) 13%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' };
    case 'ignored': return { background: 'color-mix(in srgb, var(--color-text-muted) 13%, transparent)', color: 'var(--color-text-muted)', border: '1px solid color-mix(in srgb, var(--color-text-muted) 25%, transparent)' };
    default: return { background: 'color-mix(in srgb, var(--color-warning) 13%, transparent)', color: 'var(--color-warning-text)', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' };
  }
}

export function CheckPanelView({
  chapter, aiSettings, currentDraft, loading, operationPhase, activeReport,
  viewingHistory, statistics, fixLoading, fixStage, fixProgress, fixError,
  fixRoundUsed, error, historyReports, selectedReportId, historyLoading, reportOutdated,
  fixComparison, fixScopeValidation, activeItems, filter, locateMessage,
  filteredItems, onRunCheck, onStopOperation, onAiFix, onHistoryChange,
  onFilterChange, onLocate, onStatusChange, onRevertFix, onConfirmFix,
}: CheckPanelViewProps) {
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
        <button
          className="btn btn-primary btn-sm"
          data-testid="quality-check-run"
          onClick={onRunCheck}
          disabled={loading || operationPhase !== 'idle'}
          style={{ width: '100%' }}
        >
          {loading ? '⏳ 检查中...' : '🔍 开始质量检查'}
        </button>
        {operationPhase !== 'idle' && (
          <button
            className="btn btn-sm btn-secondary"
            data-testid="quality-operation-stop"
            onClick={onStopOperation}
            disabled={operationPhase !== 'available'}
            style={{ width: '100%', marginTop: 6 }}
          >
            {operationPhase === 'committing'
              ? '正在提交，暂不可停止'
              : operationPhase === 'cancelling'
                ? '正在停止...'
                : '⏹ 停止当前操作'}
          </button>
        )}

        {/* v1.7.16/v1.7.18 AI 修复并复检 */}
        {activeReport && !viewingHistory && statistics.pending > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              className="btn btn-sm"
              data-testid="quality-fix-run"
              onClick={onAiFix}
              disabled={fixRoundUsed || fixLoading || loading || operationPhase !== 'idle'}
              style={{
                width: '100%',
                background:
                  fixRoundUsed || fixLoading
                    ? 'var(--color-bg-hover)'
                    : 'var(--color-secondary-accent)',
                color:
                  fixRoundUsed || fixLoading
                    ? 'var(--color-text-muted)'
                    : 'var(--color-on-primary)',
                border: 'none', cursor: fixRoundUsed || fixLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {fixLoading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  ⏳ {fixStage || '修复中...'}
                </span>
              ) : fixRoundUsed ? '已使用外部修稿轮次' : '🤖 AI 修复并复检'}
            </button>
            {fixRoundUsed && !fixLoading && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                当前正文最多允许一轮外部 AI 修稿；如仍未通过，请人工处理。
              </div>
            )}
            {fixLoading && (
              <div style={{ marginTop: 6, background: 'var(--color-bg-primary)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${fixProgress}%`, background: 'var(--color-secondary-accent)', transition: 'width 0.3s ease' }} />
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

      {historyReports.length > 0 && (
        <div
          className="panel-section"
          data-testid="quality-history"
          data-report-id={activeReport?.id || ''}
          data-history-mode={viewingHistory ? 'snapshot' : 'current'}
        >
          <div className="panel-section-title">检查历史</div>
          <select
            data-testid="quality-history-select"
            value={selectedReportId || activeReport?.id || ''}
            onChange={(event) => void onHistoryChange(event.target.value)}
            disabled={historyLoading}
            style={{ width: '100%', fontSize: 12 }}
          >
            {historyReports.map((historyReport, index) => (
              <option key={historyReport.id} value={historyReport.id}>
                {index === 0 ? '最新 · ' : ''}
                {new Date(historyReport.checkedAt || historyReport.createdAt).toLocaleString()}
                {historyReport.overallScore === undefined ? '' : ` · ${historyReport.overallScore} 分`}
              </option>
            ))}
          </select>
          {viewingHistory && (
            <div data-testid="quality-history-readonly" style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
              历史快照 · 只读
            </div>
          )}
        </div>
      )}

      {reportOutdated && (
        <div className="panel-section" style={{
          border: '1px solid color-mix(in srgb, var(--color-warning) 33%, transparent)',
          background: 'color-mix(in srgb, var(--color-warning) 7%, transparent)',
          borderRadius: 6,
          padding: 10,
          color: 'var(--color-warning-text)',
          fontSize: 12,
          lineHeight: 1.6,
        }}>
          正文已修改，此检测结果可能已过期。建议重新进行质量检测。
        </div>
      )}

      {/* 检查结果区 */}
      {activeReport && activeReport.status === 'completed' && (
        <div
          className="panel-section"
          data-testid="quality-report"
          data-report-id={activeReport.id}
          data-draft-id={activeReport.draftId}
        >
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
          border: `1px solid ${fixComparison.isBetter ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : fixComparison.isWorse ? 'color-mix(in srgb, var(--color-error) 25%, transparent)' : 'color-mix(in srgb, var(--color-warning) 25%, transparent)'}`,
          background: fixComparison.isBetter ? 'color-mix(in srgb, var(--color-success) 3%, transparent)' : fixComparison.isWorse ? 'color-mix(in srgb, var(--color-error) 3%, transparent)' : 'color-mix(in srgb, var(--color-warning) 3%, transparent)',
          borderRadius: 6, padding: 10,
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: fixComparison.isBetter ? 'var(--color-success)' : fixComparison.isWorse ? 'var(--color-error)' : 'var(--color-warning-text)' }}>
            {fixComparison.isBetter ? '✅ 修复成功（已自动采用）' : fixComparison.isWorse ? '⚠️ 修复效果不佳（保留原版）' : '📊 修复效果一般（保留原版）'}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.8 }}>
            <div>修复前：{fixComparison.beforeScore} 分，待处理 {fixComparison.beforePendingCount}，严重 {fixComparison.beforeSeriousCount}</div>
            <div>修复后：{fixComparison.afterScore} 分，待处理 {fixComparison.afterPendingCount}，严重 {fixComparison.afterSeriousCount}</div>
            <div style={{ marginTop: 4 }}>
              已修复 {fixComparison.fixedIssueCount} 个问题
              {fixComparison.newIssueCount > 0 && <span style={{ color: 'var(--color-warning-text)' }}>，新增 {fixComparison.newIssueCount} 个问题</span>}
            </div>
          </div>
          {fixScopeValidation && (
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
              范围校验：{fixScopeValidation.passed ? `通过 (${fixScopeValidation.riskLevel})` : `未通过`}
              {fixScopeValidation.warnings.length > 0 && <span> | {fixScopeValidation.warnings.join('; ')}</span>}
            </div>
          )}
          {fixComparison.isBetter && (
            <div style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4, fontWeight: 500 }}>
              已自动采用修复后版本。
            </div>
          )}
          {!fixComparison.isBetter && (
            <div style={{ fontSize: 11, color: 'var(--color-warning-text)', marginTop: 4 }}>
              修稿未能显著改善质量，当前正文保持不变。可查看候选版本后手动采用。
            </div>
          )}
          {/* 回退/采用按钮 */}
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={onRevertFix}
              style={{ flex: 1, fontSize: 11 }}
            >
              ↩️ 回退原版本
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={onConfirmFix}
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
            <span style={{ color: 'var(--color-warning-text)' }}>待处理：{statistics.pending}</span>
            <span style={{ color: 'var(--color-success)' }}>已处理：{statistics.resolved}</span>
            <span style={{ color: 'var(--color-text-muted)' }}>已忽略：{statistics.ignored}</span>
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
                onClick={() => onFilterChange(f)}
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
          data-testid="quality-issue"
          data-issue-id={item.id}
          data-issue-key={item.issueKey}
          data-status={item.status}
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
              onClick={() => onLocate(item)}
              title="定位到正文对应位置"
            >
              📍 定位
            </button>

            {/* 状态相关按钮 */}
            {!viewingHistory && item.status === 'pending' && (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  data-testid="quality-issue-resolve"
                  data-issue-id={item.id}
                  onClick={() => onStatusChange(item.id, 'resolved')}
                >
                  ✅ 标记已处理
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  data-testid="quality-issue-ignore"
                  data-issue-id={item.id}
                  onClick={() => onStatusChange(item.id, 'ignored')}
                >
                  🚫 忽略
                </button>
              </>
            )}
            {!viewingHistory && (item.status === 'resolved' || item.status === 'ignored') && (
              <button
                className="btn btn-sm btn-secondary"
                data-testid="quality-issue-reopen"
                data-issue-id={item.id}
                onClick={() => onStatusChange(item.id, 'pending')}
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
