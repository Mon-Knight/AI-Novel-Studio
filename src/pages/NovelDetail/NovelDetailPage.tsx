import { useParams, useNavigate } from 'react-router-dom';
import { mockNovels } from '../../features/novels/mockNovels';
import '../../styles/novel-detail.css';

const statusLabels: Record<string, string> = {
  'planning': '规划中',
  'writing': '创作中',
  'completed': '已完成',
  'paused': '已暂停',
};

const manageCards = [
  {
    icon: '🌍',
    title: '基础设定',
    desc: '世界背景、规则体系、主角与特殊能力',
    path: '/coming-soon?from=world-setting',
  },
  {
    icon: '📋',
    title: '大纲管理',
    desc: '分卷大纲与章节大纲规划',
    path: '/coming-soon?from=outlines',
  },
  {
    icon: '👥',
    title: '角色库',
    desc: '已确认角色、角色关系与状态记录',
    path: '/coming-soon?from=characters',
  },
  {
    icon: '🎨',
    title: '风格方案',
    desc: '写作风格配置与方案切换',
    path: '/coming-soon?from=style-profiles',
  },
  {
    icon: '⚙️',
    title: '输出控制',
    desc: '章节输出格式、视角与字数控制',
    path: '/coming-soon?from=output-profiles',
  },
  {
    icon: '📥',
    title: '导入导出',
    desc: 'TXT / JSON 导入与作品导出',
    path: '/coming-soon?from=import-export',
  },
];

function NovelDetailPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const novel = mockNovels.find((n) => n.id === novelId);

  if (!novel) {
    return (
      <div className="novel-detail-page">
        <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: 16 }}>
          <span style={{ fontSize: 48, opacity: 0.3 }}>📖</span>
          <span className="text-secondary">作品未找到</span>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="novel-detail-page">
      {/* 头部信息 */}
      <div className="detail-header">
        <div className="detail-cover">📖</div>
        <div className="detail-info">
          <div className="detail-title">{novel.title}</div>
          <span className="detail-genre">{novel.genre}</span>
          <div className="detail-desc">{novel.description}</div>
          <div className="detail-progress">
            <div className="detail-progress-item">
              <div className="detail-progress-value">{novel.totalWords.toLocaleString()}</div>
              <div className="detail-progress-label">总字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">{novel.targetWords.toLocaleString()}</div>
              <div className="detail-progress-label">目标字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">{statusLabels[novel.status]}</div>
              <div className="detail-progress-label">状态</div>
            </div>
          </div>
          <div className="detail-actions">
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/novels/${novel.id}/workspace`)}
            >
              ✏️ 进入写作工作台
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/coming-soon?from=edit-novel')}>
              ⚙️ 编辑作品
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/coming-soon?from=export-novel')}>
              📤 导出
            </button>
          </div>
        </div>
      </div>

      {/* 管理卡片 */}
      <div className="detail-cards-grid">
        {manageCards.map((card) => (
          <div
            key={card.title}
            className="detail-card"
            onClick={() => navigate(card.path)}
          >
            <div className="detail-card-header">
              <div className="detail-card-icon">{card.icon}</div>
              <div className="detail-card-title">{card.title}</div>
            </div>
            <div className="detail-card-desc">{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default NovelDetailPage;
