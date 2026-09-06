import { appLogger } from '../../services/observability/appLogger';
import { useState, useRef } from 'react';
import {
  BookOpenText,
  FileJson,
  FileText,
  LayoutTemplate,
  PenLine,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { novelRepository } from '../../services/database/novelRepository';
import { novelService } from '../../services/novels/novelService';
import NovelCard from '../../components/novel-card/NovelCard';
import FirstTimeGuide from '../../components/common/FirstTimeGuide';
import ImportTxtDialog from '../../components/import/ImportTxtDialog';
import ImportJsonDialog from '../../components/import/ImportJsonDialog';
import { useNovelLibrary } from '../../features/novels/useNovelLibrary';
import LoadingState from '../../components/common/LoadingState';
import ErrorState from '../../components/common/ErrorState';
import EmptyState from '../../components/common/EmptyState';
import { PageHeader } from '../../components/common/PageLayout';
import { CreateNovelDialog } from '../../components/novel-card/CreateNovelDialog';
import { confirmDanger, showError } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';
import '../../styles/home.css';

const quickActions: Array<
  | { icon: LucideIcon; label: string; action: 'import-txt' | 'import-json' }
  | { icon: LucideIcon; label: string; path: string }
> = [
  { icon: FileText, label: '导入 TXT', action: 'import-txt' },
  { icon: FileJson, label: '导入 JSON', action: 'import-json' },
  { icon: LayoutTemplate, label: '模板中心', path: '/templates' },
];

function HomePage() {
  const navigate = useNavigate();
  const { novels, setNovels, loading, error, reload: loadNovels } = useNovelLibrary();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newGenre, setNewGenre] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showTxtImport, setShowTxtImport] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const creationPending = useRef(false);
  const recentNovel = [...novels].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];

  const handleCreateNovel = async () => {
    if (creationPending.current) return;
    if (!newTitle.trim()) {
      setCreateError('请输入作品名称');
      return;
    }
    creationPending.current = true;
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
      // 先切换路由再重置状态，避免状态冲突
      navigate(`/novels/${novel.id}`);
    } catch (e) {
      setCreateError('创建失败，请重试');
    } finally {
      creationPending.current = false;
      setCreating(false);
    }
  };

  // v1.0.26 删除作品（级联删除 + 二次确认）
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteNovel = async (novelId: string) => {
    if (deletingId) return;
    const novel = novels.find((n) => n.id === novelId);
    if (!novel) return;
    if (
      !(await confirmDanger({
        title: '删除作品',
        message: `确定要删除作品《${novel.title}》吗？\n\n此操作会删除该作品下的分卷、章节、草稿、大纲、角色、事件、设定、上下文总结和相关 AI 任务记录。\n\n删除后无法恢复。`,
      }))
    )
      return;

    setDeletingId(novelId);
    try {
      await novelService.deleteNovelCascade(novelId);
      setNovels((prev) => prev.filter((n) => n.id !== novelId));
    } catch (e: unknown) {
      appLogger.captureError('NOVEL_DELETE_FAILED', e, { novelId });
      await showError({
        title: '删除作品失败',
        message: describeUnknownError(e, '删除作品失败'),
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="home-page">
      <PageHeader
        title="小说作品"
        icon={BookOpenText}
        description="继续已有作品，或开始一个新的小说项目。"
        actions={
          <>
            {recentNovel && (
              <button
                className="btn btn-secondary"
                onClick={() => navigate(`/novels/${recentNovel.id}/workspace`)}
                data-testid="project-continue-recent"
              >
                继续《{recentNovel.title}》
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              data-testid="project-create"
              onClick={() => setShowCreateModal(true)}
            >
              <PenLine aria-hidden="true" size={16} strokeWidth={1.8} />
              新建作品
            </button>
          </>
        }
      />
      <FirstTimeGuide />

      {/* 快捷入口 */}
      <div className="home-quick-actions">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              className="quick-action-card"
              onClick={() => {
                if ('action' in action) {
                  if (action.action === 'import-txt') setShowTxtImport(true);
                  else if (action.action === 'import-json') setShowJsonImport(true);
                } else if ('path' in action) {
                  navigate(action.path);
                }
              }}
            >
              <div className="qa-icon">
                <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
              </div>
              <div className="qa-label">{action.label}</div>
            </button>
          );
        })}
      </div>

      {/* 作品列表 */}
      <div className="home-section-header">
        <span className="home-section-title">我的作品</span>
        <span className="home-section-count">
          {loading ? '正在读取…' : error ? '读取未完成' : `共 ${novels.length} 部`}
        </span>
      </div>

      <div data-testid="project-list">
        {error && (
          <ErrorState message="作品读取失败" detail={error} onRetry={() => void loadNovels()} />
        )}
        {loading && novels.length === 0 ? (
          <LoadingState text="正在读取作品…" />
        ) : novels.length === 0 && !error ? (
          <EmptyState
            icon={BookOpenText}
            title="还没有作品"
            description="创建作品后，即可在创作工作台提出目标。"
            action={{ label: '创建第一部作品', onClick: () => setShowCreateModal(true) }}
          />
        ) : (
          <div className="novel-card-grid">
            {novels.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                onClick={() => navigate(`/novels/${novel.id}`)}
                onEnterWorkspace={() => navigate(`/novels/${novel.id}/workspace`)}
                onDelete={handleDeleteNovel}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建作品弹窗 */}
      {showCreateModal && (
        <CreateNovelDialog
          value={{ title: newTitle, genre: newGenre, description: newDesc }}
          busy={creating}
          error={createError}
          onChange={(patch) => {
            if (patch.title !== undefined) setNewTitle(patch.title);
            if (patch.genre !== undefined) setNewGenre(patch.genre);
            if (patch.description !== undefined) setNewDesc(patch.description);
          }}
          onCreate={() => void handleCreateNovel()}
          onCancel={() => {
            if (!creating) {
              setShowCreateModal(false);
              setCreateError('');
            }
          }}
        />
      )}

      {/* 导入弹窗 */}
      {showTxtImport && (
        <ImportTxtDialog
          onClose={() => {
            setShowTxtImport(false);
            loadNovels();
          }}
        />
      )}
      {showJsonImport && (
        <ImportJsonDialog
          onClose={() => {
            setShowJsonImport(false);
            loadNovels();
          }}
        />
      )}
    </div>
  );
}

export default HomePage;
