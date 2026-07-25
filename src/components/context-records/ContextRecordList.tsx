/**
 * AI Novel Studio - 上下文记录列表组件
 */
import { useState } from 'react';
import type { ContextRecord } from '../../types/context';
import { ContextRecordTypeLabels, ContextRecordTypeColors } from '../../types/context';

interface ContextRecordListProps {
  records: ContextRecord[];
  onToggleActive?: (id: string, isActive: boolean) => void;
  onDelete?: (id: string) => void;
  onAdd?: () => void;
  compact?: boolean;
}

function ContextRecordList({ records, onToggleActive, onDelete, onAdd, compact }: ContextRecordListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const importanceStars = (n: number) => '⭐'.repeat(n);

  if (records.length === 0 && !compact) {
    return (
      <div style={{ padding: 12, fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
        暂无上下文记录
        {onAdd && <div style={{ marginTop: 8 }}><button className="btn btn-secondary btn-sm" onClick={onAdd}>➕ 手动添加</button></div>}
      </div>
    );
  }

  return (
    <div>
      {records.map((r) => (
        <div
          key={r.id}
          data-testid="context-record"
          data-record-id={r.id}
          data-context-type={r.contextType}
          data-active={r.isActive ? 'true' : 'false'}
          data-expired={r.isExpired ? 'true' : 'false'}
          style={{
            padding: compact ? 6 : 10,
            marginBottom: compact ? 4 : 6,
            border: '1px solid var(--color-border-light)',
            borderRadius: 6,
            opacity: r.isActive ? 1 : 0.5,
            cursor: 'pointer',
            borderLeft: `3px solid ${ContextRecordTypeColors[r.contextType] || '#6b7280'}`,
          }}
          onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  background: (ContextRecordTypeColors[r.contextType] || '#6b7280') + '20',
                  color: ContextRecordTypeColors[r.contextType] || '#6b7280',
                  fontWeight: 500,
                }}>
                  {ContextRecordTypeLabels[r.contextType] || r.contextType}
                </span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{r.title}</span>
                {!r.isActive && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>[已停用]</span>}
                {r.isExpired && <span style={{ fontSize: 10, color: 'var(--color-warning)' }}>[已过期]</span>}
              </div>
              {compact ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{r.content.slice(0, 60)}…</div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                  {expandedId === r.id ? r.content : r.content.slice(0, 100) + (r.content.length > 100 ? '…' : '')}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {importanceStars(r.importance)} · 重要度 {r.importance}/5
              </div>
            </div>
            {!compact && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {onToggleActive && (
                  <button
                    className="btn btn-text btn-sm"
                    data-testid="context-record-toggle"
                    data-record-id={r.id}
                    onClick={(e) => { e.stopPropagation(); onToggleActive(r.id, !r.isActive); }}
                  >
                    {r.isActive ? '停用' : '启用'}
                  </button>
                )}
                {onDelete && (
                  <button className="btn btn-text btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(r.id); }} style={{ color: 'var(--color-error)' }}>
                    删除
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      {onAdd && records.length > 0 && (
        <button className="btn btn-secondary btn-sm" onClick={onAdd} style={{ marginTop: 4, width: '100%' }}>
          ➕ 手动添加上下文
        </button>
      )}
    </div>
  );
}

export default ContextRecordList;
