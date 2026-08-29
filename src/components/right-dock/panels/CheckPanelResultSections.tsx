import type { QualityIssueFilter, QualityIssueStatus } from '../../../types/qualityCheck';
import {
  QualityIssueFilterLabels,
  QualityIssueSeverityColors,
  QualityIssueSeverityLabels,
  QualityIssueStatusLabels,
  QualityIssueTypeLabels,
} from '../../../types/qualityCheck';
import type { CheckPanelViewProps } from './CheckPanelView';

const FILTER_OPTIONS: QualityIssueFilter[] = ['all', 'pending', 'resolved', 'ignored'];

function statusStyle(status: QualityIssueStatus) {
  switch (status) {
    case 'resolved':
      return {
        background: 'color-mix(in srgb, var(--color-success) 13%, transparent)',
        color: 'var(--color-success)',
        border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
      };
    case 'ignored':
      return {
        background: 'color-mix(in srgb, var(--color-text-muted) 13%, transparent)',
        color: 'var(--color-text-muted)',
        border: '1px solid color-mix(in srgb, var(--color-text-muted) 25%, transparent)',
      };
    default:
      return {
        background: 'color-mix(in srgb, var(--color-warning) 13%, transparent)',
        color: 'var(--color-warning-text)',
        border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
      };
  }
}

