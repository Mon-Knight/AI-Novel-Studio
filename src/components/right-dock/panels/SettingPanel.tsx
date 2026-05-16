function SettingPanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">世界背景</div>
        <div className="panel-field">
          <div className="panel-field-label">时代设定</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            遥远的未来，人类已经遍布银河系。星际旅行通过传送系统实现，各星域由联盟统一管理。
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 12 }}>
          <div className="panel-field-label">当前地点</div>
          <div className="panel-field-value">第七前哨站 · 边界星域中转基地</div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">规则体系</div>
        <div className="panel-field">
          <div className="panel-field-label">传送系统</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            联盟掌握的超光速传送技术，可将人员/物资在星域间瞬间传输。传送过程中记忆可能出现暂时性模糊。
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 12 }}>
          <div className="panel-field-label">联盟管理</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            银河联盟对各星域实施统一管理，前哨站是边界星域的管理节点。指导员制度是联盟对新公民的管理方式。
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">主角特殊能力</div>
        <div className="panel-field">
          <div className="panel-field-label">能力名称</div>
          <div className="panel-field-value">未觉醒（当前章节尚未展现）</div>
        </div>
        <div className="panel-field" style={{ marginTop: 12 }}>
          <div className="panel-field-label">能力说明</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            林远拥有异常的空间感知能力，这与传送系统存在某种未知的共振。此能力将在后续章节逐渐展现。
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">本章特殊限制</div>
        <ul style={{ fontSize: 13, color: 'var(--color-text-secondary)', paddingLeft: 16, lineHeight: 1.8 }}>
          <li>能力尚未觉醒</li>
          <li>不出现战斗场景</li>
          <li>不揭示核心秘密</li>
        </ul>
      </div>
    </div>
  );
}

export default SettingPanel;
