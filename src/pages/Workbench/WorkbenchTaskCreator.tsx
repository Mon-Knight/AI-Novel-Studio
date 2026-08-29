import { useEffect, useRef } from 'react';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { Chapter } from '../../types/chapter';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import { getWorkbenchModelAvailability } from '../../services/conversation/workbenchModelAvailability';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { TaskTemplate } from './WorkbenchComposer';
import { isWorkbenchTaskTemplateEnabled } from './workbenchTaskTemplates';
import { WorkbenchModelSelect } from './WorkbenchModelSelect';
import { WorkbenchModelRecoveryNotice } from './WorkbenchModelRecoveryNotice';

interface WorkbenchTaskCreatorProps {
  novelTitle: string;
  chapters: Chapter[];
  templates: TaskTemplate[];
  plugins: CurrentPluginProjection[];
  pluginsLoading: boolean;
  pluginsError: string;
  contextPending: boolean;
  contextFailed: boolean;
  goal: string;
  chapterId: string;
  selectedModel: TaskModelSnapshot;
  creating: boolean;
  error: string;
  onGoalChange: (value: string) => void;
  onChapterChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onRetryModels: () => void;
  onOpenModelSettings: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function WorkbenchTaskCreator({
  novelTitle,
  chapters,
  templates,
  plugins,
  pluginsLoading,
  pluginsError,
  contextPending,
  contextFailed,
  goal,
  chapterId,
  selectedModel,
  creating,
  error,
  onGoalChange,
  onChapterChange,
  onModelChange,
  onRetryModels,
  onOpenModelSettings,
  onSubmit,
  onCancel,
}: WorkbenchTaskCreatorProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  const creatingRef = useRef(creating);
  const onCancelRef = useRef(onCancel);
  const conversationalGoal = isConversationalGoal(goal);
  const contextBlocksSubmit = (contextPending || contextFailed) && !conversationalGoal;
  const modelAvailability = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing: pluginsLoading,
    refreshError: pluginsError,
  });
  const modelBlocksSubmit = !modelAvailability.canSend && !conversationalGoal;
  const modelDirectoryMessage =
    modelAvailability.status === 'available' || !modelAvailability.message
      ? modelAvailability.message
      : `${modelAvailability.message} 本地能力问答仍可创建。`;

  useEffect(() => {
    creatingRef.current = creating;
    onCancelRef.current = onCancel;
  }, [creating, onCancel]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current;
    const backdrop = dialog.closest<HTMLElement>('.workbench-task-creator-backdrop');
    const backgroundNodes = Array.from(backdrop?.parentElement?.children ?? []).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop,
    );
    const previousBackgroundState = backgroundNodes.map((node) => ({
      node,
      inert: node.inert,
      ariaHidden: node.getAttribute('aria-hidden'),
    }));
    backgroundNodes.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });
    const initialFocusTimer = window.setTimeout(() => {
      dialog.querySelector<HTMLTextAreaElement>('[data-testid="workbench-new-task-goal"]')?.focus();
    }, 0);

    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creatingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(initialFocusTimer);
      previousBackgroundState.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="workbench-task-creator-backdrop">
      <section
        ref={dialogRef}
        className="workbench-task-creator"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="workbench-task-creator-title"
        data-testid="workbench-task-creator"
      >
        <header className="workbench-task-creator-header">
          <div>
            <div className="workbench-eyebrow">{novelTitle}</div>
            <h2 id="workbench-task-creator-title">新建创作任务</h2>
          </div>
          <button
            type="button"
            className="workbench-icon-button"
            aria-label="关闭新建任务"
            title="关闭"
            disabled={creating}
            onClick={onCancel}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className="workbench-task-creator-body">
          <label className="workbench-task-goal">
            <span>创作目标</span>
            <textarea
              autoFocus
              data-testid="workbench-new-task-goal"
              rows={4}
              value={goal}
              disabled={creating}
              placeholder={
                chapterId ? '例如：写出本章冲突升级后的转折' : '例如：写个六万字左右的悬疑故事'
              }
              onChange={(event) => onGoalChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (event.ctrlKey || event.metaKey) &&
                  goal.trim() &&
                  !creating &&
                  !contextBlocksSubmit &&
                  !modelBlocksSubmit
                ) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
            />
          </label>

          <div className="workbench-template-row">
            {templates.map((template) => (
              <button
                type="button"
                className="workbench-template-chip"
                key={template.id}
                data-testid={`workbench-template-${template.id}`}
                disabled={creating || !isWorkbenchTaskTemplateEnabled(template, Boolean(chapterId))}
                title={
                  !chapterId && template.scope === 'chapter'
                    ? '请先选择目标章节'
                    : chapterId && template.scope === 'project'
                      ? '请先将目标范围切换为整个小说项目'
                      : undefined
                }
                onClick={() => onGoalChange(template.goal)}
              >
                {template.label}
              </button>
            ))}
          </div>

          <div className="workbench-task-creator-controls">
            <label className="workbench-scope-control" htmlFor="workbench-new-task-chapter">
              <span>目标范围</span>
              <select
                id="workbench-new-task-chapter"
                data-testid="workbench-new-task-chapter"
                value={chapterId}
                disabled={creating}
                onChange={(event) => onChapterChange(event.target.value)}
              >
                <option value="">整个小说项目</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title || '未命名章节'}
                  </option>
                ))}
              </select>
            </label>
            <WorkbenchModelSelect
              id="workbench-new-task-model"
              testId="workbench-new-task-model-select"
              plugins={plugins}
              selectedModel={selectedModel}
              refreshing={pluginsLoading}
              refreshError={pluginsError}
              disabled={creating}
              onChange={onModelChange}
            />
          </div>

          {contextPending && (
            <div
              className="workbench-readiness-hint"
              data-testid="workbench-new-task-context-pending"
              role="status"
            >
              <LoaderCircle
                className="workbench-readiness-icon is-spinning"
                aria-hidden="true"
                size={15}
              />
              <span className="workbench-readiness-copy">
                正在整理已有章节上下文；可以继续填写，完成后即可创建创作任务。
              </span>
            </div>
          )}
          {contextFailed && (
            <div className="workbench-readiness-hint is-warning" role="status">
              <CircleAlert className="workbench-readiness-icon" aria-hidden="true" size={15} />
              <span className="workbench-readiness-copy">
                旧版上下文未能安全整理；创作任务已暂停，请重新启动应用后重试。
              </span>
            </div>
          )}

          <WorkbenchModelRecoveryNotice
            message={modelDirectoryMessage}
            status={modelAvailability.status}
            refreshing={pluginsLoading}
            testId="workbench-new-task-model-status"
            onRetry={onRetryModels}
            onOpenSettings={onOpenModelSettings}
          />

          {error && (
            <div className="workbench-inline-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="workbench-task-creator-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={creating}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="workbench-create-and-start"
            disabled={creating || contextBlocksSubmit || modelBlocksSubmit || !goal.trim()}
            onClick={onSubmit}
          >
            {creating
              ? '正在创建…'
              : pluginsLoading && !conversationalGoal
                ? '正在校验模型…'
                : contextFailed && !conversationalGoal
                  ? '上下文未就绪'
                  : contextBlocksSubmit
                    ? '正在准备上下文…'
                    : '创建并开始'}
          </button>
        </footer>
      </section>
    </div>
  );
}
