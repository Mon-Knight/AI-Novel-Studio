import { memo, useMemo } from 'react';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';

const pluginLifecycleLabel = {
  available: '可用',
  unavailable: '不可用',
  initialized: '已初始化',
  not_initialized: '未初始化',
  healthy: '健康',
  unknown: '未知',
  failed: '失败',
} as const;

const pluginStatusLabel: Record<CurrentPluginProjection['status'], string> = {
  loaded: '已加载',
  failed: '失败',
  unavailable: '不可用',
};

export const PluginPanel = memo(function PluginPanel({
  plugins,
  loading = false,
  error = '',
  onClose,
}: {
  plugins: CurrentPluginProjection[];
  loading?: boolean;
  error?: string;
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
  const showGroups = !loading && (!error || plugins.length > 0);
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
          <X aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
      {loading && (
        <div
          className="workbench-plugin-feedback"
          data-testid="workbench-plugin-loading"
          role="status"
        >
          <LoaderCircle className="is-spinning" aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>正在读取 Runtime Registry</span>
        </div>
      )}
      {!loading && error && (
        <div
          className="workbench-plugin-feedback is-error"
          data-testid="workbench-plugin-error"
          role="alert"
        >
          <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}
      {showGroups &&
        (['function', 'model', 'other'] as const).map((category) => (
          <section
            key={category}
            className="workbench-plugin-group"
            data-testid="workbench-plugin-group"
            data-category={category}
          >
            <h3>
              {category === 'function'
                ? '功能插件'
                : category === 'model'
                  ? '模型插件'
                  : '其他插件'}
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
                      {pluginStatusLabel[plugin.status]}
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
    </aside>
  );
});
