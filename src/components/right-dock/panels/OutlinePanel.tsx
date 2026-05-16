function OutlinePanel() {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">当前分卷大纲</div>
        <div className="panel-field">
          <div className="panel-field-label">第一卷：觉醒</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            主角林远在异乡醒来，发现被传送到一个陌生星域。他在适应这个新世界的过程中，逐渐发现第七前哨站隐藏的秘密。
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 12 }}>
          <div className="panel-field-label">第二卷：风暴</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            林远抵达王城，卷入政治阴谋与星际风暴。各方势力开始注意到这个来自母星的不速之客。
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">当前章节大纲</div>
        <div className="panel-field">
          <div className="panel-field-label">第1章：异乡醒来</div>
          <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            林远在陌生的房间里醒来，记忆出现断层。适应指导员艾琳出现并开始引导他了解第七前哨站。
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">本章目标</div>
        <ul style={{ fontSize: 13, color: 'var(--color-text-secondary)', paddingLeft: 16, lineHeight: 1.8 }}>
          <li>建立陌生感和悬念</li>
          <li>引入适应指导员艾琳</li>
          <li>埋下传送系统秘密的伏笔</li>
          <li>结尾设置悬念钩子</li>
        </ul>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">与上一章衔接</div>
        <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-muted)' }}>
          本章为开篇第一章，无前文衔接。
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">结尾伏笔</div>
        <ul style={{ fontSize: 13, color: 'var(--color-text-secondary)', paddingLeft: 16, lineHeight: 1.8 }}>
          <li>艾琳对某些问题的刻意回避</li>
          <li>走廊里其他人看林远的眼神</li>
          <li>记忆传送过程中的异常</li>
        </ul>
      </div>
    </div>
  );
}

export default OutlinePanel;
