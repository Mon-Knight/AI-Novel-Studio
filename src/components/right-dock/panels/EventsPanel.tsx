import type { Chapter } from '../../../types/chapter';

interface EventsPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function EventsPanel({ novelId, chapter }: EventsPanelProps) {
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">AI 推荐事件</div>
        <div className="event-item">
          <strong>醒来与困惑</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            {chapter ? `第${chapter.chapterNumber}章 ${chapter.title} 的核心事件` : '选择章节后显示相关事件'}
          </div>
        </div>
        <div className="event-item">
          <strong>与指导员的初次会面</strong>
          <div style={{ fontSize: 12, marginTop: 2 }}>建立角色关系</div>
        </div>
      </div>

      <div className="panel-section">
        <div style={{ textAlign: 'center', padding: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
          剧情事件推荐将在 v0.7.0 接入
        </div>
      </div>
    </div>
  );
}

export default EventsPanel;
