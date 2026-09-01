import { useState } from 'react';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import type { WorkbenchAssetScopeSummary } from '../../services/conversation/workbenchAssetScopeService';
import { ArrowUp, ChevronDown, CircleAlert, Database, LoaderCircle, Square } from 'lucide-react';
import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import { getWorkbenchModelAvailability } from '../../services/conversation/workbenchModelAvailability';
import type { TaskModelSnapshot } from '../../types/conversation';
import { WorkbenchModelSelect } from './WorkbenchModelSelect';
import { WorkbenchModelRecoveryNotice } from './WorkbenchModelRecoveryNotice';
import { WorkbenchAssetScopePanel } from './WorkbenchAssetScopePanel';
import {
  isWorkbenchTaskTemplateEnabled,
  type WorkbenchTaskTemplate,
} from './workbenchTaskTemplates';

export type TaskTemplate = WorkbenchTaskTemplate;

const CORE_ASSET_TOTAL = 4;
const AVAILABLE_CORE_ASSET_STATUSES = new Set(['ready', 'fallback']);

function resolveCoreAssetReadyCount(
  summary: WorkbenchAssetScopeSummary | null,
  hasChapter: boolean,
): number | null {
  if (!summary) return null;
  const keys = ['world', 'rules', 'protagonist', hasChapter ? 'chapter_outline' : 'master_outline'];
  return keys.reduce((count, key) => {
    const item = summary.items.find((candidate) => candidate.key === key);
    return count + (item && AVAILABLE_CORE_ASSET_STATUSES.has(item.status) ? 1 : 0);
  }, 0);
}

interface WorkbenchComposerProps {
  templates: TaskTemplate[];
  plugins: CurrentPluginProjection[];
  pluginsLoading: boolean;
  pluginsError: string;
  selectedModel: TaskModelSnapshot;
  draft: string;
  composerError: string;
  conflictMessage?: string;
  selectedConversationPreparing: boolean;
  selectedConversationRunning: boolean;
  selectedConversationArchived: boolean;
  hasTask: boolean;
  taskReady: boolean;
  hasChapter: boolean;
  chaptersLoading: boolean;
  contextPending: boolean;
  contextFailed: boolean;
  assetScope: WorkbenchAssetScopeSummary | null;
  assetScopeLoading: boolean;
  assetScopeError: string;
  onDraftChange: (value: string) => void;
  onRetryModels: () => void;
  onOpenModelSettings: () => void;
  onCreateTaskWithCurrentModel: () => void;
  onSend: () => void;
  onCancel: () => void;
  onRefreshAssetScope: () => void;
  onOpenAssetScopePath: (path: string) => void;
}

