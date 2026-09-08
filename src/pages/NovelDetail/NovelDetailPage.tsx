import { appLogger } from '../../services/observability/appLogger';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, BookOpenText, PenLine } from 'lucide-react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import type { Novel } from '../../types/novel';
import type { WorldSetting, RuleSystem, RuleCategory } from '../../types/setting';
import type { Protagonist } from '../../types/protagonist';
import { formatNumber } from '../../utils/format';
import { describeUnknownError } from '../../utils/errorMessage';
import { showError } from '../../utils/nativeDialog';
import '../../styles/novel-detail.css';

const statusLabels: Record<string, string> = {
  draft: '草稿',
  planning: '规划中',
  writing: '创作中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

const CORE_ASSET_FOCUS_TARGETS: Record<string, string> = {
  world_setting: 'novel-detail-world-setting',
  rule_system: 'novel-detail-rule-system',
  protagonist: 'novel-detail-protagonist',
  story_plan: 'novel-detail-outline',
  chapter_outline: 'novel-detail-outline',
};

function NovelDetailPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusedRequestRef = useRef('');

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
      const n = await novelService.getNovelById(novelId);
      if (!n) {
        setError('作品未找到');
        setLoading(false);
        return;
      }
      setNovel(n);
      setLoading(false);

      Promise.all([
        settingRepository.getWorldSettings(novelId),
        settingRepository.getRuleSystems(novelId),
        protagonistRepository.getByNovelId(novelId),
      ])
        .then(([ws, rs, p]) => {
          setWorldSettings(ws);
          setRuleSystems(rs);
          setProtagonist(p);
        })
        .catch((e) => {
          appLogger.error('次要数据加载失败:', e);
        });
    } catch (e) {
      setError('加载作品失败，请返回首页重试');
      appLogger.error(e);
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const focus = searchParams.get('focus') ?? '';
  const focusTargetId = CORE_ASSET_FOCUS_TARGETS[focus];
  const returnToWorkbench = searchParams.get('returnTo') === 'workbench';

  useEffect(() => {
    if (loading || !novel || !focusTargetId) return;
    const requestKey = `${novel.id}:${focusTargetId}`;
    if (focusedRequestRef.current === requestKey) return;
    focusedRequestRef.current = requestKey;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(focusTargetId);
      if (!target) return;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTargetId, loading, novel]);

  const handleSaveBasicInfo = async (data: {
    title: string;
    subtitle: string;
    genre: string;
    description: string;
    status: string;
    targetWordCount: number;
  }) => {
    if (!novelId) return;
    try {
      const updated = await novelService.updateNovel(novelId, {
        title: data.title,
        subtitle: data.subtitle,
        genre: data.genre,
        description: data.description,
        status: data.status as Novel['status'],
        targetWordCount: data.targetWordCount,
      });
      if (updated) setNovel(updated);
    } catch (e: unknown) {
      appLogger.captureError('NOVEL_DETAIL_SAVE_BASIC_FAILED', e, { novelId });
      await showError({
        title: '保存基本信息失败',
        message: describeUnknownError(e, '保存基本信息失败'),
      });
      throw e;
    }
  };

  const handleSaveWorldSetting = async (
    id: string | null,
    data: { title: string; content: string },
  ) => {
    if (!novelId) return;
    try {
      const result = await settingRepository.saveWorldSetting(id, {
        novelId,
        title: data.title,
        content: data.content,
      });
      setWorldSettings((prev) => {
        const idx = prev.findIndex((s) => s.id === result.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = result;
          return next;
        }
        return [result, ...prev];
      });
    } catch (e: unknown) {
      appLogger.captureError('NOVEL_DETAIL_SAVE_SETTING_FAILED', e, { novelId });
      await showError({
        title: '保存世界观设定失败',
        message: describeUnknownError(e, '保存世界观设定失败'),
      });
      throw e;
    }
  };

  const handleSaveRuleSystem = async (
    id: string | null,
    data: {
      title: string;
      category?: string;
      content: string;
      forbiddenRules?: string;
    },
  ) => {
    if (!novelId) return;
    try {
      const result = await settingRepository.saveRuleSystem(id, {
        novelId,
        title: data.title,
        category: data.category as RuleCategory | undefined,
        content: data.content,
        forbiddenRules: data.forbiddenRules,
      });
      setRuleSystems((prev) => {
        const idx = prev.findIndex((s) => s.id === result.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = result;
          return next;
        }
        return [result, ...prev];
      });
    } catch (e: unknown) {
      appLogger.captureError('NOVEL_DETAIL_SAVE_RULE_FAILED', e, { novelId });
      await showError({
        title: '保存法则体系失败',
        message: describeUnknownError(e, '保存法则体系失败'),
      });
      throw e;
    }
  };

  const handleDeleteRuleSystem = async (id: string) => {
    if (!novelId) return;
    try {
      await settingRepository.deleteRuleSystem(id);
      const reloaded = await settingRepository.getRuleSystems(novelId);
      setRuleSystems(reloaded);
    } catch (e: unknown) {
      appLogger.captureError('NOVEL_DETAIL_DELETE_RULE_FAILED', e, { novelId });
      await showError({
        title: '删除法则体系失败',
        message: describeUnknownError(e, '删除法则体系失败'),
      });
      throw e;
    }
  };

  if (loading && !novel) {
    return (
      <div className="novel-detail-page">
        <div
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}
        >
          <span className="text-secondary">正在载入作品详情...</span>
        </div>
      </div>
    );
  }

  if (error || !novel) {
    return (
      <div className="novel-detail-page">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: 40,
          }}
        >
          <span className="text-secondary">{error || '作品未找到'}</span>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="novel-detail-page" data-project-id={novel.id} data-project-name={novel.title}>
      {/* 紧凑详情头部 */}
      <div className="detail-header">
        <div className="detail-cover">
          <BookOpenText aria-hidden="true" size={32} strokeWidth={1.8} />
        </div>
        <div className="detail-info">
          <div className="detail-title-row">
            <div className="detail-title">{novel.title}</div>
            <span className="detail-genre">{novel.genre || '未分类'}</span>
          </div>
          <div className="detail-desc">{novel.description || '暂无作品简介'}</div>

          <div className="detail-progress">
            <div className="detail-progress-item">
              <div className="detail-progress-value">{formatNumber(novel.totalWordCount)}</div>
              <div className="detail-progress-label">总字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">
                {formatNumber(novel.targetWordCount || 0)}
              </div>
              <div className="detail-progress-label">目标字数</div>
            </div>
            <div className="detail-progress-item">
              <div className="detail-progress-value">
                {statusLabels[novel.status] || novel.status}
              </div>
              <div className="detail-progress-label">状态</div>
            </div>
          </div>

          <div className="detail-actions">
            {returnToWorkbench ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="novel-detail-return-workbench"
                onClick={() => navigate('/')}
              >
                <ArrowLeft aria-hidden="true" size={13} strokeWidth={1.8} />
                返回工作台
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="novel-detail-back-novels"
                onClick={() => navigate('/novels')}
              >
                <ArrowLeft aria-hidden="true" size={13} strokeWidth={1.8} />
                返回作品列表
              </button>
            )}
            {/* 设定推演 / 自主创作 / 参考资料等入口由项目标签条统一提供。 */}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/novels/${novel.id}/workspace`)}
            >
              <PenLine aria-hidden="true" size={13} strokeWidth={1.8} />
              进入写作工作台
            </button>
          </div>
        </div>
      </div>

      {/* 紧凑双列无缝网格（无冗余留白） */}
      <div className="detail-cards-grid">
        <PanelErrorBoundary panelTitle="作品基本信息">
          <NovelBasicInfoCard novel={novel} onSave={handleSaveBasicInfo} />
        </PanelErrorBoundary>

        <div
          id="novel-detail-protagonist"
          className={`detail-focus-target${focusTargetId === 'novel-detail-protagonist' ? ' is-focused' : ''}`}
          data-testid="novel-detail-protagonist"
          tabIndex={-1}
        >
          <PanelErrorBoundary panelTitle="主角设定">
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
                } catch (e: unknown) {
                  appLogger.captureError('NOVEL_PROTAGONIST_SAVE_FAILED', e, {
                    novelId: novel.id,
                  });
                  await showError({
                    title: '保存主角设定失败',
                    message: describeUnknownError(e, '保存主角设定失败'),
                  });
                  throw e;
                }
              }}
            />
          </PanelErrorBoundary>
        </div>

        <div
          id="novel-detail-world-setting"
          className={`detail-focus-target${focusTargetId === 'novel-detail-world-setting' ? ' is-focused' : ''}`}
          data-testid="novel-detail-world-setting"
          tabIndex={-1}
        >
          <PanelErrorBoundary panelTitle="世界观设定">
            <WorldSettingCard
              novelId={novel.id}
              settings={worldSettings}
              onSave={handleSaveWorldSetting}
            />
          </PanelErrorBoundary>
        </div>

        <div
          id="novel-detail-rule-system"
          className={`detail-focus-target${focusTargetId === 'novel-detail-rule-system' ? ' is-focused' : ''}`}
          data-testid="novel-detail-rule-system"
          tabIndex={-1}
        >
          <PanelErrorBoundary panelTitle="法则体系">
            <RuleSystemCard
              novelId={novel.id}
              ruleSystems={ruleSystems}
              onSave={handleSaveRuleSystem}
              onDelete={handleDeleteRuleSystem}
            />
          </PanelErrorBoundary>
        </div>

        <div
          id="novel-detail-outline"
          className={`detail-focus-target${focusTargetId === 'novel-detail-outline' ? ' is-focused' : ''}`}
          data-testid="novel-detail-outline"
          style={{ gridColumn: '1 / -1' }}
          tabIndex={-1}
        >
          <PanelErrorBoundary panelTitle="大纲管理">
            <OutlineManager novelId={novel.id} />
          </PanelErrorBoundary>
        </div>

        <PanelErrorBoundary panelTitle="角色库">
          <CharacterLibraryCard novelId={novel.id} />
        </PanelErrorBoundary>

        <PanelErrorBoundary panelTitle="上下文概览">
          <ContextOverviewCard novelId={novel.id} />
        </PanelErrorBoundary>

        <div style={{ gridColumn: '1 / -1' }}>
          <PanelErrorBoundary panelTitle="导出">
            <ExportCard novelId={novel.id} novelTitle={novel.title} />
          </PanelErrorBoundary>
        </div>
      </div>
    </div>
  );
}

export default NovelDetailPage;
