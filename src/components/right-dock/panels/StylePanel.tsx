import type { Chapter } from '../../../types/chapter';

interface StylePanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function StylePanel({ novelId, chapter }: StylePanelProps) {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">当前风格方案</div>
        <div className="panel-field">
          <div className="panel-field-label">方案名称</div>
          <div className="panel-field-value">科幻快节奏</div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">输出控制方案</div>
          <div className="panel-field-value">默认输出方案 · 第三人称有限视角</div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">输出参数</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          {chapter ? (
            <>
              <div>📊 目标字数：{chapter.targetWordCount?.toLocaleString() || 4000} 字/章</div>
            </>
          ) : (
            <div className="text-sm text-muted">选择章节后显示参数</div>
          )}
          <div>⚡ 节奏倾向：快速</div>
          <div>💬 对话比例：35%</div>
          <div>🖊️ 描写比例：25%</div>
          <div>📝 段落长度：中等</div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 16 }}>
        风格方案与输出控制将在 v0.6.0 完整接入
      </div>
    </div>
  );
}

export default StylePanel;
