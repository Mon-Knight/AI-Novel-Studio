import { useMemo } from 'react';
import type { ConversationArtifactCard, ToolCallEvent } from '../../types/conversation';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';

function statusLabel(status: string): string {
  return (
    {
      queued: '排队中',
      cancel_requested: '取消中',
      cancelled: '已取消',
    }[status] ?? status
  );
}

const TOOL_LABELS: Record<string, string> = {
  'novel.read_context': '读取小说上下文',
  'chapter.read_outline': '读取章节大纲',
  search_memory: '检索长期记忆',
  generate_chapter: '生成章节候选',
  generate_outline: '生成大纲候选',
  generate_characters: '生成角色候选',
  suggest_events: '生成事件候选',
  expand_settings: '扩展设定候选',
  polish_chapter: '润色章节候选',
  check_quality: '质量检查报告',
  summarize_chapter: '章节总结候选',
};

export function ToolEventRow({ event }: { event: ToolCallEvent }) {
  const semanticName = TOOL_LABELS[event.toolName] ?? '运行时事件';
  return (
    <div
      className={`workbench-tool-event is-${event.status}`}
      data-testid="workbench-tool-event"
      data-event-id={event.eventId}
      data-call-id={event.callId}
      data-tool-name={event.toolName}
      data-status={event.status}
    >
      <span className="workbench-tool-icon" aria-hidden="true">
        {event.status === 'succeeded'
          ? '✓'
          : event.status === 'failed'
            ? '!'
            : event.status === 'running'
              ? '…'
              : '·'}
      </span>
      <span className="workbench-tool-label">{semanticName}</span>
      <span className="workbench-tool-name">{event.toolName}</span>
      <span className="workbench-tool-status">
        {event.status === 'succeeded'
          ? '已完成'
          : event.status === 'failed'
            ? event.error || '失败'
            : statusLabel(event.status)}
      </span>
      {event.durationMs !== undefined && (
        <span className="workbench-tool-duration">{event.durationMs} ms</span>
      )}
    </div>
  );
}

