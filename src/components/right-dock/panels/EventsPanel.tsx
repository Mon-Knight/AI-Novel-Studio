function EventsPanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">AI 推荐事件</div>
        <div className="event-item">
          <strong>醒来与困惑</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            林远在陌生房间醒来，记忆残缺，探索环境
          </div>
        </div>
        <div className="event-item">
          <strong>与指导员的初次会面</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            艾琳出现，开始引导林远了解前哨站
          </div>
        </div>
        <div className="event-item">
          <strong>走廊观察</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            林远注意到其他人看他的异样眼神
          </div>
        </div>
        <div className="event-item">
          <strong>首次暗示真相</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            艾琳回避关键问题，暗示传送系统非同寻常
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">用户已选择事件</div>
        <div className="event-item" style={{ borderLeftColor: 'var(--color-primary)' }}>
          <strong>醒来与困惑</strong>
          <span style={{ fontSize: 10, color: 'var(--color-primary)', marginLeft: 8 }}>✓ 已选</span>
        </div>
        <div className="event-item" style={{ borderLeftColor: 'var(--color-primary)' }}>
          <strong>与指导员的初次会面</strong>
          <span style={{ fontSize: 10, color: 'var(--color-primary)', marginLeft: 8 }}>✓ 已选</span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">必须发生事件</div>
        <div className="event-item must-happen">
          <strong>⚠ 林远必须发现记忆异常</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>建立核心悬念</div>
        </div>
        <div className="event-item must-happen">
          <strong>⚠ 必须出现传送相关暗示</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>为后续剧情埋线</div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">禁止发生事件</div>
        <div className="event-item forbidden">
          <strong>禁止：林远立刻获得超能力</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>能力觉醒应在后续章节展开</div>
        </div>
        <div className="event-item forbidden">
          <strong>禁止：过早揭示全部真相</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>保持悬念节奏</div>
        </div>
      </div>
    </div>
  );
}

export default EventsPanel;
