function CharactersPanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">本章出场角色</div>
        <div className="character-item">
          <div className="character-avatar">林</div>
          <div className="character-info">
            <div className="character-name">林远</div>
            <div className="character-role">主角 · 航天工程师</div>
          </div>
        </div>
        <div className="character-item">
          <div className="character-avatar">艾</div>
          <div className="character-info">
            <div className="character-name">艾琳(E-247)</div>
            <div className="character-role">配角 · 适应指导员</div>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">已生成角色（角色库）</div>
        <div className="character-item">
          <div className="character-avatar">林</div>
          <div className="character-info">
            <div className="character-name">林远</div>
            <div className="character-role">主角 · 已确认</div>
          </div>
        </div>
        <div className="character-item">
          <div className="character-avatar">艾</div>
          <div className="character-info">
            <div className="character-name">艾琳(E-247)</div>
            <div className="character-role">配角 · 已确认</div>
          </div>
        </div>
        <div className="character-item">
          <div className="character-avatar">卡</div>
          <div className="character-info">
            <div className="character-name">卡尔·雷恩</div>
            <div className="character-role">反派 · 已确认</div>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">AI 推荐候选角色</div>
        <div className="character-item" style={{ opacity: 0.7 }}>
          <div className="character-avatar" style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}>
            ?
          </div>
          <div className="character-info">
            <div className="character-name">梅丽莎</div>
            <div className="character-role">候选 · 前哨站医师</div>
          </div>
        </div>
        <div className="character-item" style={{ opacity: 0.7 }}>
          <div className="character-avatar" style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}>
            ?
          </div>
          <div className="character-info">
            <div className="character-name">艾伦</div>
            <div className="character-role">候选 · 传送技术员</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8, textAlign: 'center' }}>
          候选角色需确认后加入角色库
        </div>
      </div>
    </div>
  );
}

export default CharactersPanel;
