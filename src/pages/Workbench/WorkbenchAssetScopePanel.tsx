import {
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type {
  WorkbenchAssetScopeGroup,
  WorkbenchAssetScopeItem,
  WorkbenchAssetScopeStatus,
  WorkbenchAssetScopeSummary,
} from '../../services/conversation/workbenchAssetScopeService';

const GROUPS: Array<{ id: WorkbenchAssetScopeGroup; label: string }> = [
  { id: 'foundation', label: '基础设定' },
  { id: 'structure', label: '故事结构' },
  { id: 'controls', label: '生成控制' },
  { id: 'continuity', label: '章节连续性' },
];

const STATUS_LABELS: Record<WorkbenchAssetScopeStatus, string> = {
  ready: '可用',
  fallback: '回退可用',
  automatic: '运行时读取',
  missing: '未准备',
  unavailable: '读取失败',
};

function StatusIcon({ status }: { status: WorkbenchAssetScopeStatus }) {
  if (status === 'ready') return <CircleCheck aria-hidden="true" size={13} strokeWidth={1.8} />;
  if (status === 'automatic' || status === 'fallback') {
    return <Clock3 aria-hidden="true" size={13} strokeWidth={1.8} />;
  }
  if (status === 'unavailable') {
    return <ShieldAlert aria-hidden="true" size={13} strokeWidth={1.8} />;
  }
  return <CircleAlert aria-hidden="true" size={13} strokeWidth={1.8} />;
}

function ScopeItem({
  item,
  onOpen,
}: {
  item: WorkbenchAssetScopeItem;
  onOpen: (path: string) => void;
}) {
  const evidenceLabel = item.evidence
    ? [item.evidence.source, item.evidence.revision, item.evidence.fingerprint]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <div
      className={`workbench-asset-scope-item is-${item.status}`}
      data-testid={`workbench-asset-scope-${item.key}`}
      data-asset-status={item.status}
    >
      <span className="workbench-asset-scope-item-status">
        <StatusIcon status={item.status} />
        <span>{STATUS_LABELS[item.status]}</span>
      </span>
      <span className="workbench-asset-scope-item-copy">
        <strong>{item.label}</strong>
        <span title={item.value}>{item.value}</span>
        {evidenceLabel && (
          <span className="workbench-asset-scope-item-evidence" title={evidenceLabel}>
            {evidenceLabel}
          </span>
        )}
      </span>
      {item.actionPath && (
        <button
          type="button"
          className="workbench-asset-scope-action"
          aria-label={`管理${item.label}`}
          title={`管理${item.label}`}
          onClick={() => onOpen(item.actionPath!)}
        >
          <ExternalLink aria-hidden="true" size={13} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

export function WorkbenchAssetScopePanel({
  summary,
  loading,
  error,
  onRefresh,
  onOpen,
}: {
  summary: WorkbenchAssetScopeSummary | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onOpen: (path: string) => void;
}) {
  return (
    <section
      id="workbench-asset-scope-panel"
      className="workbench-asset-scope-panel"
      data-testid="workbench-asset-scope-panel"
      aria-label="可用创作上下文"
    >
      <header className="workbench-asset-scope-header">
        <div>
          <strong>可用创作上下文</strong>
          {summary && (
            <span>
              {summary.requiredMissingCount > 0
                ? `${summary.requiredMissingCount} 项核心资产待准备`
                : '核心上下文可用'}
            </span>
          )}
        </div>
        <button
          type="button"
          className="workbench-asset-scope-action"
          aria-label="刷新可用创作上下文"
          title="刷新可用创作上下文"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw
            className={loading ? 'is-spinning' : undefined}
            aria-hidden="true"
            size={14}
            strokeWidth={1.8}
          />
        </button>
      </header>

      {error && (
        <div className="workbench-asset-scope-error" role="alert">
          {error}
        </div>
      )}
      {loading && !summary && !error && (
        <div className="workbench-asset-scope-loading" role="status">
          正在读取可用创作上下文…
        </div>
      )}

      {summary && (
        <div className="workbench-asset-scope-groups">
          {GROUPS.map((group) => {
            const items = summary.items.filter((item) => item.group === group.id);
            if (items.length === 0) return null;
            return (
              <section className="workbench-asset-scope-group" key={group.id}>
                <h3>{group.label}</h3>
                <div className="workbench-asset-scope-items">
                  {items.map((item) => (
                    <ScopeItem item={item} key={item.key} onOpen={onOpen} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
