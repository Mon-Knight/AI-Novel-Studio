/**
 * AI Novel Studio - 创作资产中心页面
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import { novelRepository } from '../../services/database/novelRepository';
import { characterService } from '../../services/characters/characterService';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { contextRecordService } from '../../services/context/contextRecordService';
import { styleProfileService } from '../../services/styles/styleProfileService';
import { settingSuggestionService } from '../../services/settingSuggestions/settingSuggestionService';
import { contentTransactionService } from '../../services/content-transactions/contentTransactionService';
import { getDbMode } from '../../services/database/db';
import type { Novel } from '../../types/novel';

interface AssetCard {
  title: string;
  icon: string;
  count: string;
  desc: string;
  path: string;
}

function AssetsPage() {
  const navigate = useNavigate();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [stats, setStats] = useState<Record<string, string>>({});

  useEffect(() => {
    novelRepository.getAll().then((list) => {
      setNovels(list);
      if (list.length > 0) setSelectedNovelId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedNovelId) return;
    Promise.all([
      characterService.getByNovelId(selectedNovelId),
      chapterSummaryService.getByNovelId(selectedNovelId),
      contextRecordService.getByNovelId(selectedNovelId),
      styleProfileService.getAll(selectedNovelId),
      settingSuggestionService.getByNovelId(selectedNovelId),
      getDbMode() === 'tauri'
        ? Promise.all([
            contentTransactionService.listFactions(selectedNovelId),
            contentTransactionService.listLocations(selectedNovelId),
          ])
        : Promise.resolve([[], []] as const),
    ]).then(([chars, sums, ctx, styles, suggestions, [factions, locations]]) => {
      setStats({
        chars: String(chars.length),
        sums: String(sums.length),
        ctx: String(ctx.length),
        styles: String(styles.length),
        suggestions: String(suggestions.filter((item) => item.status === 'pending').length),
        storyAssets: String(factions.length + locations.length),
      });
    });
  }, [selectedNovelId]);

  const selectedNovel = novels.find((n) => n.id === selectedNovelId);

  const assetCards: AssetCard[] = [
    {
      title: '基础设定',
      icon: '📖',
      count: selectedNovel ? '1' : '0',
      desc: '作品信息、世界背景',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '角色库',
      icon: '👥',
      count: stats.chars || '0',
      desc: '已确认角色与状态',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '风格方案',
      icon: '🎨',
      count: stats.styles || '0',
      desc: '文风与节奏控制',
      path: '/styles',
    },
    {
      title: '章节总结',
      icon: '📝',
      count: stats.sums || '0',
      desc: '已总结章节',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '上下文记录',
      icon: '📦',
      count: stats.ctx || '0',
      desc: '前文摘要与伏笔',
      path: selectedNovelId ? `/novels/${selectedNovelId}` : '',
    },
    {
      title: '设定库 AI 推演',
      icon: '◇',
      count: stats.suggestions || '0',
      desc: '待确认候选设定',
      path: selectedNovelId ? `/novels/${selectedNovelId}/setting-suggestions` : '',
    },
    {
      title: '势力与地点',
      icon: '🗺️',
      count: stats.storyAssets || '0',
      desc: '正式资产与跨章事务',
      path: selectedNovelId ? `/novels/${selectedNovelId}/story-assets` : '',
    },
    { title: '导入资产', icon: '📥', count: '0', desc: '外部导入素材', path: '/import-export' },
  ];

  return (
    <div className="page-container" style={{ height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回工作台" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>
        📦 创作资产中心
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        聚合当前作品所有创作资产，提供统一管理入口
      </div>

      {/* 作品选择器 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>📖</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>选择作品</span>
        </div>
        {novels.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 16,
              color: 'var(--color-text-muted)',
              fontSize: 13,
            }}
          >
            暂无作品，请先创建小说
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/novels')}>
                前往小说作品
              </button>
            </div>
          </div>
        ) : (
          <select
            className="input"
            value={selectedNovelId}
            onChange={(e) => setSelectedNovelId(e.target.value)}
            style={{ width: '100%' }}
          >
            {novels.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}（{n.genre || '未分类'}）
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 资产卡片 */}
      {selectedNovel && (
        <div className="asset-card-grid">
          {assetCards.map((card) => (
            <div
              key={card.title}
              className="detail-card"
              style={{
                cursor: card.path ? 'pointer' : 'default',
                textAlign: 'center',
                opacity: card.path ? 1 : 0.5,
              }}
              onClick={() => {
                if (card.path) navigate(card.path);
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>{card.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{card.title}</div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  marginBottom: 4,
                }}
              >
                {card.count}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{card.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AssetsPage;
