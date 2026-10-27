import { useRef } from 'react';
import { useModalAccessibility } from '../../components/common/useModalAccessibility';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { Chapter } from '../../types/chapter';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import { isModelLedCreativeTurn } from '../../services/dsh/taskSessionAdapter';
import { getWorkbenchModelAvailability } from '../../services/conversation/workbenchModelAvailability';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { TaskTemplate } from './WorkbenchComposer';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';
import { GrowingGoalTextarea } from './GrowingGoalTextarea';
import { WorkbenchTemplateControls } from './WorkbenchTemplateControls';
import { ChapterLocator } from '../../components/workspace/ChapterLocator';
import { WorkbenchModelSelect } from './WorkbenchModelSelect';
import { WorkbenchModelRecoveryNotice } from './WorkbenchModelRecoveryNotice';
import { useWorkbenchModelCredential } from './hooks/useWorkbenchModelCredential';

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
  modelSourceLabel?: string;
  modelPending?: boolean;
  modelUnresolved?: boolean;
  onRetryModelSource?: () => void;
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
  modelSourceLabel,
  modelPending,
  modelUnresolved,
  onRetryModelSource,
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const conversationalGoal = isConversationalGoal(goal);
  const modelLed = isModelLedCreativeTurn({ goal, modelSnapshot: selectedModel });
  const contextBlocksSubmit =
    (contextPending || contextFailed) && (modelLed || !conversationalGoal);
  const { credentialAvailable } = useWorkbenchModelCredential(selectedModel, pluginsLoading);
  const modelAvailability = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing: pluginsLoading,
    refreshError: pluginsError,
    allowLocalFallback: true,
    credentialAvailable,
  });
  const modelBlocksSubmit = !modelAvailability.canSend && !conversationalGoal && !modelLed;
  const modelDirectoryMessage =
    modelAvailability.status === 'available' || !modelAvailability.message
      ? modelAvailability.message
      : `${modelAvailability.message} 本地能力问答仍可创建。`;

  useModalAccessibility({
    overlayRef,
    dialogRef,
    onDismiss: onCancel,
    busy: creating,
    initialFocusSelector: '[data-testid="workbench-new-task-goal"]',
  });

  return (
    <div ref={overlayRef} className="workbench-task-creator-backdrop">
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
            <h2 id="workbench-task-creator-title">新建创作会话</h2>
          </div>
          <button
            type="button"
            className="workbench-icon-button"
            aria-label="关闭新建会话"
            title="关闭"
            disabled={creating}
            onClick={onCancel}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className="workbench-task-creator-body">
          <label className="workbench-task-goal">
            <span>聊聊你的构思</span>
            <GrowingGoalTextarea
              autoFocus
              data-testid="workbench-new-task-goal"
              rows={4}
              value={goal}
              disabled={creating}
              placeholder={
                chapterId
                  ? '例如：先聊聊这一章的冲突和人物动机'
                  : '例如：我想写悬疑小说，先一起确定背景和主角'
              }
              onChange={(event) => onGoalChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !isComposingKeyboardEvent(event) &&
                  (event.ctrlKey || event.metaKey) &&
                  goal.trim() &&
                  !creating &&
                  !modelPending &&
                  !modelUnresolved &&
                  !contextBlocksSubmit &&
                  !modelBlocksSubmit
                ) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
            />
          </label>

          <WorkbenchTemplateControls
            templates={templates}
            hasChapter={Boolean(chapterId)}
            disabled={creating}
            value={goal}
            onChange={onGoalChange}
          />

          <div className="workbench-task-creator-controls">
            <div className="workbench-scope-control">
              <label htmlFor="workbench-new-task-chapter">交流范围</label>
              <ChapterLocator
                chapters={chapters}
                activeChapterId={chapterId}
                onSelectChapter={onChapterChange}
                disabled={creating}
                includeProject
                selectId="workbench-new-task-chapter"
                selectTestId="workbench-new-task-chapter"
              />
            </div>
            <WorkbenchModelSelect
              id="workbench-new-task-model"
              testId="workbench-new-task-model-select"
              plugins={plugins}
              selectedModel={selectedModel}
              refreshing={pluginsLoading}
              refreshError={pluginsError}
              disabled={creating || modelPending}
              onChange={onModelChange}
            />
          </div>

          {modelSourceLabel && (
            <p className="workbench-readiness-hint" data-testid="workbench-new-task-model-source">
              {modelSourceLabel}；实际调用以本回合模型为准，历史重试保留原模型。
            </p>
          )}
          {modelUnresolved && !modelPending && onRetryModelSource && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={creating}
              onClick={onRetryModelSource}
            >
              重新读取作品模型
            </button>
          )}
          {contextPending && (
            <div
              className="workbench-readiness-hint"
              data-testid="workbench-new-task-context-pending"
              role="status"
            >
              <LoaderCircle
                className="workbench-readiness-icon is-spinning"
                aria-hidden="true"
                strokeWidth={1.8}
                size={15}
              />
              <span className="workbench-readiness-copy">
                正在整理已有章节上下文；可以继续填写，完成后即可开始对话。
              </span>
            </div>
          )}
          {contextFailed && (
            <div className="workbench-readiness-hint is-warning" role="status">
              <CircleAlert
                className="workbench-readiness-icon"
                aria-hidden="true"
                size={15}
                strokeWidth={1.8}
              />
              <span className="workbench-readiness-copy">
                旧版上下文未能安全整理；会话准备已暂停，请重新启动应用后重试。
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
            disabled={
              creating ||
              modelPending ||
              modelUnresolved ||
              contextBlocksSubmit ||
              modelBlocksSubmit ||
              !goal.trim()
            }
            onClick={onSubmit}
          >
            {creating
              ? '正在开启…'
              : pluginsLoading && !conversationalGoal
                ? '正在加载模型…'
                : contextFailed && contextBlocksSubmit
                  ? '上下文未就绪'
                  : contextBlocksSubmit
                    ? '正在准备上下文…'
                    : '开始对话'}
          </button>
        </footer>
      </section>
    </div>
  );
}
