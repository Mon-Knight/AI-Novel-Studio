import { Minimize2, Puzzle } from 'lucide-react';
import type { Chapter } from '../../types/chapter';
import type { TaskConversation } from '../../types/conversation';
import { statusLabel } from './workbenchHelpers';

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
              <select
                id="workbench-chapter-select"
                data-testid="workbench-chapter-select"
                value={chapterId ?? ''}
                onChange={(event) => onSelectChapter(event.target.value)}
              >
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title || '未命名章节'}
                  </option>
                ))}
              </select>
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
          <button
            type="button"
            className="workbench-header-icon-button"
            data-testid="workbench-current-plugins"
            aria-label="查看当前插件"
            title="查看当前插件"
            onClick={onShowPlugins}
          >
            <Puzzle aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}
