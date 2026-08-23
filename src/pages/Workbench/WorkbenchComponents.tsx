import { memo, useMemo, useState } from 'react';
import type {
  ConversationArtifactCard,
  TaskConversationBundle,
  ToolCallEvent,
} from '../../types/conversation';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { TOOL_LABELS, statusLabel } from './workbenchHelpers';

/**
 * 简化工具摘要行（默认在对话流中紧凑展示）
 */
export const ToolEventRow = memo(function ToolEventRow({ event }: { event: ToolCallEvent }) {
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
});

/**
 * 候选产物交互卡片（支持采纳、确认入审、申请应用、修改与拒绝）
 */
export const ArtifactCard = memo(function ArtifactCard({
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
});

/**
 * Agent 状态栏（规划、生成、检查、完成/待命）
 */
export const AgentConsoleStatusBar = memo(function AgentConsoleStatusBar({
  status,
  activeWorkerId,
  latestToolName,
}: {
  status: string;
  activeWorkerId?: string;
  latestToolName?: string;
}) {
  const stage =
    status === 'running'
      ? latestToolName?.includes('check') || latestToolName?.includes('evaluate')
        ? 'checking'
        : latestToolName?.includes('read') || latestToolName?.includes('outline')
          ? 'planning'
          : 'executing'
      : status === 'completed'
        ? 'completed'
        : status === 'failed'
          ? 'failed'
          : 'idle';

  return (
    <div
      className="agent-console-status-bar"
      data-testid="agent-console-status-bar"
      data-stage={stage}
    >
      <div className="agent-status-pipeline">
        <div className={`agent-status-step ${stage === 'planning' ? 'is-active' : ''}`}>
          <span className="agent-step-icon">🧠</span>
          <span className="agent-step-label">规划</span>
        </div>
        <div className="agent-status-arrow">→</div>
        <div className={`agent-status-step ${stage === 'executing' ? 'is-active' : ''}`}>
          <span className="agent-step-icon">⚙️</span>
          <span className="agent-step-label">生成</span>
        </div>
        <div className="agent-status-arrow">→</div>
        <div className={`agent-status-step ${stage === 'checking' ? 'is-active' : ''}`}>
          <span className="agent-step-icon">📝</span>
          <span className="agent-step-label">检查</span>
        </div>
        <div className="agent-status-arrow">→</div>
        <div className={`agent-status-step ${stage === 'completed' ? 'is-active' : ''}`}>
          <span className="agent-step-icon">✓</span>
          <span className="agent-step-label">完成</span>
        </div>
      </div>

      <div className="agent-status-current">
        <span className={`agent-status-indicator is-${status}`} />
        <span className="agent-status-text">
          {status === 'running'
            ? `Agent 正在执行: ${TOOL_LABELS[latestToolName ?? ''] ?? latestToolName ?? '创作任务'} (${activeWorkerId || 'Worker'})`
            : status === 'completed'
              ? 'Agent 创作任务已就绪'
              : status === 'failed'
                ? '任务执行中断'
                : 'Agent 待命中，请输入目标'}
        </span>
      </div>
    </div>
  );
});

/**
 * 对话 / 轨迹 双 Tab 切换器
 */
export const AgentConsoleTabs = memo(function AgentConsoleTabs({
  activeTab,
  onTabChange,
  eventCount = 0,
}: {
  activeTab: 'chat' | 'trace';
  onTabChange: (tab: 'chat' | 'trace') => void;
  eventCount?: number;
}) {
  return (
    <nav className="agent-console-tabs" data-testid="agent-console-tabs" aria-label="视图切换">
      <button
        type="button"
        className={`agent-console-tab-btn ${activeTab === 'chat' ? 'is-active' : ''}`}
        data-testid="workbench-tab-chat"
        onClick={() => onTabChange('chat')}
      >
        <span className="tab-icon">💬</span>
        <span>创作对话</span>
      </button>
      <button
        type="button"
        className={`agent-console-tab-btn ${activeTab === 'trace' ? 'is-active' : ''}`}
        data-testid="workbench-tab-trace"
        onClick={() => onTabChange('trace')}
      >
        <span className="tab-icon">🔍</span>
        <span>执行轨迹</span>
        {eventCount > 0 && <span className="tab-badge">{eventCount}</span>}
      </button>
    </nav>
  );
});

/**
 * 轨迹视图画布（展示详细 Tool Call、参数/返回值 JSON、Decision Traces 与 Quality Reviews）
 */
export const AgentTraceCanvas = memo(function AgentTraceCanvas({
  bundle,
  onRetry,
}: {
  bundle: TaskConversationBundle;
  onRetry?: (previousGoal: string) => void;
}) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());

  const toggleExpand = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const runs = bundle.runs ?? [];
  const events = bundle.toolEvents ?? [];

  if (runs.length === 0 && events.length === 0) {
    return (
      <div className="agent-trace-empty" data-testid="agent-trace-empty">
        <div className="trace-empty-icon">🔍</div>
        <h3>暂无 Agent 执行轨迹</h3>
        <p>当向 Agent 发送创作指令后，所有工具调用、决策树、评估打分将在此全景展现。</p>
      </div>
    );
  }

  return (
    <div className="agent-trace-canvas" data-testid="agent-trace-canvas">
      {runs.map((run, runIndex) => {
        const runEvents = events.filter((e) => e.runId === run.runId);
        const relatedTurn = bundle.turns.find((t) => t.turnId === run.turnId);

        return (
          <section
            className="agent-trace-run-card"
            key={run.runId}
            data-testid="agent-trace-run"
            data-run-id={run.runId}
            data-status={run.status}
          >
            <div className="trace-run-header">
              <div className="trace-run-title">
                <span className="run-index-badge">Run #{runIndex + 1}</span>
                <strong>{relatedTurn?.content?.slice(0, 40) || '创作运行'}</strong>
                <span className="worker-tag">Worker: {run.workerId}</span>
              </div>
              <span className={`workbench-run-badge is-${run.status}`}>
                {statusLabel(run.status)}
              </span>
            </div>

            {/* 模型快照信息 */}
            {run.modelSnapshot && (
              <div className="trace-model-snapshot">
                <span>
                  🧠 模型快照: {run.modelSnapshot.providerId || 'default'}:
                  {run.modelSnapshot.modelId || 'auto'}
                </span>
                {run.startedAt && <time>开始: {new Date(run.startedAt).toLocaleTimeString()}</time>}
                {run.finishedAt && (
                  <time>结束: {new Date(run.finishedAt).toLocaleTimeString()}</time>
                )}
              </div>
            )}

            {/* 工具执行时间线 */}
            <div className="trace-events-timeline">
              <h4>🛠️ 工具调用序列 ({runEvents.length})</h4>
              {runEvents.length === 0 ? (
                <p className="trace-no-events">该 Run 未产生工具调用</p>
              ) : (
                runEvents.map((evt) => {
                  const isExpanded = expandedEvents.has(evt.eventId);
                  const semantic = TOOL_LABELS[evt.toolName] ?? evt.toolName;
                  return (
                    <div
                      key={evt.eventId}
                      className={`trace-event-item is-${evt.status}`}
                      data-testid="trace-event-item"
                    >
                      <div
                        className="trace-event-summary"
                        onClick={() => toggleExpand(evt.eventId)}
                      >
                        <span className="trace-status-icon">
                          {evt.status === 'succeeded' ? '✓' : evt.status === 'failed' ? '!' : '…'}
                        </span>
                        <strong className="trace-tool-title">{semantic}</strong>
                        <code className="trace-tool-code">{evt.toolName}</code>
                        <span className="trace-duration">
                          {evt.durationMs ? `${evt.durationMs}ms` : ''}
                        </span>
                        <span className="trace-expand-btn">
                          {isExpanded ? '▲ 收起' : '▼ 展开 JSON'}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="trace-event-detail">
                          <div className="trace-json-block">
                            <span className="json-label">输入参数:</span>
                            <pre>{JSON.stringify(evt.argumentsSummary, null, 2)}</pre>
                          </div>
                          {evt.result !== undefined && (
                            <div className="trace-json-block">
                              <span className="json-label">返回结果:</span>
                              <pre>
                                {typeof evt.result === 'string'
                                  ? evt.result
                                  : JSON.stringify(evt.result, null, 2)}
                              </pre>
                            </div>
                          )}
                          {evt.error && <div className="trace-error-text">错误: {evt.error}</div>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* 错误与重试 */}
            {run.error && (
              <div className="workbench-inline-error" data-testid="trace-run-error">
                {run.error}
              </div>
            )}

            {run.status === 'failed' && onRetry && (
              <button
                type="button"
                className="btn btn-secondary btn-sm trace-retry-btn"
                data-testid="trace-retry-turn"
                onClick={() => {
                  const prevUserTurn = [...bundle.turns].reverse().find((t) => t.role === 'user');
                  if (prevUserTurn?.content) onRetry(prevUserTurn.content);
                }}
              >
                重试该回合
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
});

const pluginLifecycleLabel = {
  available: '可用',
  unavailable: '不可用',
  initialized: '已初始化',
  not_initialized: '未初始化',
  healthy: '健康',
  unknown: '未知',
  failed: '失败',
} as const;

export const PluginPanel = memo(function PluginPanel({
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
});

export const MemoryInspectorCard = memo(function MemoryInspectorCard({
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
      <div
        style={{
          display: 'flex',
          gap: 8,
          fontSize: 11,
          color: 'var(--color-text-muted, #64748b)',
        }}
      >
        <span>长期: {longTermCount}</span>
        <span>中期: {midTermCount}</span>
        <span>短期: {shortTermCount}</span>
      </div>
    </div>
  );
});
