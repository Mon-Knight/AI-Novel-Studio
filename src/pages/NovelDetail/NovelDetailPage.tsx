import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { novelRepository } from '../../services/database/novelRepository';
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
import type { Novel } from '../../types/novel';
import type { WorldSetting, RuleSystem } from '../../types/setting';
import type { Protagonist } from '../../types/protagonist';
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
      const [n, ws, rs, p] = await Promise.all([
        novelRepository.getById(novelId),
        settingRepository.getWorldSettings(novelId),
        settingRepository.getRuleSystems(novelId),
        protagonistRepository.getByNovelId(novelId),
      ]);
      if (!n) { setError('作品未找到'); setLoading(false); return; }
      setNovel(n);
      setWorldSettings(ws);
      setRuleSystems(rs);
      setProtagonist(p);
    } catch (e) {
      setError('加载数据失败');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveBasicInfo = async (data: {
    title: string; subtitle: string; genre: string;
    description: string; status: string; targetWordCount: number;
  }) => {
    if (!novelId) return;
    const updated = await novelRepository.update(novelId, {
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

  const handleSaveProtagonist = async (
    id: string | null,
    data: {
      name: string; identity?: string; personality?: string;
      goal?: string; specialAbility?: string; abilityLimits?: string;
      forbiddenBehaviors?: string; currentState?: string;
    },
  ) => {
    if (!novelId) return;
    const result = await protagonistRepository.save(id, { novelId, ...data });
    setProtagonist(result);
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
    <div className="novel-detail-page">
      <div className="detail-header">
        <div className="detail-cover">📖</div>
        <div className="detail-info">
          <div className="detail-title">{novel.title}</div>
          <span className="detail-genre">{novel.genre || '未分类'}</span>
          <div className="detail-desc">{novel.description || '暂无简介'}</div>
          <div className="detail-progress">
            <div className="detail-progress-item">
              <div className="detail-progress-value">{novel.totalWordCount.toLocaleString()}</div>
              <div className="detail-progress-label">总字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">{(novel.targetWordCount || 0).toLocaleString()}</div>
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
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <NovelBasicInfoCard novel={novel} onSave={handleSaveBasicInfo} />
        <WorldSettingCard novelId={novel.id} settings={worldSettings} onSave={handleSaveWorldSetting} />
        <div style={{ gridColumn: '1 / -1' }}>
          <RuleSystemCard novelId={novel.id} ruleSystems={ruleSystems}
            onSave={handleSaveRuleSystem} onDelete={handleDeleteRuleSystem} />
        </div>
        <ProtagonistCard novelId={novel.id} protagonist={protagonist} onSave={handleSaveProtagonist} />
        <div style={{ gridColumn: '1 / -1' }}>
          <OutlineManager novelId={novel.id} />
        </div>
        <CharacterLibraryCard novelId={novel.id} />
      </div>
    </div>
  );
}

export default NovelDetailPage;