export function WorkbenchComposer({
  templates,
  plugins,
  pluginsLoading,
  pluginsError,
  selectedModel,
  draft,
  composerError,
  conflictMessage,
  selectedConversationPreparing,
  selectedConversationRunning,
  selectedConversationArchived,
  hasTask,
  taskReady,
  hasChapter,
  chaptersLoading,
  contextPending,
  contextFailed,
  assetScope,
  assetScopeLoading,
  assetScopeError,
  onDraftChange,
  onRetryModels,
  onOpenModelSettings,
  onCreateTaskWithCurrentModel,
  onSend,
  onCancel,
  onRefreshAssetScope,
  onOpenAssetScopePath,
}: WorkbenchComposerProps) {
  const [assetScopeOpen, setAssetScopeOpen] = useState(false);
  const composerState = selectedConversationRunning
    ? 'running'
    : selectedConversationPreparing
      ? 'preparing'
      : selectedConversationArchived
        ? 'archived'
        : 'idle';
  const composerDisabled = composerState === 'archived';
  const executionLocked = composerState !== 'idle';
  const templatesDisabled = executionLocked || chaptersLoading;
  const modelAvailability = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing: pluginsLoading,
    refreshError: pluginsError,
    selectionLocked: true,
  });
  const conversationalDraft = isConversationalGoal(draft);
  const canSendDraft = Boolean(
    draft.trim() &&
    taskReady &&
    (!contextPending || conversationalDraft) &&
    (!contextFailed || conversationalDraft) &&
    (modelAvailability.canSend || conversationalDraft),
  );
  const modelDirectoryMessage =
    modelAvailability.status === 'available' || !modelAvailability.message
      ? modelAvailability.message
      : `${modelAvailability.message} 本地能力问答仍可发送。`;
  const coreAssetReadyCount = resolveCoreAssetReadyCount(assetScope, hasChapter);
  const coreAssetSummary = `核心 ${coreAssetReadyCount ?? '--'}/${CORE_ASSET_TOTAL}`;

  return (
    <footer
      className="workbench-composer agent-console-composer"
      data-composer-state={composerState}
    >
      <div className="workbench-template-row" data-testid="workbench-task-templates">
        {templates.map((template) => (
          <button
            type="button"
            className="workbench-template-chip"
            key={template.id}
            data-testid={`workbench-template-${template.id}`}
            disabled={templatesDisabled || !isWorkbenchTaskTemplateEnabled(template, hasChapter)}
            title={
              !hasChapter && !chaptersLoading && template.scope === 'chapter'
                ? '请先选择或创建目标章节'
                : hasChapter && template.scope === 'project'
                  ? '项目级动作需在“整个小说项目”范围的新任务中执行'
                  : undefined
            }
            onClick={() => onDraftChange(template.goal)}
          >
            {template.label}
          </button>
        ))}
      </div>

      <div className="workbench-composer-surface">
        {contextPending && (
          <div
            className="workbench-readiness-hint"
            data-testid="workbench-context-pending"
            role="status"
          >
            <LoaderCircle
              className="workbench-readiness-icon is-spinning"
              aria-hidden="true"
              strokeWidth={1.8}
              size={15}
            />
            <span className="workbench-readiness-copy">
              正在整理已有章节上下文；可以继续编辑，完成后即可发送创作任务。
            </span>
          </div>
        )}
        {contextFailed && (
          <div
            className="workbench-readiness-hint is-warning"
            data-testid="workbench-context-warning"
            role="status"
          >
            <CircleAlert
              className="workbench-readiness-icon"
              aria-hidden="true"
              size={15}
              strokeWidth={1.8}
            />
            <span className="workbench-readiness-copy">
              旧版上下文未能安全整理；创作执行已暂停，请重新启动应用后重试。
            </span>
          </div>
        )}
        {composerState === 'archived' && (
          <div className="workbench-readiness-hint" role="status">
            <CircleAlert
              className="workbench-readiness-icon"
              aria-hidden="true"
              size={15}
              strokeWidth={1.8}
            />
            <span className="workbench-readiness-copy">
              此任务已归档；恢复任务后才能继续发送目标。
            </span>
          </div>
        )}
        <WorkbenchModelRecoveryNotice
          message={modelDirectoryMessage}
          status={modelAvailability.status}
          refreshing={pluginsLoading}
          testId="workbench-model-directory-status"
          onRetry={onRetryModels}
          onOpenSettings={onOpenModelSettings}
          onCreateTask={onCreateTaskWithCurrentModel}
        />
        {composerError && (
          <div
            className="workbench-inline-error"
            data-testid="workbench-composer-error"
            role="alert"
          >
            {composerError}
          </div>
        )}
        {conflictMessage && (
          <div
            className="workbench-conflict-hint"
            data-testid="workbench-conflict-hint"
            role="status"
          >
            {conflictMessage}
          </div>
        )}

        {assetScopeOpen && (
          <WorkbenchAssetScopePanel
            summary={assetScope}
            loading={assetScopeLoading}
            error={assetScopeError}
            onRefresh={onRefreshAssetScope}
            onOpen={onOpenAssetScopePath}
          />
        )}

        <textarea
          data-testid="workbench-composer-input"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.ctrlKey || event.metaKey) &&
              !executionLocked &&
              canSendDraft
            ) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="描述这次要推进的创作目标"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          rows={2}
          disabled={composerDisabled}
        />

        <div className="workbench-composer-toolbar">
          <button
            type="button"
            className={`workbench-asset-scope-toggle ${assetScopeOpen ? 'is-open' : ''}`.trim()}
            data-testid="workbench-asset-scope-toggle"
            aria-expanded={assetScopeOpen}
            aria-controls="workbench-asset-scope-panel"
            title={`查看可用创作上下文，${coreAssetSummary}`}
            disabled={!assetScope && !assetScopeLoading && !assetScopeError}
            onClick={() => setAssetScopeOpen((open) => !open)}
          >
            <Database aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>创作上下文</span>
            <span
              className={`workbench-asset-scope-core ${
                coreAssetReadyCount === CORE_ASSET_TOTAL ? 'is-complete' : ''
              }`.trim()}
              data-testid="workbench-core-asset-summary"
              data-core-ready={coreAssetReadyCount ?? ''}
              data-core-total={CORE_ASSET_TOTAL}
            >
              {coreAssetSummary}
            </span>
            {assetScope && assetScope.requiredMissingCount > 0 && (
              <span className="workbench-asset-scope-count">{assetScope.requiredMissingCount}</span>
            )}
            <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
          </button>
          <WorkbenchModelSelect
            id="workbench-model"
            testId="workbench-model-select"
            plugins={plugins}
            selectedModel={selectedModel}
            refreshing={pluginsLoading}
            refreshError={pluginsError}
            disabled={executionLocked}
            locked
          />

          {composerState === 'preparing' ? (
            <span
              className="workbench-composer-note"
              data-testid="workbench-task-preparing"
              role="status"
            >
              正在准备任务
            </span>
          ) : !taskReady ? (
            <span className="workbench-composer-note" data-testid="workbench-task-pending">
              {hasTask ? '任务恢复中，草稿会保留' : '请先新建创作任务'}
            </span>
          ) : (
            chaptersLoading && <span className="workbench-composer-note">正在读取章节…</span>
          )}

          {composerState === 'running' ? (
            <button
              type="button"
              className="workbench-send-button is-stop"
              data-testid="workbench-stop-task"
              aria-label="停止当前任务"
              title="停止当前任务"
              onClick={onCancel}
            >
              <Square aria-hidden="true" size={13} strokeWidth={1.8} />
            </button>
          ) : (
            <button
              type="button"
              className="workbench-send-button"
              data-testid="workbench-send-task"
              aria-label="发送创作目标"
              title="发送创作目标"
              onClick={onSend}
              disabled={executionLocked || !canSendDraft}
            >
              <ArrowUp aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
