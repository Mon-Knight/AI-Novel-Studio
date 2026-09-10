import {
  ArrowLeft,
  BookOpenText,
  Bot,
  Database,
  FileText,
  ListChecks,
  PenLine,
  Puzzle,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import type { WorkbenchAssetScopeSummary } from '../../services/conversation/workbenchAssetScopeService';
import type { TaskConversationBundle } from '../../types/conversation';
import type { WorkbenchSidePanelView } from './hooks/useWorkbenchSidePanel';
import { WorkbenchAssetScopePanel } from './WorkbenchAssetScopePanel';
import { PluginPanel } from './WorkbenchPluginPanel';
import { WorkbenchArtifactIndex, WorkbenchRunLog } from './WorkbenchSidePanelViews';

export type { WorkbenchSidePanelView } from './hooks/useWorkbenchSidePanel';

interface WorkbenchSidePanelProps {
  view: WorkbenchSidePanelView;
  novelId: string;
  chapterId?: string;
  bundle: TaskConversationBundle | null;
  plugins: CurrentPluginProjection[];
  pluginsLoading: boolean;
  pluginsError: string;
  assetScope: WorkbenchAssetScopeSummary | null;
  assetScopeLoading: boolean;
  assetScopeError: string;
  onRefreshAssetScope: () => void;
  onOpenAssetScopePath: (path: string) => void;
  onOpen: (view: WorkbenchSidePanelView) => void;
  onBack: () => void;
  onClose: () => void;
}

interface LauncherCard {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  action: () => void;
}

const VIEW_TITLES: Record<Exclude<WorkbenchSidePanelView, 'launcher' | 'plugins'>, string> = {
  context: '创作上下文',
  artifacts: '本任务产物',
  events: '运行日志',
};

/** ZCode-style side panel: a launcher of tabs; each tab opens in place with back/close. */
export function WorkbenchSidePanel({
  view,
  novelId,
  chapterId,
  bundle,
  plugins,
  pluginsLoading,
  pluginsError,
  assetScope,
  assetScopeLoading,
  assetScopeError,
  onRefreshAssetScope,
  onOpenAssetScopePath,
  onOpen,
  onBack,
  onClose,
}: WorkbenchSidePanelProps) {
  const navigate = useNavigate();
  const projectPath = novelId ? `/novels/${encodeURIComponent(novelId)}` : '/novels';
  const artifactCount = bundle?.artifacts.length ?? 0;
  const runCount = bundle?.runs.length ?? 0;
  const cards: LauncherCard[] = [
    {
      key: 'context',
      label: '创作上下文',
      description: assetScope
        ? assetScope.requiredMissingCount > 0
          ? `${assetScope.requiredMissingCount} 项核心资产待准备`
          : '世界、规则、主角与大纲已就绪'
        : '生成前会用到的作品资产与就绪状态',
      icon: Database,
      action: () => onOpen('context'),
    },
    {
      key: 'artifacts',
      label: '本任务产物',
      description: artifactCount > 0 ? `${artifactCount} 张产物卡，点击定位到对话` : '尚无产物',
      icon: FileText,
      action: () => onOpen('artifacts'),
    },
    {
      key: 'events',
      label: '运行日志',
      description: runCount > 0 ? `${runCount} 次运行的模型、工具调用与耗时` : '尚无运行',
      icon: ListChecks,
      action: () => onOpen('events'),
    },
    {
      key: 'plugins',
      label: '当前插件',
      description: 'Runtime Registry 实际加载的功能、模型与插件',
      icon: Puzzle,
      action: () => onOpen('plugins'),
    },
    {
      key: 'review',
      label: '章节审阅',
      description: chapterId ? '在写作工作台审阅、编辑并采用当前章节' : '打开写作工作台的卷章树',
      icon: PenLine,
      action: () =>
        navigate(
          chapterId
            ? `${projectPath}/workspace?chapterId=${encodeURIComponent(chapterId)}`
            : `${projectPath}/workspace`,
        ),
    },
    {
      key: 'project',
      label: '作品概览',
      description: '世界观、规则、角色与大纲等项目资产',
      icon: BookOpenText,
      action: () => navigate(projectPath),
    },
    {
      key: 'tasks',
      label: 'AI 任务记录',
      description: '查看历史请求、状态与成本追踪',
      icon: Bot,
      action: () => navigate('/ai-tasks'),
    },
  ];

  return (
    <aside
      className="workbench-side-panel"
      data-testid="workbench-side-panel"
      data-view={view}
      aria-label="侧边面板"
    >
      {view === 'plugins' ? (
        <PanelErrorBoundary panelTitle="当前插件">
          <PluginPanel
            plugins={plugins}
            loading={pluginsLoading}
            error={pluginsError}
            onClose={onClose}
          />
        </PanelErrorBoundary>
      ) : view === 'launcher' ? (
        <div className="workbench-side-launcher">
          <div className="workbench-side-launcher-header">
            <div>
              <h2>打开标签页</h2>
              <p>选择要在侧边面板中打开的标签。</p>
            </div>
            <button
              type="button"
              className="workbench-icon-button"
              data-testid="workbench-side-close"
              aria-label="关闭侧边面板"
              title="关闭侧边面板"
              onClick={onClose}
            >
              <X aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </div>
          <div className="workbench-side-launcher-list">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  type="button"
                  key={card.key}
                  className="workbench-side-launcher-card"
                  data-testid={`workbench-side-open-${card.key}`}
                  onClick={card.action}
                >
                  <span className="workbench-side-launcher-icon" aria-hidden="true">
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  <span className="workbench-side-launcher-copy">
                    <span className="workbench-side-launcher-label">{card.label}</span>
                    <span className="workbench-side-launcher-description">{card.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="workbench-side-view">
          <div className="workbench-side-view-header">
            <button
              type="button"
              className="workbench-icon-button"
              data-testid="workbench-side-back"
              aria-label="返回标签列表"
              title="返回标签列表"
              onClick={onBack}
            >
              <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
            <h2>{VIEW_TITLES[view]}</h2>
            <button
              type="button"
              className="workbench-icon-button"
              data-testid="workbench-side-close"
              aria-label="关闭侧边面板"
              title="关闭侧边面板"
              onClick={onClose}
            >
              <X aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </div>
          <div className="workbench-side-view-body">
            <PanelErrorBoundary panelTitle={VIEW_TITLES[view]}>
              {view === 'context' ? (
                <WorkbenchAssetScopePanel
                  id="workbench-side-asset-scope"
                  summary={assetScope}
                  loading={assetScopeLoading}
                  error={assetScopeError}
                  onRefresh={onRefreshAssetScope}
                  onOpen={onOpenAssetScopePath}
                />
              ) : !bundle ? (
                <p className="workbench-side-empty">任务恢复完成后即可查看。</p>
              ) : view === 'artifacts' ? (
                <WorkbenchArtifactIndex bundle={bundle} />
              ) : (
                <WorkbenchRunLog bundle={bundle} />
              )}
            </PanelErrorBoundary>
          </div>
        </div>
      )}
    </aside>
  );
}
