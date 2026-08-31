import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  Ellipsis,
  Library,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { Novel } from '../../types/novel';
import type { TaskConversation } from '../../types/conversation';
import { statusLabel } from './workbenchHelpers';

interface WorkbenchNavigationProps {
  novels: Novel[];
  conversations: TaskConversation[];
  selectedNovelId: string;
  selectedConversationId: string;
  runningConversationIds: Set<string>;
  projectsLoading: boolean;
  conversationsLoading: boolean;
  projectsError: string;
  conversationsError: string;
  creatingTask: boolean;
  onCreateTask: () => void;
  onSelectProject: (novelId: string) => void;
  onSelectTask: (novelId: string, conversationId: string) => void;
  onRenameTask: (conversationId: string, title: string) => Promise<void>;
  onSetTaskArchived: (conversationId: string, archived: boolean) => Promise<void>;
  onRetryProjects: () => void;
  onRetryConversations: () => void;
  onOpenLibrary: () => void;
}

function NavigationSkeleton() {
  return (
    <div
      className="workbench-tree-skeleton"
      data-testid="workbench-tree-loading"
      role="status"
      aria-label="正在读取小说项目"
    >
      <span className="workbench-skeleton-line is-project" />
      <span className="workbench-skeleton-line is-task" />
      <span className="workbench-skeleton-line is-task is-short" />
    </div>
  );
}

