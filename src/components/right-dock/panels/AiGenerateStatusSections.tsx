import type { AiSettings } from '../../../types/ai';

interface AiGenerateStatusSectionsProps {
  settings: AiSettings;
  contextCount: number | null;
  contextLoadError: string;
}

export function AiGenerateStatusSections({
  settings,
  contextCount,
  contextLoadError,
}: AiGenerateStatusSectionsProps) {
  return (
    <>
      <div className="panel-section">
        <div className="panel-section-title">AI 状态</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div>模式：{settings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
          {settings.runtimeMode === 'api' && <div>模型：{settings.modelName || '未配置'}</div>}
          {settings.runtimeMode === 'api' && !settings.apiKey && (
            <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
              ⚠️ 未配置 API Key，请先到设置中心配置
            </div>
          )}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">📦 上下文加载状态</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div
            data-testid="generation-context-count"
            data-context-count={contextCount === null ? 'error' : String(contextCount)}
          >
            已加载上下文：<strong>{contextCount === null ? '读取失败' : contextCount}</strong>
            {contextCount === null ? '' : ' 条'}
          </div>
          {contextLoadError && (
            <div
              role="alert"
              data-testid="error-notice"
              style={{ color: 'var(--color-error)', marginTop: 2 }}
            >
              {contextLoadError}
            </div>
          )}
          {contextCount === 0 && (
            <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
              暂无前文上下文记录，可先在已采用章节中生成总结
            </div>
          )}
          {contextCount !== null && contextCount > 0 && (
            <div style={{ color: 'var(--color-success)', marginTop: 2 }}>
              ✅ 下一章生成时将自动加载以上下文摘要
            </div>
          )}
        </div>
      </div>
    </>
  );
}
