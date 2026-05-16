import type { Novel } from '../../types/novel';

interface NovelCardProps {
  novel: Novel;
  onClick: () => void;
  onEnterWorkspace: () => void;
}

const genreIcons: Record<string, string> = {
  '科幻': '🚀',
  '仙侠': '⚔️',
  '都市悬疑': '🌃',
  '奇幻': '🐉',
  '历史': '📜',
  '言情': '💕',
};

const statusLabels: Record<string, string> = {
  'planning': '规划中',
  'writing': '创作中',
  'completed': '已完成',
  'paused': '已暂停',
};

function NovelCard({ novel, onClick, onEnterWorkspace }: NovelCardProps) {
  const icon = genreIcons[novel.genre] || '📖';

  return (
    <div className="novel-card" onClick={onClick}>
      <div className="novel-card-cover">
        <span className="novel-card-cover-icon">{icon}</span>
        <span className="novel-card-genre">{novel.genre}</span>
      </div>
      <div className="novel-card-body">
        <div className="novel-card-title">{novel.title}</div>
        <div className="novel-card-desc">{novel.description}</div>
        <div className="novel-card-meta">
          <span className="novel-card-meta-item">
            {novel.totalWords.toLocaleString()} 字
          </span>
          <span className="novel-card-meta-item">
            目标 {novel.targetWords.toLocaleString()} 字
          </span>
          <span className="novel-card-meta-item">
            {new Date(novel.updatedAt).toLocaleDateString('zh-CN')}
          </span>
        </div>
        <div className="novel-card-footer">
          <span className={`novel-card-status ${novel.status}`}>
            {statusLabels[novel.status] || novel.status}
          </span>
          <span
            className="novel-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onEnterWorkspace();
            }}
          >
            进入工作台 →
          </span>
        </div>
      </div>
    </div>
  );
}

export default NovelCard;