function formatRecentActivity(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return '刚刚';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function WorkbenchNavigation({
  novels,
  conversations,
  selectedNovelId,
  selectedConversationId,
  runningConversationIds,
  projectsLoading,
  conversationsLoading,
  projectsError,
  conversationsError,
  creatingTask,
  onCreateTask,
  onSelectProject,
  onSelectTask,
  onRenameTask,
  onSetTaskArchived,
  onRetryProjects,
  onRetryConversations,
  onOpenLibrary,
}: WorkbenchNavigationProps) {
  const [query, setQuery] = useState('');
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>('active');
  const [openMenuId, setOpenMenuId] = useState('');
  const [renamingId, setRenamingId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const [busyTaskId, setBusyTaskId] = useState('');
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleConversations = useMemo(
    () =>
      conversations.filter((conversation) => {
        const archived = Boolean(conversation.archivedAt || conversation.status === 'archived');
        if ((archiveView === 'archived') !== archived) return false;
        if (!normalizedQuery) return true;
        const novelTitle = novels.find((novel) => novel.id === conversation.novelId)?.title ?? '';
        return `${conversation.title} ${novelTitle}`.toLocaleLowerCase().includes(normalizedQuery);
      }),
    [archiveView, conversations, normalizedQuery, novels],
  );

  const openMenuConversation = useMemo(
    () => conversations.find((conversation) => conversation.conversationId === openMenuId),
    [conversations, openMenuId],
  );

  useEffect(() => {
    if (!openMenuId) return;
    const getMenuItems = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
          [],
      );
    const closeMenu = (restoreFocus = false) => {
      const trigger = menuTriggerRef.current;
      setOpenMenuId('');
      if (restoreFocus) window.setTimeout(() => trigger?.focus(), 0);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      const items = getMenuItems();
      if (items.length === 0) return;
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      let nextIndex: number | null = null;
      if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
      if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = items.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      items[nextIndex]?.focus();
    };
    const handleResize = () => closeMenu(true);
    const focusTimer = window.setTimeout(() => getMenuItems()[0]?.focus(), 0);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [openMenuId]);

  const submitRename = async (conversationId: string) => {
    const title = renameDraft.trim();
    if (!title || busyTaskId) return;
    setBusyTaskId(conversationId);
    try {
      await onRenameTask(conversationId, title);
      setRenamingId('');
      setRenameDraft('');
    } catch {
      // The workbench hook exposes the actionable error beside the task tree.
    } finally {
      setBusyTaskId('');
    }
  };

  const updateArchived = async (conversationId: string, archived: boolean) => {
    if (busyTaskId) return;
    setBusyTaskId(conversationId);
    try {
      await onSetTaskArchived(conversationId, archived);
      setOpenMenuId('');
    } catch {
      // Keep the menu open so the user can stop a running task or retry.
    } finally {
      setBusyTaskId('');
    }
  };

  return (
    <aside className="workbench-tree" aria-label="小说项目与创作任务">
      <div className="workbench-tree-header">
        <div>
          <div className="workbench-eyebrow">创作工作台</div>
          <h1>创作任务</h1>
        </div>
        <button
          type="button"
          className="workbench-new-task"
          data-testid="workbench-create-task"
          aria-label="新建创作任务"
          aria-busy={creatingTask}
          title="新建创作任务"
          disabled={projectsLoading || conversationsLoading || creatingTask || novels.length === 0}
          onClick={onCreateTask}
        >
          <Plus aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>

      <div className="workbench-tree-tools">
        <label className="workbench-task-search">
          <Search aria-hidden="true" size={14} strokeWidth={1.8} />
          <input
            type="search"
            aria-label="搜索创作任务"
            value={query}
            placeholder="搜索任务"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="workbench-archive-switch" aria-label="任务范围">
          <button
            type="button"
            className={archiveView === 'active' ? 'is-active' : ''}
            aria-pressed={archiveView === 'active'}
            onClick={() => setArchiveView('active')}
          >
            当前
          </button>
          <button
            type="button"
            className={archiveView === 'archived' ? 'is-active' : ''}
            aria-pressed={archiveView === 'archived'}
            onClick={() => setArchiveView('archived')}
          >
            归档
          </button>
        </div>
      </div>

      <div className="workbench-tree-scroll" onScroll={() => setOpenMenuId('')}>
        {projectsLoading ? (
          <NavigationSkeleton />
        ) : projectsError ? (
          <div className="workbench-tree-feedback is-error" role="alert">
            <span>{projectsError}</span>
            <button type="button" onClick={onRetryProjects}>
              重试
            </button>
          </div>
        ) : novels.length === 0 ? (
          <div className="workbench-tree-feedback">暂无小说项目</div>
        ) : (
          novels.map((novel) => {
            const novelConversations = visibleConversations.filter(
              (conversation) => conversation.novelId === novel.id,
            );
            if (normalizedQuery && novelConversations.length === 0) return null;
            return (
              <section className="workbench-project" key={novel.id}>
                <button
                  type="button"
                  className={`workbench-project-row ${selectedNovelId === novel.id ? 'is-active' : ''}`}
                  data-testid="workbench-project"
                  data-novel-id={novel.id}
                  data-selected={selectedNovelId === novel.id ? 'true' : 'false'}
                  title={novel.title}
                  onClick={() => onSelectProject(novel.id)}
                >
                  <span className="workbench-project-mark" aria-hidden="true">
                    {novel.title.slice(0, 1) || '书'}
                  </span>
                  <span className="workbench-project-title">{novel.title}</span>
                  <span
                    className="workbench-project-count"
                    aria-label={`${novelConversations.length}个任务`}
                  >
                    {novelConversations.length}
                  </span>
                </button>
                {novelConversations.map((conversation) => {
                  const running = runningConversationIds.has(conversation.conversationId);
                  const archived = Boolean(
                    conversation.archivedAt || conversation.status === 'archived',
                  );
                  const displayStatus = archived
                    ? 'archived'
                    : running
                      ? 'running'
                      : conversation.status;
                  const isBusy = busyTaskId === conversation.conversationId;
                  return (
                    <div className="workbench-task-entry" key={conversation.conversationId}>
                      {renamingId === conversation.conversationId ? (
                        <div className="workbench-task-rename">
                          <input
                            autoFocus
                            value={renameDraft}
                            aria-label="任务标题"
                            maxLength={160}
                            disabled={isBusy}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter')
                                void submitRename(conversation.conversationId);
                              if (event.key === 'Escape') setRenamingId('');
                            }}
                          />
                          <button
                            type="button"
                            aria-label="保存任务标题"
                            title="保存"
                            disabled={!renameDraft.trim() || isBusy}
                            onClick={() => void submitRename(conversation.conversationId)}
                          >
                            <Check aria-hidden="true" size={14} strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            aria-label="取消重命名"
                            title="取消"
                            disabled={isBusy}
                            onClick={() => setRenamingId('')}
                          >
                            <X aria-hidden="true" size={14} strokeWidth={1.8} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`workbench-task-row ${selectedConversationId === conversation.conversationId ? 'is-active' : ''}`}
                            data-testid="workbench-task"
                            data-conversation-id={conversation.conversationId}
                            data-status={displayStatus}
                            data-selected={
                              selectedConversationId === conversation.conversationId
                                ? 'true'
                                : 'false'
                            }
                            title={`${conversation.title} · ${statusLabel(displayStatus)}`}
                            onClick={() => onSelectTask(novel.id, conversation.conversationId)}
                          >
                            <span
                              className={`workbench-status-dot is-${displayStatus}`}
                              aria-hidden="true"
                            />
                            <span className="workbench-task-copy">
                              <span className="workbench-task-title">{conversation.title}</span>
                              <time dateTime={conversation.updatedAt}>
                                {formatRecentActivity(conversation.updatedAt)}
                              </time>
                            </span>
                            <span className="workbench-task-status">
                              {statusLabel(displayStatus)}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="workbench-task-menu-trigger"
                            aria-label={`${conversation.title}的更多操作`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === conversation.conversationId}
                            title="更多操作"
                            ref={
                              openMenuId === conversation.conversationId
                                ? menuTriggerRef
                                : undefined
                            }
                            onClick={(event) => {
                              if (openMenuId === conversation.conversationId) {
                                setOpenMenuId('');
                                return;
                              }
                              const rect = event.currentTarget.getBoundingClientRect();
                              const menuWidth = 148;
                              const menuHeight = archived ? 44 : 78;
                              setMenuPosition({
                                top:
                                  window.innerHeight - rect.bottom >= menuHeight + 8
                                    ? rect.bottom + 4
                                    : Math.max(8, rect.top - menuHeight - 4),
                                left: Math.min(
                                  window.innerWidth - menuWidth - 8,
                                  Math.max(8, rect.right - menuWidth),
                                ),
                              });
                              setOpenMenuId(conversation.conversationId);
                            }}
                          >
                            <Ellipsis aria-hidden="true" size={16} strokeWidth={1.8} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {conversationsLoading && novel.id === selectedNovelId && (
                  <span className="workbench-task-loading" role="status">
                    正在恢复任务…
                  </span>
                )}
              </section>
            );
          })
        )}

        {!projectsLoading &&
          !projectsError &&
          novels.length > 0 &&
          visibleConversations.length === 0 && (
            <div className="workbench-tree-feedback">
              {normalizedQuery
                ? '没有匹配的任务'
                : archiveView === 'archived'
                  ? '暂无归档任务'
                  : '暂无创作任务'}
            </div>
          )}

        {!projectsLoading && !projectsError && conversationsError && (
          <div className="workbench-tree-feedback is-error" role="alert">
            <span>{conversationsError}</span>
            <button type="button" onClick={onRetryConversations}>
              重试任务
            </button>
          </div>
        )}
      </div>

      <button type="button" className="workbench-library-link" onClick={onOpenLibrary}>
        <Library aria-hidden="true" size={14} strokeWidth={1.8} />
        <span>管理小说作品</span>
        <ArrowUpRight aria-hidden="true" size={13} strokeWidth={1.8} />
      </button>
      {openMenuConversation &&
        createPortal(
          <div
            ref={menuRef}
            className="workbench-task-menu"
            role="menu"
            aria-label={`${openMenuConversation.title}的任务操作`}
            style={menuPosition}
          >
            {!openMenuConversation.archivedAt && openMenuConversation.status !== 'archived' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenameDraft(openMenuConversation.title);
                  setRenamingId(openMenuConversation.conversationId);
                  setOpenMenuId('');
                }}
              >
                <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>重命名</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={
                busyTaskId === openMenuConversation.conversationId ||
                runningConversationIds.has(openMenuConversation.conversationId)
              }
              title={
                runningConversationIds.has(openMenuConversation.conversationId)
                  ? '请先停止运行中的任务'
                  : undefined
              }
              onClick={() =>
                void updateArchived(
                  openMenuConversation.conversationId,
                  !(openMenuConversation.archivedAt || openMenuConversation.status === 'archived'),
                )
              }
            >
              {openMenuConversation.archivedAt || openMenuConversation.status === 'archived' ? (
                <ArchiveRestore aria-hidden="true" size={14} strokeWidth={1.8} />
              ) : (
                <Archive aria-hidden="true" size={14} strokeWidth={1.8} />
              )}
              <span>
                {openMenuConversation.archivedAt || openMenuConversation.status === 'archived'
                  ? '恢复任务'
                  : '归档任务'}
              </span>
            </button>
          </div>,
          document.body,
        )}
    </aside>
  );
}
