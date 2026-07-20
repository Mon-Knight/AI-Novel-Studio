import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { novelService } from '../../services/novels/novelService';
import { settingRepository } from '../../services/database/settingRepository';
import { protagonistRepository } from '../../services/database/protagonistRepository';
import {
  NovelBasicInfoCard,
  WorldSettingCard,
  RuleSystemCard,
  ProtagonistCard,
} from '../../components/novel-detail/NovelDetailCards';
import OutlineManager from '../../components/outline/OutlineManager';
import CharacterLibraryCard from '../../components/novel-card/CharacterLibraryCard';
import ContextOverviewCard from '../../components/novel-card/ContextOverviewCard';
import ExportCard from '../../components/novel-card/ExportCard';
import type { Novel } from '../../types/novel';
import type { WorldSetting, RuleSystem } from '../../types/setting';
import type { Protagonist } from '../../types/protagonist';
import { formatNumber } from '../../utils/format';
import '../../styles/novel-detail.css';

const statusLabels: Record<string, string> = {
  draft: '草稿',
  planning: '规划中',
  writing: '创作中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

function NovelDetailPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();

  const [novel, setNovel] = useState<Novel | null>(null);
  const [worldSettings, setWorldSettings] = useState<WorldSetting[]>([]);
  const [ruleSystems, setRuleSystems] = useState<RuleSystem[]>([]);
  const [protagonist, setProtagonist] = useState<Protagonist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!novelId) return;
    setLoading(true);
    setError('');
    try {
      // 分阶段加载：先加载核心数据，再加载次要数据
      const n = await novelService.getNovelById(novelId);
      if (!n) { setError('作品未找到'); setLoading(false); return; }
      setNovel(n);
      setLoading(false); // 核心数据完成，立即渲染

      // 次要数据独立加载，失败不阻塞页面
      Promise.all([
        settingRepository.getWorldSettings(novelId),
        settingRepository.getRuleSystems(novelId),
        protagonistRepository.getByNovelId(novelId),
      ]).then(([ws, rs, p]) => {
        setWorldSettings(ws);
        setRuleSystems(rs);
        setProtagonist(p);
      }).catch((e) => {
        console.error('次要数据加载失败:', e);
      });
    } catch (e) {
      setError('加载作品失败，请返回首页重试');
      console.error(e);
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveBasicInfo = async (data: {
    title: string; subtitle: string; genre: string;
    description: string; status: string; targetWordCount: number;
  }) => {
    if (!novelId) return;
    const updated = await novelService.updateNovel(novelId, {
      title: data.title, subtitle: data.subtitle, genre: data.genre,
      description: data.description, status: data.status as Novel['status'],
      targetWordCount: data.targetWordCount,
    });
    if (updated) setNovel(updated);
  };

  const handleSaveWorldSetting = async (id: string | null, data: { title: string; content: string }) => {
    if (!novelId) return;
    const result = await settingRepository.saveWorldSetting(id, {
      novelId, title: data.title, content: data.content,
    });
    setWorldSettings((prev) => {
      const idx = prev.findIndex((s) => s.id === result.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = result; return next; }
      return [...prev, result];
    });
  };

  const handleSaveRuleSystem = async (
    id: string | null,
    data: { title: string; category?: string; content: string; forbiddenRules?: string },
  ) => {
    if (!novelId) return;
    const result = await settingRepository.saveRuleSystem(id, {
      novelId, title: data.title,
      category: data.category as RuleSystem['category'],
      content: data.content, forbiddenRules: data.forbiddenRules,
    });
    setRuleSystems((prev) => {
      const idx = prev.findIndex((r) => r.id === result.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = result; return next; }
      return [...prev, result];
    });
  };

  const handleDeleteRuleSystem = async (id: string) => {
    await settingRepository.deleteRuleSystem(id);
    setRuleSystems((prev) => prev.filter((r) => r.id !== id));
  };

  if (loading) {
    return (
      <div className="novel-detail-page">
        <div className="flex-center" style={{ height: '100%' }}>
          <span className="text-secondary">加载中...</span>
        </div>
      </div>
    );
  }

  if (error || !novel) {
    return (
      <div className="novel-detail-page">
        <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: 16 }}>
          <span style={{ fontSize: 48, opacity: 0.3 }}>📖</span>
          <span className="text-secondary">{error || '作品未找到'}</span>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>返回首页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="novel-detail-page" data-project-id={novel.id} data-project-name={novel.title}>
      <div className="detail-header">
        <div className="detail-cover">📖</div>
        <div className="detail-info">
          <div className="detail-title">{novel.title}</div>
          <span className="detail-genre">{novel.genre || '未分类'}</span>
          <div className="detail-desc">{novel.description || '暂无简介'}</div>
          <div className="detail-progress">
            <div className="detail-progress-item">
              <div className="detail-progress-value">{formatNumber(novel.totalWordCount)}</div>
              <div className="detail-progress-label">总字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">{formatNumber(novel.targetWordCount || 0)}</div>
              <div className="detail-progress-label">目标字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">{statusLabels[novel.status] || novel.status}</div>
              <div className="detail-progress-label">状态</div>
            </div>
          </div>
          <div className="detail-actions">
            <button className="btn btn-primary" onClick={() => navigate(`/novels/${novel.id}/workspace`)}>
              ✏️ 进入写作工作台
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(`/novels/${novel.id}/setting-suggestions`)}>
              设定库 AI 推演
            </button>
          </div>
        </div>
      </div>

      <div className="detail-cards-grid">
        <NovelBasicInfoCard novel={novel} onSave={handleSaveBasicInfo} />
        <WorldSettingCard novelId={novel.id} settings={worldSettings} onSave={handleSaveWorldSetting} />
        <div style={{ gridColumn: '1 / -1' }}>
          <RuleSystemCard novelId={novel.id} ruleSystems={ruleSystems}
            onSave={handleSaveRuleSystem} onDelete={handleDeleteRuleSystem} />
        </div>
        <ProtagonistCard
          novelId={novel.id}
          novel={novel}
          protagonist={protagonist}
          onSave={async (data) => {
            if (!novelId) return;
            try {
              const updated = await novelService.updateNovelProtagonists(novelId, {
                protagonistMode: data.protagonistMode,
                protagonists: data.protagonists,
                dualProtagonistRelation: data.dualProtagonistRelation,
              });
              if (updated) setNovel(updated);
            } catch (e: any) {
              alert('保存失败：' + (e?.message || '未知错误'));
              throw e; // 重新抛出让卡片组件显示错误
            }
          }}
        />
        <div style={{ gridColumn: '1 / -1' }}>
          <OutlineManager novelId={novel.id} />
        </div>
        <CharacterLibraryCard novelId={novel.id} />
        <ContextOverviewCard novelId={novel.id} />
        <div style={{ gridColumn: '1 / -1' }}>
          <ExportCard novelId={novel.id} novelTitle={novel.title} />
        </div>
      </div>
    </div>
  );
}

export default NovelDetailPage;
