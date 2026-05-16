import type { Chapter } from '../../../types/chapter';

interface CheckPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function CheckPanel({ novelId, chapter }: CheckPanelProps) {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">质量检查项</div>
        <div className="check-item">
          <span className="check-icon">⏳</span>
          <span>逻辑检查</span>
        </div>
        <div className="check-item">
          <span className="check-icon">⏳</span>
          <span>设定违背检查</span>
        </div>
        <div className="check-item">
          <span className="check-icon">⏳</span>
          <span>角色行为检查</span>
        </div>
        <div className="check-item">
          <span className="check-icon">⏳</span>
          <span>前后文割裂检查</span>
        </div>
        <div className="check-item">
          <span className="check-icon">⏳</span>
          <span>病句/错别字检查</span>
        </div>
        <div className="check-item">
          <span className="check-icon">⏳</span>
          <span>节奏检查</span>
        </div>
      </div>

      <div className="panel-section">
        <button className="panel-btn panel-btn-secondary" onClick={() => {}}>
          🔍 质量检查
        </button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
          质量检查将在 v0.9.0 接入
        </div>
      </div>
    </div>
  );
}

export default CheckPanel;
