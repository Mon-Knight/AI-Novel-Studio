import { Bot, Library, Plus, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveNovelId, type WorkbenchIntentState } from './shellNavigation';

interface SidebarQuickActionsProps {
  /** The workbench owns the real task creator; other routes hand over an intent. */
  onNewTask?: () => void;
  onSearch?: () => void;
  newTaskDisabled?: boolean;
  newTaskBusy?: boolean;
}

export function SidebarQuickActions({
  onNewTask,
  onSearch,
  newTaskDisabled = false,
  newTaskBusy = false,
}: SidebarQuickActionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const novelId = resolveNovelId(location.pathname);
  const handOff = (workbenchIntent: WorkbenchIntentState['workbenchIntent']) =>
    navigate('/', { state: { workbenchIntent } satisfies WorkbenchIntentState });

  return (
    <div className="shell-quick-actions" role="group" aria-label="快捷操作">
      <button
        type="button"
        className="shell-quick-action"
        data-testid={onNewTask ? 'workbench-create-task' : 'shell-new-task'}
        aria-label="新建创作任务"
        aria-busy={newTaskBusy}
        title="新建创作任务 (Ctrl+N)"
        disabled={newTaskDisabled}
        onClick={onNewTask ?? (() => handOff('new-task'))}
      >
        <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
        <span className="shell-quick-action-label">新建任务</span>
        <kbd className="shell-kbd">Ctrl+N</kbd>
      </button>
      <button
        type="button"
        className="shell-quick-action"
        aria-label="搜索创作任务"
        title="搜索创作任务 (Ctrl+K)"
        onClick={onSearch ?? (() => handOff('search'))}
      >
        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
        <span className="shell-quick-action-label">搜索</span>
        <kbd className="shell-kbd">Ctrl+K</kbd>
      </button>
      <button
        type="button"
        className="shell-quick-action"
        title={novelId ? '打开当前作品的自主创作规划' : '选择作品后进入自主创作规划'}
        onClick={() =>
          navigate(
            novelId ? `/novels/${encodeURIComponent(novelId)}/autonomous-planning` : '/novels',
          )
        }
      >
        <Bot aria-hidden="true" size={16} strokeWidth={1.8} />
        <span className="shell-quick-action-label">自主创作</span>
      </button>
      <button
        type="button"
        className="shell-quick-action"
        title="管理小说作品"
        onClick={() => navigate('/novels')}
      >
        <Library aria-hidden="true" size={16} strokeWidth={1.8} />
        <span className="shell-quick-action-label">项目库</span>
      </button>
    </div>
  );
}
