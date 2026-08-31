import { Ban, CheckCircle2, FileText, Lightbulb, LocateFixed, RotateCcw } from 'lucide-react';
import type { QualityCheckItem, QualityIssueStatus } from '../../../types/qualityCheck';
import {
  QualityIssueSeverityColors,
  QualityIssueSeverityLabels,
  QualityIssueStatusLabels,
  QualityIssueTypeLabels,
} from '../../../types/qualityCheck';

interface CheckPanelIssueCardProps {
  item: QualityCheckItem;
  viewingHistory: boolean;
  onLocate: (item: QualityCheckItem) => void;
  onStatusChange: (itemId: string, status: QualityIssueStatus) => void;
}

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

export function CheckPanelIssueCard({
  item,
  viewingHistory,
  onLocate,
  onStatusChange,
}: CheckPanelIssueCardProps) {
  return (
    <div
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
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{item.description}</div>
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
            {item.quote || item.evidence}
          </span>
        </div>
      )}
      {item.suggestion && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-primary)',
            marginTop: 3,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
          }}
        >
          <Lightbulb
            size={13}
            strokeWidth={1.8}
            aria-hidden="true"
            style={{ flexShrink: 0, marginTop: 1 }}
          />
          {item.suggestion}
        </div>
      )}
      <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => onLocate(item)}
          title="定位到正文对应位置"
        >
          <LocateFixed size={13} strokeWidth={1.8} aria-hidden="true" />
          定位
        </button>
        {!viewingHistory && item.status === 'pending' && (
          <>
            <button
              className="btn btn-sm btn-primary"
              data-testid="quality-issue-resolve"
              data-issue-id={item.id}
              onClick={() => onStatusChange(item.id, 'resolved')}
            >
              <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" />
              标记已处理
            </button>
            <button
              className="btn btn-sm btn-secondary"
              data-testid="quality-issue-ignore"
              data-issue-id={item.id}
              onClick={() => onStatusChange(item.id, 'ignored')}
            >
              <Ban size={13} strokeWidth={1.8} aria-hidden="true" />
              忽略
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
            <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
            重新打开
          </button>
        )}
      </div>
    </div>
  );
}
