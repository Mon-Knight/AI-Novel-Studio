import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { novelRepository } from '../../services/database/novelRepository';
import NovelCard from '../../components/novel-card/NovelCard';
import type { Novel } from '../../types/novel';
import '../../styles/home.css';

const quickActions = [
  { icon: '📥', label: '导入作品', path: '/coming-soon?from=import-novel' },
  { icon: '📄', label: '导入 TXT', path: '/coming-soon?from=import-txt' },
  { icon: '📋', label: '导入 JSON', path: '/coming-soon?from=import-json' },
  { icon: '🎨', label: '模板中心', path: '/coming-soon?from=templates' },
];

function HomePage() {
  const navigate = useNavigate();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGenre, setNewGenre] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadNovels = useCallback(async () => {
    try {
      const list = await novelRepository.getAll();
      setNovels(list);
    } catch (e) {
      console.error('Failed to load novels:', e);
    }
  }, []);

  useEffect(() => {
    loadNovels();
  }, [loadNovels]);

  const handleCreateNovel = async () => {
    if (!newTitle.trim()) {
      setCreateError('请输入作品名称');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const novel = await novelRepository.create({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        genre: newGenre.trim() || undefined,
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewGenre('');
      setNewDesc('');
      navigate(`/novels/${novel.id}`);
    } catch (e) {
      setCreateError('创建失败，请重试');
    } finally {
      setCreating(false);
    }
  };

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
        <div className="quick-action-card" onClick={() => setShowCreateModal(true)} style={{ borderColor: 'var(--color-primary)', background: 'var(--color-primary-light)' }}>
          <div className="qa-icon">✏️</div>
          <div className="qa-label" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>新建作品</div>
        </div>
        {quickActions.map((action) => (
          <div key={action.label} className="quick-action-card" onClick={() => navigate(action.path)}>
            <div className="qa-icon">{action.icon}</div>
            <div className="qa-label">{action.label}</div>
          </div>
        ))}
      </div>

      {/* 作品列表 */}
      <div className="home-section-header">
        <span className="home-section-title">我的作品</span>
        <span className="home-section-count">共 {novels.length} 部</span>
      </div>

      {novels.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📖</div>
          <div style={{ fontSize: 16, marginBottom: 16 }}>还没有作品，点击上方「新建作品」开始</div>
        </div>
      ) : (
        <div className="novel-card-grid">
          {novels.map((novel) => (
            <NovelCard
              key={novel.id}
              novel={novel}
              onClick={() => navigate(`/novels/${novel.id}`)}
              onEnterWorkspace={() => navigate(`/novels/${novel.id}/workspace`)}
            />
          ))}
        </div>
      )}

      {/* 新建作品弹窗 */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">✏️ 新建作品</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="panel-field-label">作品名称 *</label>
                <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                  className="form-input" placeholder="请输入作品名称" style={{ width: '100%' }}
                  autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreateNovel()} />
              </div>
              <div>
                <label className="panel-field-label">题材</label>
                <input type="text" value={newGenre} onChange={(e) => setNewGenre(e.target.value)}
                  className="form-input" placeholder="如：科幻、仙侠、悬疑" style={{ width: '100%' }} />
              </div>
              <div>
                <label className="panel-field-label">简介</label>
                <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                  className="form-textarea" placeholder="简要介绍作品背景和主要情节方向"
                  style={{ width: '100%', height: 80, resize: 'vertical' }} />
              </div>
              {createError && (
                <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{createError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => { setShowCreateModal(false); setCreateError(''); }}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={handleCreateNovel} disabled={creating}>
                  {creating ? '创建中...' : '创建作品'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomePage;
