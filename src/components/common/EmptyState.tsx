/**
 * AI Novel Studio - 通用空状态组件
 */
import { Inbox, type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

function EmptyState({
  icon: Icon = Inbox,
  title = '暂无数据',
  description,
  action,
}: EmptyStateProps) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-muted)' }}>
      <Icon aria-hidden="true" size={40} strokeWidth={1.8} style={{ marginBottom: 12 }} />
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{title}</div>
      {description && <div style={{ fontSize: 12, marginBottom: 12 }}>{description}</div>}
      {action && (
        <button className="btn btn-primary btn-sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
