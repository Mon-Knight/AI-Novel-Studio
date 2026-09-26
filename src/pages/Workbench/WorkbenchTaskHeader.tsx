import {
  Database,
  FileText,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Puzzle,
} from 'lucide-react';
import type { WorkbenchSidePanelView } from './hooks/useWorkbenchSidePanel';
import type { Chapter } from '../../types/chapter';
import type { TaskConversation } from '../../types/conversation';
import { statusLabel } from './workbenchHelpers';
import { ChapterLocator } from '../../components/workspace/ChapterLocator';

interface WorkbenchTaskHeaderProps {
  novelTitle: string;
  conversation: TaskConversation;
  chapters: Chapter[];
  chapterId?: string;
  hasChapter: boolean;
  chaptersLoading: boolean;
  chaptersError: string;
  effectiveStatus: string;
  compressionBusy: boolean;
  bundleReady: boolean;
  onSelectChapter: (chapterId: string) => void;
  onCreateChapter: () => void;
  onCompress: () => void;
  onShowPlugins: () => void;
  sidePanelOpen?: boolean;
  sidePanelView?: WorkbenchSidePanelView | null;
  onToggleSidePanel?: () => void;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  onOpenContext?: () => void;
  onOpenArtifacts?: () => void;
}

export function WorkbenchTaskHeader({
  novelTitle,
  conversation,
  chapters,
  chapterId,
  hasChapter,
  chaptersLoading,
  chaptersError,
  effectiveStatus,
  compressionBusy,
  bundleReady,
  onSelectChapter,
  onCreateChapter,
  onCompress,
  onShowPlugins,
  sidePanelOpen = false,
  sidePanelView = null,
  onToggleSidePanel,
  focusMode = false,
  onToggleFocus,
  onOpenContext,
  onOpenArtifacts,
}: WorkbenchTaskHeaderProps) {
  return (
    <header
      className="workbench-task-header"
      data-testid="workbench-task-header"
      data-conversation-id={conversation.conversationId}
    >
      <div className="workbench-task-header-inner">
        <div className="workbench-task-heading">
          <div className="workbench-task-title-block">
            <div className="workbench-eyebrow">{novelTitle}</div>
            <h2 title={conversation.title}>{conversation.title}</h2>
          </div>
          <div className="workbench-chapter-target" data-testid="workbench-chapter-target">
            <label htmlFor="workbench-chapter-select">目标章节</label>
            {chaptersLoading ? (
              <span className="workbench-chapter-hint">正在读取章节…</span>
            ) : chapters.length === 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-create-chapter"
                onClick={onCreateChapter}
              >
                去创建章节
              </button>
            ) : (
              <ChapterLocator
                key={conversation.conversationId}
                chapters={chapters}
                activeChapterId={chapterId}
                onSelectChapter={onSelectChapter}
                selectId="workbench-chapter-select"
                selectTestId="workbench-chapter-select"
              />
            )}
            {chaptersError ? (
              <span className="workbench-chapter-hint is-error">{chaptersError}</span>
            ) : (
              !chaptersLoading &&
              !hasChapter && (
                <span className="workbench-chapter-hint">未绑定章节，正文任务暂不可用</span>
              )
            )}
          </div>
        </div>

        <div className="workbench-task-header-actions">
          <span
            className={'workbench-run-badge is-' + effectiveStatus}
            data-testid="workbench-conversation-status"
            data-status={effectiveStatus}
          >
            {statusLabel(effectiveStatus)}
          </span>
          <button
            type="button"
            className="workbench-header-icon-button"
            data-testid="workbench-compress-context"
            aria-label="压缩小说上下文"
            title="压缩小说上下文"
            disabled={compressionBusy || !bundleReady}
            onClick={onCompress}
          >
            <Minimize2 aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
          {onOpenContext && (
            <button
              type="button"
              className={
                'workbench-header-icon-button' + (sidePanelView === 'context' ? ' is-active' : '')
              }
              data-testid="workbench-open-context"
              aria-label="查看创作上下文"
              aria-pressed={sidePanelView === 'context'}
              aria-controls="workbench-side-panel"
              title="查看创作上下文"
              onClick={onOpenContext}
            >
              <Database aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          )}
          {onOpenArtifacts && (
            <button
              type="button"
              className={
                'workbench-header-icon-button' + (sidePanelView === 'artifacts' ? ' is-active' : '')
              }
              data-testid="workbench-open-artifacts"
              aria-label="查看本任务产物"
              aria-pressed={sidePanelView === 'artifacts'}
              aria-controls="workbench-side-panel"
              title="查看本任务产物"
              onClick={onOpenArtifacts}
            >
              <FileText aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          )}
          <button
            type="button"
            className={
              'workbench-header-icon-button' + (sidePanelView === 'plugins' ? ' is-active' : '')
            }
            data-testid="workbench-current-plugins"
            aria-label="查看当前插件"
            aria-pressed={sidePanelView === 'plugins'}
            aria-controls="workbench-side-panel"
            title="查看当前插件"
            onClick={onShowPlugins}
          >
            <Puzzle aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
          {onToggleSidePanel && (
            <button
              type="button"
              className={
                'workbench-header-icon-button' + (sidePanelView === 'launcher' ? ' is-active' : '')
              }
              data-testid="workbench-toggle-side-panel"
              aria-label={sidePanelOpen ? '关闭辅助面板菜单' : '打开辅助面板菜单'}
              aria-pressed={sidePanelView === 'launcher'}
              aria-expanded={sidePanelOpen}
              aria-controls="workbench-side-panel"
              title={sidePanelOpen ? '关闭辅助面板菜单' : '打开辅助面板菜单'}
              onClick={onToggleSidePanel}
            >
              <PanelRight aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          )}
          {onToggleFocus && (
            <button
              type="button"
              className={'workbench-header-icon-button' + (focusMode ? ' is-active' : '')}
              data-testid="workbench-toggle-focus"
              aria-label={focusMode ? '退出专注并显示项目树' : '进入专注并隐藏项目树'}
              aria-pressed={focusMode}
              title={focusMode ? '退出专注并显示项目树' : '进入专注并隐藏项目树'}
              onClick={onToggleFocus}
            >
              {focusMode ? (
                <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={1.8} />
              ) : (
                <PanelLeftClose aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
