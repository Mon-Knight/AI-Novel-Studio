function PolishPanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">润色选项</div>

        <div className="polish-option selected">
          <span>✅</span>
          <span>保持剧情不变</span>
        </div>
        <div className="polish-option selected">
          <span>✅</span>
          <span>增强描写</span>
        </div>
        <div className="polish-option">
          <span>⬜</span>
          <span>减少废话</span>
        </div>
        <div className="polish-option selected">
          <span>✅</span>
          <span>强化冲突</span>
        </div>
        <div className="polish-option">
          <span>⬜</span>
          <span>调整节奏</span>
        </div>
        <div className="polish-option selected">
          <span>✅</span>
          <span>统一文风</span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">润色说明</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <p>润色将在保持剧情不变的前提下，对正文进行以下优化：</p>
          <ul style={{ paddingLeft: 16, marginTop: 8 }}>
            <li>增强场景描写和环境氛围</li>
            <li>强化人物对话的冲突感</li>
            <li>统一全文的语言风格</li>
          </ul>
        </div>
      </div>

      <div className="panel-section">
        <button className="panel-btn panel-btn-primary">✨ 开始润色</button>
        <button className="panel-btn panel-btn-secondary">📋 仅预览润色结果</button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
          润色结果将生成新版本，不直接覆盖当前正文
        </div>
      </div>
    </div>
  );
}

export default PolishPanel;
