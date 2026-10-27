/**
 * AI Novel Studio - 创作资产中心页面
 */
import { useState } from 'react';
import {
  BookOpenText,
  Boxes,
  FileText,
  Import,
  Map,
  Palette,
  Sparkles,
  UsersRound,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import { useNovelLibrary } from '../../features/novels/useNovelLibrary';
import { useAssetStatistics } from '../../features/assets/useAssetStatistics';
import LoadingState from '../../components/common/LoadingState';
import ErrorState from '../../components/common/ErrorState';
import EmptyState from '../../components/common/EmptyState';
import { PageHeader, PageLayout } from '../../components/common/PageLayout';

interface AssetCard {
  title: string;
  icon: LucideIcon;
  count: string;
  desc: string;
  path: string;
}

function AssetsPage() {
  const navigate = useNavigate();
  const library = useNovelLibrary();
  const { novels } = library;
  const [requestedNovelId, setSelectedNovelId] = useState('');
  const selectedNovelId = novels.some((novel) => novel.id === requestedNovelId)
    ? requestedNovelId
    : (novels[0]?.id ?? '');
  const stats = useAssetStatistics(selectedNovelId);
  const count = (key: string) => (stats.status === 'ready' ? String(stats.values[key] ?? 0) : '—');

  const selectedNovel = novels.find((n) => n.id === selectedNovelId);

  const assetCards: AssetCard[] = [
    {
      title: '基础设定',
      icon: BookOpenText,
      count: count('foundation'),
      desc: '已建世界、规则与主角设定（0–3 类）',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '角色库',
      icon: UsersRound,
      count: count('chars'),
      desc: '已确认角色与状态',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '风格方案',
      icon: Palette,
      count: count('styles'),
      desc: '文风与节奏控制',
      path: '/styles',
    },
    {
      title: '章节总结',
      icon: FileText,
      count: count('sums'),
      desc: '已总结章节',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '上下文记录',
      icon: Boxes,
      count: count('ctx'),
      desc: '前文摘要与伏笔',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '设定库 AI 推演',
      icon: Sparkles,
      count: count('suggestions'),
      desc: '待确认候选设定',
      path: selectedNovelId ? `/novels/${selectedNovelId}/setting-suggestions` : '',
    },
    {
      title: '势力与地点',
      icon: Map,
      count: count('storyAssets'),
      desc: '正式资产与跨章事务',
      path: selectedNovelId ? `/novels/${selectedNovelId}/story-assets` : '',
    },
    {
      title: '导入资产',
      icon: Import,
      count: count('importedAssets'),
      desc: '外部导入素材',
      path: '/import-export',
    },
  ];

  return (
    <PageLayout>
      <BackButton label="返回工作台" to="/" />
      <PageHeader
        title="创作资产中心"
        icon={Waypoints}
        description="查看当前作品的创作资产与管理入口"
      />

      {/* 作品选择器 */}
      <div className="detail-card resource-gap-bottom-lg">
        <div className="resource-card-title resource-gap-bottom">
          <BookOpenText aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>选择作品</span>
        </div>
        {library.loading && novels.length === 0 ? (
          <LoadingState text="正在读取作品…" />
        ) : library.error ? (
          <ErrorState
            message="作品读取失败"
            detail={library.error}
            onRetry={() => void library.reload()}
          />
        ) : novels.length === 0 ? (
          <EmptyState
            title="尚未创建作品"
            action={{ label: '前往小说作品', onClick: () => navigate('/novels') }}
          />
        ) : (
          <select
            className="input resource-fill"
            aria-label="选择作品"
            value={selectedNovelId}
            onChange={(e) => setSelectedNovelId(e.target.value)}
          >
            {novels.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}（{n.genre || '未分类'}）
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedNovel && stats.status === 'loading' && <LoadingState text="正在读取当前作品资产…" />}
      {selectedNovel && stats.status === 'error' && (
        <ErrorState message="资产统计读取失败" detail={stats.error} onRetry={stats.reload} />
      )}

      {/* 资产卡片 */}
      {selectedNovel && (
        <div className="asset-card-grid">
          {assetCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                type="button"
                key={card.title}
                className="detail-card detail-card--interactive resource-stat-card"
                disabled={!card.path}
                onClick={() => {
                  if (card.path) navigate(card.path);
                }}
              >
                <Icon
                  aria-hidden="true"
                  size={28}
                  strokeWidth={1.8}
                  className="resource-stat-icon"
                />
                <div className="resource-stat-title">{card.title}</div>
                <div className="resource-stat-value">{card.count}</div>
                <div className="resource-stat-desc">{card.desc}</div>
              </button>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}

export default AssetsPage;
