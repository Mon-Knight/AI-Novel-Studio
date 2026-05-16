import type { Chapter } from '../../../types/chapter';

interface AiGeneratePanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function AiGeneratePanel({ novelId, chapter }: AiGeneratePanelProps) {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        {chapter ? (
          <>
            <div className="panel-field">
              <div className="panel-field-label">章节</div>
              <div className="panel-field-value">第{chapter.chapterNumber}章：{chapter.title}</div>
            </div>
            <div className="panel-field" style={{ marginTop: 8 }}>
              <div className="panel-field-label">目标字数</div>
              <div className="panel-field-value">{chapter.targetWordCount?.toLocaleString() || 4000} 字</div>
            </div>
            <div className="panel-field" style={{ marginTop: 8 }}>
              <div className="panel-field-label">当前状态</div>
              <div className="panel-field-value">{chapter.status === 'not_started' ? '未开始' : chapter.status === 'outline_ready' ? '已有大纲' : chapter.status}</div>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted">请先在左侧选择章节</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">方案选择</div>
        <div className="panel-field">
          <div className="panel-field-label">风格方案</div>
          <select className="panel-select" defaultValue="style-001">
            <option value="style-001">科幻快节奏</option>
            <option value="style-002">仙侠厚重</option>
          </select>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">输出控制方案</div>
          <select className="panel-select" defaultValue="output-001">
            <option value="output-001">默认输出方案</option>
            <option value="output-002">第一人称方案</option>
          </select>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">生成模式</div>
          <select className="panel-select" defaultValue="full">
            <option value="full">完整生成</option>
            <option value="continue">续写模式</option>
            <option value="outline_first">先生成大纲再写</option>
          </select>
        </div>
      </div>

      <div className="panel-section">
        <button className="panel-btn panel-btn-primary">🤖 生成本章</button>
        <button className="panel-btn panel-btn-secondary">🔄 重新生成</button>
        <button className="panel-btn panel-btn-secondary">✏️ 根据当前稿修改</button>
        <button className="panel-btn panel-btn-warning">✅ 确认采用</button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
          AI 正文生成功能将在 v0.5.0 开放
        </div>
      </div>
    </div>
  );
}

export default AiGeneratePanel;
