import type { Chapter } from '../../../types/chapter';

interface PolishPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function PolishPanel({ novelId, chapter }: PolishPanelProps) {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">润色选项</div>
        <div className="polish-option">
          <span>⬜</span> <span>保持剧情不变</span>
        </div>
        <div className="polish-option">
          <span>⬜</span> <span>增强描写</span>
        </div>
        <div className="polish-option">
          <span>⬜</span> <span>减少废话</span>
        </div>
        <div className="polish-option">
          <span>⬜</span> <span>强化冲突</span>
        </div>
        <div className="polish-option">
          <span>⬜</span> <span>调整节奏</span>
        </div>
        <div className="polish-option">
          <span>⬜</span> <span>统一文风</span>
        </div>
      </div>

      <div className="panel-section">
        <button className="panel-btn panel-btn-primary" onClick={() => {}}>
          ✨ 开始润色
        </button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
          正文润色将在 v0.9.0 接入
        </div>
      </div>
    </div>
  );
}

export default PolishPanel;