export function CheckPanelResultSections({
  activeReport,
  viewingHistory,
  statistics,
  loading,
  historyReports,
  selectedReportId,
  historyLoading,
  reportOutdated,
  fixComparison,
  fixScopeValidation,
  activeItems,
  filter,
  locateMessage,
  filteredItems,
  onHistoryChange,
  onFilterChange,
  onLocate,
  onStatusChange,
  onRevertFix,
  onConfirmFix,
}: CheckPanelViewProps) {
  return (
    <>
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
                {historyReport.overallScore === undefined
                  ? ''
                  : ` · ${historyReport.overallScore} 分`}
              </option>
            ))}
          </select>
          {viewingHistory && (
            <div
              data-testid="quality-history-readonly"
              style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-muted)' }}
            >
              历史快照 · 只读
            </div>
          )}
        </div>
      )}

      {reportOutdated && (
        <div
          className="panel-section"
          style={{
            border: '1px solid color-mix(in srgb, var(--color-warning) 33%, transparent)',
            background: 'color-mix(in srgb, var(--color-warning) 7%, transparent)',
            borderRadius: 6,
            padding: 10,
            color: 'var(--color-warning-text)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          正文已修改，此检测结果可能已过期。建议重新进行质量检测。
        </div>
      )}

      {activeReport && activeReport.status === 'completed' && (
        <div
          className="panel-section"
          data-testid="quality-report"
          data-report-id={activeReport.id}
          data-draft-id={activeReport.draftId}
        >
          <div className="panel-section-title">📊 检查结果</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color:
                  (activeReport.overallScore ?? 0) >= 80
                    ? 'var(--color-success)'
                    : (activeReport.overallScore ?? 0) >= 60
                      ? 'var(--color-warning)'
                      : 'var(--color-error)',
              }}
            >
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

      {fixComparison && (
        <div
          className="panel-section"
          style={{
            border: `1px solid ${fixComparison.isBetter ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : fixComparison.isWorse ? 'color-mix(in srgb, var(--color-error) 25%, transparent)' : 'color-mix(in srgb, var(--color-warning) 25%, transparent)'}`,
            background: fixComparison.isBetter
              ? 'color-mix(in srgb, var(--color-success) 3%, transparent)'
              : fixComparison.isWorse
                ? 'color-mix(in srgb, var(--color-error) 3%, transparent)'
                : 'color-mix(in srgb, var(--color-warning) 3%, transparent)',
            borderRadius: 6,
            padding: 10,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 13,
              marginBottom: 8,
              color: fixComparison.isBetter
                ? 'var(--color-success)'
                : fixComparison.isWorse
                  ? 'var(--color-error)'
                  : 'var(--color-warning-text)',
            }}
          >
            {fixComparison.isBetter
              ? '✅ 修复成功（已自动采用）'
              : fixComparison.isWorse
                ? '⚠️ 修复效果不佳（保留原版）'
                : '📊 修复效果一般（保留原版）'}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.8 }}>
            <div>
              修复前：{fixComparison.beforeScore} 分，待处理 {fixComparison.beforePendingCount}
              ，严重 {fixComparison.beforeSeriousCount}
            </div>
            <div>
              修复后：{fixComparison.afterScore} 分，待处理 {fixComparison.afterPendingCount}，严重{' '}
              {fixComparison.afterSeriousCount}
            </div>
            <div style={{ marginTop: 4 }}>
              已修复 {fixComparison.fixedIssueCount} 个问题
              {fixComparison.newIssueCount > 0 && (
                <span style={{ color: 'var(--color-warning-text)' }}>
                  ，新增 {fixComparison.newIssueCount} 个问题
                </span>
              )}
            </div>
          </div>
          {fixScopeValidation && (
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
              范围校验：
              {fixScopeValidation.passed ? `通过 (${fixScopeValidation.riskLevel})` : `未通过`}
              {fixScopeValidation.warnings.length > 0 && (
                <span> | {fixScopeValidation.warnings.join('; ')}</span>
              )}
            </div>
          )}
          {fixComparison.isBetter && (
            <div
              style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 4, fontWeight: 500 }}
            >
              已自动采用修复后版本。
            </div>
          )}
          {!fixComparison.isBetter && (
            <div style={{ fontSize: 11, color: 'var(--color-warning-text)', marginTop: 4 }}>
              修稿未能显著改善质量，当前正文保持不变。可查看候选版本后手动采用。
            </div>
          )}
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

      {activeItems.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">📋 问题统计</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>总问题：{statistics.total}</span>
            <span style={{ color: 'var(--color-warning-text)' }}>待处理：{statistics.pending}</span>
            <span style={{ color: 'var(--color-success)' }}>已处理：{statistics.resolved}</span>
            <span style={{ color: 'var(--color-text-muted)' }}>已忽略：{statistics.ignored}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['critical', 'high', 'medium', 'low'] as const).map((severity) =>
              statistics[severity] > 0 ? (
                <span
                  key={severity}
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: QualityIssueSeverityColors[severity] + '20',
                    color: QualityIssueSeverityColors[severity],
                  }}
                >
                  {QualityIssueSeverityLabels[severity]}：{statistics[severity]}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}

      {activeItems.length > 0 && (
        <div className="panel-section" style={{ paddingTop: 0 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {FILTER_OPTIONS.map((filterOption) => (
              <button
                key={filterOption}
                className={`btn btn-sm ${filter === filterOption ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onFilterChange(filterOption)}
                style={{ fontSize: 11, padding: '3px 8px' }}
              >
                {QualityIssueFilterLabels[filterOption]}（
                {filterOption === 'all'
                  ? statistics.total
                  : filterOption === 'pending'
                    ? statistics.pending
                    : filterOption === 'resolved'
                      ? statistics.resolved
                      : statistics.ignored}
                ）
              </button>
            ))}
          </div>
        </div>
      )}

      {locateMessage && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            padding: '6px 8px',
            background: 'var(--color-bg-primary)',
            borderRadius: 4,
            margin: '4px 0',
          }}
        >
          {locateMessage}
        </div>
      )}

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
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 4,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: QualityIssueSeverityColors[item.severity] + '20',
                color: QualityIssueSeverityColors[item.severity],
                fontWeight: 500,
              }}
            >
              {QualityIssueSeverityLabels[item.severity]}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-muted)',
              }}
            >
              {item.category || QualityIssueTypeLabels[item.issueType]}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                ...statusStyle(item.status),
              }}
            >
              {QualityIssueStatusLabels[item.status]}
            </span>
          </div>

          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 3 }}>{item.title}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {item.description}
          </div>

          {(item.quote || item.evidence) && (
            <div
              style={{
                fontSize: 11,
                fontStyle: 'italic',
                color: 'var(--color-text-muted)',
                marginTop: 4,
                padding: '4px 6px',
                background: 'var(--color-bg-primary)',
                borderRadius: 3,
              }}
            >
              📝 {item.quote || item.evidence}
            </div>
          )}

          {item.suggestion && (
            <div style={{ fontSize: 11, color: 'var(--color-primary)', marginTop: 3 }}>
              💡 {item.suggestion}
            </div>
          )}

          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => onLocate(item)}
              title="定位到正文对应位置"
            >
              📍 定位
            </button>

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

      {!activeReport && !loading && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            padding: 16,
          }}
        >
          点击上方按钮对当前草稿进行质量检查
        </div>
      )}

      {activeReport && filteredItems.length === 0 && activeItems.length > 0 && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            padding: 16,
          }}
        >
          当前筛选条件下没有匹配的问题
        </div>
      )}
    </>
  );
}
