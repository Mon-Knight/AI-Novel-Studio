function CheckPanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">质量检查项</div>

        <div className="check-item pass">
          <span className="check-icon">✅</span>
          <span>逻辑检查</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>通过</span>
        </div>
        <div className="check-item warn">
          <span className="check-icon">⚠️</span>
          <span>设定违背检查</span>
          <span style={{ fontSize: 10, color: 'var(--color-warning)', marginLeft: 'auto' }}>1项建议</span>
        </div>
        <div className="check-item pass">
          <span className="check-icon">✅</span>
          <span>角色行为检查</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>通过</span>
        </div>
        <div className="check-item warn">
          <span className="check-icon">⚠️</span>
          <span>前后文割裂检查</span>
          <span style={{ fontSize: 10, color: 'var(--color-warning)', marginLeft: 'auto' }}>2项建议</span>
        </div>
        <div className="check-item fail">
          <span className="check-icon">❌</span>
          <span>病句/错别字检查</span>
          <span style={{ fontSize: 10, color: 'var(--color-error)', marginLeft: 'auto' }}>3处问题</span>
        </div>
        <div className="check-item pass">
          <span className="check-icon">✅</span>
          <span>节奏检查</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>通过</span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">检查详情</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>⚠️ 设定违背：</strong>
            <div style={{ paddingLeft: 12, color: 'var(--color-text-muted)' }}>
              第3段提到"窗外可以看到星星"，但设定中房间没有窗户
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>⚠️ 前后文割裂：</strong>
            <div style={{ paddingLeft: 12, color: 'var(--color-text-muted)' }}>
              林远在第1段说"我不记得"，但第5段又说"我记得很清楚"
            </div>
          </div>
          <div>
            <strong>❌ 病句/错别字：</strong>
            <div style={{ paddingLeft: 12, color: 'var(--color-text-muted)' }}>
              · 第2段："他感觉到"应为"他感到"<br />
              · 第6段："一股强烈的"语义重复<br />
              · 第8段：标点符号使用不规范
            </div>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <button className="panel-btn panel-btn-secondary">🔄 重新检查</button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
          检查结果仅作建议，不会自动修改正文
        </div>
      </div>
    </div>
  );
}

export default CheckPanel;
