function StylePanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">当前风格方案</div>
        <div className="panel-field">
          <div className="panel-field-label">方案名称</div>
          <div className="panel-field-value">科幻快节奏</div>
        </div>
        <div className="panel-field" style={{ marginTop: 12 }}>
          <div className="panel-field-label">方案说明</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            适合科幻小说的快节奏风格，注重情节推进和场景转换
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">输出控制方案</div>
        <div className="panel-field">
          <div className="panel-field-label">方案名称</div>
          <div className="panel-field-value">默认输出方案</div>
        </div>
        <div className="panel-field" style={{ marginTop: 12 }}>
          <div className="panel-field-label">视角</div>
          <div className="panel-field-value">第三人称有限视角</div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">输出参数摘要</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div>📊 目标字数：4,000 字/章</div>
          <div>⚡ 节奏倾向：快速</div>
          <div>💬 对话比例：35%</div>
          <div>🖊️ 描写比例：25%</div>
          <div>📝 段落长度：中等</div>
          <div>⏰ 时态：过去时</div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">禁用写法摘要</div>
        <ul style={{ fontSize: 13, color: 'var(--color-text-secondary)', paddingLeft: 16, lineHeight: 1.8 }}>
          <li>过度心理描写</li>
          <li>长篇景物描写</li>
          <li>说教式表达</li>
        </ul>
      </div>
    </div>
  );
}

export default StylePanel;
