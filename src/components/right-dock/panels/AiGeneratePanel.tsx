function AiGeneratePanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        <div className="panel-field">
          <div className="panel-field-label">章节</div>
          <select className="panel-select">
            <option>第1章：异乡醒来</option>
            <option>第2章：规则的裂缝</option>
            <option>第3章：第一次选择</option>
          </select>
        </div>
        <div className="panel-field">
          <div className="panel-field-label">目标字数</div>
          <select className="panel-select" defaultValue="4000">
            <option value="2000">2000 字</option>
            <option value="3000">3000 字</option>
            <option value="4000">4000 字</option>
            <option value="5000">5000 字</option>
            <option value="6000">6000 字</option>
          </select>
        </div>
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
        <div className="panel-field">
          <div className="panel-field-label">输出控制方案</div>
          <select className="panel-select" defaultValue="output-001">
            <option value="output-001">默认输出方案</option>
            <option value="output-002">第一人称方案</option>
          </select>
        </div>
        <div className="panel-field">
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
      </div>
    </div>
  );
}

export default AiGeneratePanel;
