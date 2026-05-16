import { useNavigate } from 'react-router-dom';
import { mockNovels } from '../../features/novels/mockNovels';
import NovelCard from '../../components/novel-card/NovelCard';
import '../../styles/home.css';

const quickActions = [
  { icon: '✏️', label: '新建作品', path: '/coming-soon?from=new-novel' },
  { icon: '📥', label: '导入作品', path: '/coming-soon?from=import-novel' },
  { icon: '📄', label: '导入 TXT', path: '/coming-soon?from=import-txt' },
  { icon: '📋', label: '导入 JSON', path: '/coming-soon?from=import-json' },
  { icon: '🎨', label: '模板中心', path: '/coming-soon?from=templates' },
];

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-page">
      {/* 横幅 */}
      <div className="home-banner">
        <div className="home-banner-icon">📝</div>
        <div className="home-banner-content">
          <div className="home-banner-title">欢迎使用 AI Novel Studio</div>
          <div className="home-banner-desc">
            Windows 桌面端 AI 小说创作工作台。逐章辅助生成、修改、润色与确认，帮助完成长篇小说。
          </div>
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="home-quick-actions">
        {quickActions.map((action) => (
          <div
            key={action.label}
            className="quick-action-card"
            onClick={() => navigate(action.path)}
          >
            <div className="qa-icon">{action.icon}</div>
            <div className="qa-label">{action.label}</div>
          </div>
        ))}
      </div>

      {/* 作品列表 */}
      <div className="home-section-header">
        <span className="home-section-title">我的作品</span>
        <span className="home-section-count">共 {mockNovels.length} 部</span>
      </div>

      <div className="novel-card-grid">
        {mockNovels.map((novel) => (
          <NovelCard
            key={novel.id}
            novel={novel}
            onClick={() => navigate(`/novels/${novel.id}`)}
            onEnterWorkspace={() => navigate(`/novels/${novel.id}/workspace`)}
          />
        ))}
      </div>
    </div>
  );
}

export default HomePage;
