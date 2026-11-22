import {
  CircleAlert,
  CircleCheck,
  Clock3,
  ChevronUp,
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
  automatic: '生成时核验',
  missing: '未准备',
  unavailable: '读取失败',
};

const SUMMARY_GROUPS: WorkbenchAssetScopeGroup[] = ['foundation', 'structure'];

function groupStatus(items: WorkbenchAssetScopeItem[]) {
  if (items.some((item) => item.status === 'unavailable')) {
    return { label: '读取失败', tone: 'error' };
  }
  if (items.some((item) => item.status === 'missing')) {
    return { label: '部分未准备', tone: 'warning' };
  }
  if (items.some((item) => item.status === 'automatic')) {
    return { label: '生成时核验', tone: 'info' };
  }
  return { label: '可用', tone: 'ready' };
}

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
      <span className="workbench-asset-scope-item-copy">
        <strong>{item.label}</strong>
        <span title={item.value}>{item.value}</span>
        {evidenceLabel && (
          <span className="workbench-asset-scope-item-evidence" title={evidenceLabel}>
            {evidenceLabel}
          </span>
        )}
      </span>
      <span className="workbench-asset-scope-item-status">
        <StatusIcon status={item.status} />
        <span>{STATUS_LABELS[item.status]}</span>
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
  onCollapse,
  embedded = false,
  id = 'workbench-asset-scope-panel',
}: {
  summary: WorkbenchAssetScopeSummary | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onOpen: (path: string) => void;
  onCollapse?: () => void;
  /** Omit duplicate panel heading when hosted inside the side panel view header. */
  embedded?: boolean;
  /** The side panel hosts a second instance and must not reuse the composer's id. */
  id?: string;
}) {
  const availableCount =
    summary?.items.filter((item) => ['ready', 'fallback'].includes(item.status)).length ?? 0;
  const automaticCount = summary?.items.filter((item) => item.status === 'automatic').length ?? 0;
  const pendingCount = summary?.requiredMissingCount ?? 0;
  const unavailableCount = summary?.unavailableCount ?? 0;

  return (
    <section
      id={id}
      className="workbench-asset-scope-panel"
      data-testid={id}
      data-context-stage="preflight-preview"
      aria-label="创作上下文"
    >
      <div className="workbench-asset-scope-sticky">
        <header className="workbench-asset-scope-header">
          <div className="workbench-asset-scope-heading">
            {!embedded && <strong>创作上下文</strong>}
            <span className="workbench-asset-scope-counts" aria-live="polite">
              {summary
                ? `可用 ${availableCount} 项 · 待准备 ${pendingCount} 项`
                : '正在读取资产状态'}
              {automaticCount > 0 ? ` · 生成时核验 ${automaticCount} 项` : ''}
              {unavailableCount > 0 ? ` · 读取失败 ${unavailableCount} 项` : ''}
            </span>
          </div>
          <div className="workbench-asset-scope-header-actions">
            <button
              type="button"
              className="workbench-asset-scope-header-action"
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
            {onCollapse && (
              <button
                type="button"
                className="workbench-asset-scope-header-action"
                data-testid="workbench-asset-scope-collapse"
                aria-label="收起创作上下文"
                title="收起创作上下文"
                onClick={onCollapse}
              >
                <ChevronUp aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </header>

        <div className="workbench-asset-scope-summary" data-testid="workbench-asset-scope-summary">
          <div className="workbench-asset-scope-summary-heading">
            <strong>生成前资产状态</strong>
            <p className="workbench-asset-scope-disclaimer">
              发送前预览，不代表本轮已经冻结或注入；运行后请以对话中的上下文回执为准。
            </p>
            {summary && pendingCount === 0 && unavailableCount === 0 && (
              <span className="workbench-asset-scope-summary-ready">核心上下文可用</span>
            )}
          </div>
          {summary && (
            <div className="workbench-asset-scope-summary-groups">
              {SUMMARY_GROUPS.map((groupId) => {
                const group = GROUPS.find((item) => item.id === groupId)!;
                const items = summary.items.filter((item) => item.group === groupId);
                if (items.length === 0) return null;
                const status = groupStatus(items);
                return (
                  <span
                    className={`workbench-asset-scope-summary-group is-${status.tone}`}
                    data-context-group-summary={groupId}
                    key={groupId}
                  >
                    <span>{group.label}</span>
                    <strong>{status.label}</strong>
                  </span>
                );
              })}
            </div>
          )}
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
        </div>
      </div>

      {summary && (
        <div className="workbench-asset-scope-details" data-testid="workbench-asset-scope-details">
          <div className="workbench-asset-scope-details-heading">详细资产</div>
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
        </div>
      )}
    </section>
  );
}