export function ArtifactCard({
  artifact,
  onDecide,
  busy = false,
}: {
  artifact: ConversationArtifactCard;
  onDecide?: (decision: 'confirm' | 'reject' | 'request_revision' | 'request_apply') => void;
  busy?: boolean;
}) {
  const decision = artifact.latestDecision?.decision;
  const projectedStatus = artifact.latestDecision?.conflictCode
    ? `冲突 · ${artifact.latestDecision.conflictCode}`
    : artifact.latestDecision?.applyTransactionId
      ? '已应用'
      : decision === 'confirm'
        ? '已确认'
        : decision === 'reject'
          ? '已拒绝'
          : decision === 'request_revision'
            ? '需修订'
            : decision === 'request_apply'
              ? '待应用'
              : artifact.status === 'candidate'
                ? '待确认'
                : artifact.status;
  const isChapter = artifact.artifactType === 'chapter_text';
  const isReport = artifact.artifactType === 'quality_report';
  const canAct = Boolean(onDecide && artifact.artifactId && !decision);
  return (
    <article
      className="workbench-artifact-card"
      data-testid="workbench-artifact-card"
      data-card-id={artifact.cardId}
      data-artifact-id={artifact.artifactId}
      data-run-id={artifact.runId}
      data-status={artifact.status}
      data-decision={decision ?? ''}
    >
      <div className="workbench-artifact-heading">
        <div>
          <div className="workbench-eyebrow">候选产物 · {artifact.artifactType}</div>
          <h3>{artifact.title}</h3>
        </div>
        <span className="workbench-artifact-status">{projectedStatus}</span>
      </div>
      <p>{artifact.summary}</p>
      <details>
        <summary>{artifact.artifactId ? '查看 ResultArtifact 候选内容' : '查看候选内容'}</summary>
        <pre>{artifact.content || '产物正文正在从权威 Artifact Service 加载。'}</pre>
      </details>
      {canAct && (
        <div className="workbench-artifact-actions">
          {isChapter ? (
            <button
              className="btn btn-primary btn-sm"
              data-testid="workbench-artifact-confirm-review"
              disabled={busy}
              onClick={() => onDecide?.('confirm')}
            >
              确认进入审阅
            </button>
          ) : isReport ? null : (
            <button
              className="btn btn-primary btn-sm"
              data-testid="workbench-artifact-apply"
              disabled={busy}
              onClick={() => onDecide?.('request_apply')}
            >
              确认并申请应用
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            data-testid="workbench-artifact-revise"
            disabled={busy}
            onClick={() => onDecide?.('request_revision')}
          >
            要求修改
          </button>
          <button
            className="btn btn-secondary btn-sm"
            data-testid="workbench-artifact-reject"
            disabled={busy}
            onClick={() => onDecide?.('reject')}
          >
            拒绝
          </button>
        </div>
      )}
    </article>
  );
}

const pluginLifecycleLabel = {
  available: '可用',
  unavailable: '不可用',
  initialized: '已初始化',
  not_initialized: '未初始化',
  healthy: '健康',
  unknown: '未知',
  failed: '失败',
} as const;

export function PluginPanel({
  plugins,
  onClose,
}: {
  plugins: CurrentPluginProjection[];
  onClose: () => void;
}) {
  const grouped = useMemo(
    () => ({
      function: plugins.filter((plugin) => plugin.category === 'function'),
      model: plugins.filter((plugin) => plugin.category === 'model'),
      other: plugins.filter((plugin) => plugin.category === 'other'),
    }),
    [plugins],
  );
  return (
    <aside
      className="workbench-plugin-panel"
      data-testid="workbench-plugin-panel"
      aria-label="当前插件"
    >
      <div className="workbench-plugin-header">
        <div>
          <div className="workbench-eyebrow">Runtime Registry</div>
          <h2>当前插件</h2>
        </div>
        <button
          className="workbench-icon-button"
          data-testid="workbench-plugin-close"
          onClick={onClose}
          aria-label="关闭当前插件"
        >
          ×
        </button>
      </div>
      {(['function', 'model', 'other'] as const).map((category) => (
        <section
          key={category}
          className="workbench-plugin-group"
          data-testid="workbench-plugin-group"
          data-category={category}
        >
          <h3>
            {category === 'function' ? '功能插件' : category === 'model' ? '模型插件' : '其他插件'}
          </h3>
          {grouped[category].length === 0 ? (
            <p className="workbench-empty-inline">暂无可用插件</p>
          ) : (
            grouped[category].map((plugin) => (
              <div
                className="workbench-plugin-row"
                key={plugin.id}
                data-testid="workbench-plugin-row"
                data-plugin-id={plugin.id}
                data-category={plugin.category}
                data-status={plugin.status}
                data-availability={plugin.availability}
                data-initialization={plugin.initialization}
                data-health={plugin.health}
              >
                <div className="workbench-plugin-row-top">
                  <strong>{plugin.name}</strong>
                  <span className={`workbench-plugin-state is-${plugin.status}`}>
                    {plugin.status}
                  </span>
                </div>
                <div className="workbench-plugin-meta">
                  v{plugin.version} · {plugin.description}
                </div>
                <div className="workbench-plugin-lifecycle">
                  可用性：{pluginLifecycleLabel[plugin.availability]} · 初始化：
                  {pluginLifecycleLabel[plugin.initialization]} · 健康：
                  {pluginLifecycleLabel[plugin.health]}
                </div>
                <div className="workbench-plugin-capabilities">
                  {plugin.capabilities.join(' · ')}
                </div>
              </div>
            ))
          )}
        </section>
      ))}
      <p className="workbench-plugin-note">
        此处只读显示运行时实际加载能力，不提供安装、启停、配置或市场操作。
      </p>
    </aside>
  );
}

export function MemoryInspectorCard({
  sceneName,
  povName,
  versionNumber = 1,
  longTermCount = 0,
  midTermCount = 0,
  shortTermCount = 0,
  retrievedCount = 0,
}: {
  sceneName?: string;
  povName?: string;
  versionNumber?: number;
  longTermCount?: number;
  midTermCount?: number;
  shortTermCount?: number;
  retrievedCount?: number;
}) {
  const totalMemories = longTermCount + midTermCount + shortTermCount + retrievedCount;
  if (totalMemories === 0 && !povName && !sceneName) {
    return (
      <div
        className="workbench-memory-inspector-empty"
        data-testid="workbench-memory-empty"
        style={{
          padding: 16,
          textAlign: 'center',
          color: 'var(--color-text-muted, #64748b)',
          fontSize: 13,
        }}
      >
        No memory context available
      </div>
    );
  }

  return (
    <div
      className="workbench-memory-inspector-card"
      data-testid="workbench-memory-inspector-card"
      style={{
        border: '1px solid var(--color-border-light, #e2e8f0)',
        borderRadius: 8,
        padding: 12,
        background: 'var(--color-bg-card, #ffffff)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>🧠 Memory Context · v{versionNumber}</strong>
        <span style={{ color: 'var(--color-text-muted, #64748b)' }}>{sceneName || '当前分镜'}</span>
      </div>
      <div style={{ color: 'var(--color-text-secondary, #475569)', marginBottom: 4 }}>
        POV: {povName || '默认全知'} · 召回碎片: {retrievedCount} 条
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--color-text-muted, #64748b)' }}>
        <span>长期: {longTermCount}</span>
        <span>中期: {midTermCount}</span>
        <span>短期: {shortTermCount}</span>
      </div>
    </div>
  );
}
