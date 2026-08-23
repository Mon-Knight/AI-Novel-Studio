import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAiSettings } from '../../services/ai/aiSettingsStore';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../../services/conversation/taskModelSnapshot';
import { ArtifactCard, PluginPanel, ToolEventRow } from './WorkbenchComponents';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import {
  useWorkbenchArtifacts,
  useWorkbenchCompression,
  useWorkbenchConversations,
  useWorkbenchPlugins,
  useWorkbenchTaskRunner,
} from './hooks';
import '../../styles/workbench.css';

const TASK_TEMPLATES = [
  { id: 'generate-chapter', label: '生成下一章', goal: '生成下一章' },
  { id: 'audit-chapter', label: '审计章节', goal: '审计人物一致性' },
  { id: 'expand-outline', label: '完善大纲', goal: '扩展本章大纲' },
  { id: 'check-characters', label: '检查人物', goal: '检查人物一致性' },
  { id: 'expand-settings', label: '整理设定', goal: '生成世界设定候选' },
  { id: 'polish-chapter', label: '润色候选', goal: '润色本章正文' },
] as const;

function statusLabel(status: string): string {
  return (
    {
      idle: '待命',
      running: '运行中',
      waiting_user: '待确认',
      failed: '失败',
      completed: '已完成',
      archived: '已归档',
      queued: '排队中',
      cancel_requested: '取消中',
      cancelled: '已取消',
    }[status] ?? status
  );
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function WorkbenchPage() {
  const navigate = useNavigate();

  const { plugins, setPlugins, showPlugins, setShowPlugins, refreshPlugins } =
    useWorkbenchPlugins();

  const {
    novels,
    conversations,
    setConversations,
    selectedNovelId,
    selectedConversationId,
    bundle,
    chapterId,
    selectedModel,
    setSelectedModel,
    loading,
    chapters,
    selectedNovel,
    selectedChapter,
    selectedNovelRef,
    selectNovel,
    selectConversation,
    selectChapter,
    loadConversations,
    refreshBundle,
    createTask,
  } = useWorkbenchConversations({ setPlugins });
  const hasChapter = Boolean(chapterId && selectedChapter);

  const {
    draft,
    setDraft,
    composerError,
    setComposerError,
    runningConversationIds,
    targetConflict,
    selectedConversationRunning,
    sendMessage,
    cancelTask,
  } = useWorkbenchTaskRunner({
    selectedNovelId,
    selectedConversationId,
    chapterId,
    conversations,
    setConversations,
    selectedModel,
    selectedNovelRef,
    refreshBundle,
    loadConversations,
    refreshPlugins,
  });

  const {
    compressionCandidate,
    setCompressionCandidate,
    compressionBusy,
    proposeContextCompression,
  } = useWorkbenchCompression({
    selectedNovelId,
    selectedConversationId,
    refreshBundle,
    setComposerError,
  });

  const { decisionBusyCardId, decideArtifact } = useWorkbenchArtifacts({
    selectedNovelId,
    chapterId,
    refreshBundle,
    loadConversations,
    selectedNovelRef,
    setComposerError,
    setDraft,
  });

  useEffect(() => {
    if (!showPlugins) return;
    void refreshPlugins(undefined, true);
  }, [refreshPlugins, showPlugins]);

  const selectedRun = bundle?.runs[bundle.runs.length - 1];

  if (loading) return <div className="workbench-loading">正在恢复创作工作台…</div>;
  if (novels.length === 0) {
    return (
      <div className="workbench-empty-state" data-testid="workbench-no-projects">
        <h1>还没有小说项目</h1>
        <p>先创建一本小说，再从任务对话推进创作。</p>
        <button
          className="btn btn-primary"
          data-testid="workbench-open-novels"
          onClick={() => navigate('/novels')}
        >
          打开小说作品
        </button>
      </div>
    );
  }

  return (
    <div className="workbench-page" data-testid="creative-workbench">
      <aside className="workbench-tree">
        <div className="workbench-tree-header">
          <div>
            <div className="workbench-eyebrow">创作工作台</div>
            <h1>任务</h1>
          </div>
          <button
            className="workbench-new-task"
            data-testid="workbench-create-task"
            onClick={() => void createTask()}
          >
            ＋ 新建
          </button>
        </div>
        <div className="workbench-tree-scroll">
          {novels.map((novel) => (
            <section className="workbench-project" key={novel.id}>
              <button
                className={`workbench-project-row ${selectedNovelId === novel.id ? 'is-active' : ''}`}
                data-testid="workbench-project"
                data-novel-id={novel.id}
                data-selected={selectedNovelId === novel.id ? 'true' : 'false'}
                onClick={() => selectNovel(novel.id)}
              >
                <span className="workbench-project-mark">{novel.title.slice(0, 1) || '书'}</span>
                <span>{novel.title}</span>
              </button>
              {conversations
                .filter((conversation) => conversation.novelId === novel.id)
                .map((conversation) => {
                  const running = runningConversationIds.has(conversation.conversationId);
                  const displayStatus = running ? 'running' : conversation.status;
                  return (
                    <button
                      className={`workbench-task-row ${selectedConversationId === conversation.conversationId ? 'is-active' : ''}`}
                      key={conversation.conversationId}
                      data-testid="workbench-task"
                      data-conversation-id={conversation.conversationId}
                      data-status={displayStatus}
                      data-selected={
                        selectedConversationId === conversation.conversationId ? 'true' : 'false'
                      }
                      onClick={() => {
                        selectNovel(novel.id);
                        selectConversation(conversation.conversationId);
                      }}
                    >
                      <span className={`workbench-status-dot is-${displayStatus}`} />
                      <span className="workbench-task-title">{conversation.title}</span>
                      <span className="workbench-task-status">{statusLabel(displayStatus)}</span>
                    </button>
                  );
                })}
            </section>
          ))}
        </div>
        <button
          className="workbench-library-link"
          data-testid="workbench-library-link"
          onClick={() => navigate('/novels')}
        >
          管理小说作品 →
        </button>
      </aside>

      <main className="workbench-main">
        {!bundle ? (
          <div className="workbench-empty-state">
            <h2>选择一个任务开始</h2>
            <p>任务对话会保存用户目标、工具事件、运行状态和候选产物。</p>
            <button
              className="btn btn-primary"
              data-testid="workbench-create-task"
              onClick={() => void createTask()}
            >
              新建任务
            </button>
          </div>
        ) : (
          <>
            <header
              className="workbench-task-header"
              data-testid="workbench-task-header"
              data-conversation-id={bundle.conversation.conversationId}
            >
              <div>
                <div className="workbench-eyebrow">{selectedNovel?.title || '小说项目'}</div>
                <h2>{bundle.conversation.title}</h2>
                <div className="workbench-chapter-target" data-testid="workbench-chapter-target">
                  <label htmlFor="workbench-chapter-select">目标章节</label>
                  {chapters.length === 0 ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      data-testid="workbench-create-chapter"
                      onClick={() => navigate(`/novels/${selectedNovelId}`)}
                    >
                      去创建章节
                    </button>
                  ) : (
                    <select
                      id="workbench-chapter-select"
                      data-testid="workbench-chapter-select"
                      value={chapterId ?? ''}
                      onChange={(event) => void selectChapter(event.target.value)}
                    >
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.title || '未命名章节'}
                        </option>
                      ))}
                    </select>
                  )}
                  {!hasChapter && (
                    <span className="workbench-chapter-hint">未绑定章节：不能生成或润色正文</span>
                  )}
                </div>
              </div>
              <div className="workbench-task-header-actions">
                <span
                  className={`workbench-run-badge is-${bundle.conversation.status}`}
                  data-testid="workbench-conversation-status"
                  data-status={bundle.conversation.status}
                >
                  {statusLabel(bundle.conversation.status)}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  data-testid="workbench-compress-context"
                  disabled={compressionBusy}
                  onClick={() => void proposeContextCompression()}
                >
                  压缩上下文
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  data-testid="workbench-current-plugins"
                  onClick={() => setShowPlugins(true)}
                >
                  当前插件
                </button>
              </div>
            </header>
            <PanelErrorBoundary panelTitle="任务对话流">
              <section
                className="workbench-message-scroll"
                data-testid="workbench-message-list"
                aria-live="polite"
              >
                {bundle.turns.length === 0 && !compressionCandidate && (
                  <div className="workbench-intro">
                    <div className="workbench-intro-icon">✦</div>
                    <h3>从一个创作目标开始</h3>
                    <p>
                      先选择目标章节，再说“生成下一章”。系统会走正式写章管线生成候选，确认后才进入写作工作台审阅。
                    </p>
                  </div>
                )}
                {compressionCandidate && (
                  <article
                    className="workbench-artifact-card"
                    data-testid="workbench-compression-card"
                    data-valid={compressionCandidate.valid ? 'true' : 'false'}
                  >
                    <div className="workbench-artifact-heading">
                      <div>
                        <div className="workbench-eyebrow">小说上下文压缩候选</div>
                        <h3>
                          {compressionCandidate.providerId}@{compressionCandidate.version}
                        </h3>
                      </div>
                      <span className="workbench-artifact-status">
                        {compressionCandidate.valid ? '校验通过' : '覆盖率不足'}
                      </span>
                    </div>
                    <p>
                      revision {compressionCandidate.sourceRevision} · token{' '}
                      {compressionCandidate.coverage.tokens.used}/
                      {compressionCandidate.coverage.tokens.budget}
                    </p>
                    <pre>{compressionCandidate.compressedText}</pre>
                    <div className="workbench-artifact-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        data-testid="workbench-compression-dismiss"
                        disabled={compressionBusy}
                        onClick={() => setCompressionCandidate(null)}
                      >
                        放弃
                      </button>
                    </div>
                  </article>
                )}
                {bundle.turns.map((turn) => {
                  const run = bundle.runs.find((item) => item.turnId === turn.turnId);
                  const events = run
                    ? bundle.toolEvents.filter((event) => event.runId === run.runId)
                    : [];
                  const isLatestTurn =
                    turn.turnId === bundle.turns[bundle.turns.length - 1]?.turnId;
                  const artifacts = [
                    ...(run
                      ? bundle.artifacts.filter((artifact) => artifact.runId === run.runId)
                      : []),
                    ...(isLatestTurn
                      ? bundle.artifacts.filter((artifact) => !artifact.runId)
                      : []),
                  ];
                  return (
                    <div
                      className={`workbench-turn is-${turn.role}`}
                      key={turn.turnId}
                      data-testid="workbench-turn"
                      data-turn-id={turn.turnId}
                      data-role={turn.role}
                    >
                      <div className="workbench-turn-meta">
                        <span>
                          {turn.role === 'user' ? '你' : turn.role === 'assistant' ? 'AI' : '系统'}
                        </span>
                        <time>{formatTime(turn.createdAt)}</time>
                      </div>
                      <div className="workbench-turn-content">{turn.content}</div>
                      {run && (
                        <div
                          className="workbench-run-block"
                          data-testid="workbench-run"
                          data-run-id={run.runId}
                          data-status={run.status}
                          data-worker-id={run.workerId}
                        >
                          <div className="workbench-run-heading">
                            <span>运行 · {run.workerId}</span>
                            <span>{statusLabel(run.status)}</span>
                          </div>
                          {events.map((event) => (
                            <ToolEventRow event={event} key={event.eventId} />
                          ))}
                          {artifacts.map((artifact) => (
                            <ArtifactCard
                              artifact={artifact}
                              key={artifact.cardId}
                              busy={decisionBusyCardId === artifact.cardId}
                              onDecide={(decision) => void decideArtifact(artifact, decision)}
                            />
                          ))}
                          {run.error && (
                            <div
                              className="workbench-inline-error"
                              data-testid="workbench-run-error"
                            >
                              {run.error}
                            </div>
                          )}
                          {run.status === 'failed' && (
                            <button
                              className="btn btn-secondary btn-sm workbench-retry-button"
                              data-testid="workbench-retry-turn"
                              onClick={() => {
                                const previous = [...bundle.turns]
                                  .reverse()
                                  .find((item) => item.role === 'user');
                                if (previous) void sendMessage(previous.content);
                              }}
                            >
                              重试此回合
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            </PanelErrorBoundary>
            <footer className="workbench-composer">
              <div className="workbench-model-row">
                <label htmlFor="workbench-model">模型</label>
                <select
                  id="workbench-model"
                  data-testid="workbench-model-select"
                  value={`${selectedModel.providerId}:${selectedModel.modelId}`}
                  onChange={(event) => {
                    const [providerId, ...model] = event.target.value.split(':');
                    const previous = selectedModel;
                    const next = captureTaskModelSnapshot(providerId, model.join(':'));
                    setSelectedModel(next);
                    setComposerError('');
                    void taskConversationService
                      .updateDefaultModel(bundle.conversation.conversationId, next)
                      .catch((error: unknown) => {
                        setSelectedModel(previous);
                        setComposerError(
                          error instanceof Error ? error.message : '任务模型保存失败',
                        );
                      });
                  }}
                >
                  <option value="mock:Mock">Mock（浏览器 fallback）</option>
                  {plugins
                    .filter(
                      (plugin) =>
                        plugin.category === 'model' &&
                        plugin.status === 'loaded' &&
                        plugin.id.startsWith('model:'),
                    )
                    .map((plugin) => {
                      const value = plugin.id.slice('model:'.length);
                      return (
                        <option key={plugin.id} value={value}>
                          {plugin.name}
                        </option>
                      );
                    })}
                  {getAiSettings().runtimeMode === 'api' &&
                    getAiSettings().modelName.trim() &&
                    !plugins.some(
                      (plugin) =>
                        plugin.id ===
                        `model:${getAiSettings().provider === 'deepseek' ? 'deepseek-official' : getAiSettings().provider}:${getAiSettings().modelName}`,
                    ) && (
                      <option value={`${getAiSettings().provider}:${getAiSettings().modelName}`}>
                        {getAiSettings().modelName}（未进入 Runtime 目录）
                      </option>
                    )}
                </select>
                {(selectedRun?.status === 'running' || selectedConversationRunning) && (
                  <button
                    className="btn btn-secondary btn-sm"
                    data-testid="workbench-stop-task"
                    onClick={cancelTask}
                  >
                    停止
                  </button>
                )}
              </div>
              {composerError && (
                <div className="workbench-inline-error" data-testid="workbench-composer-error">
                  {composerError}
                </div>
              )}
              {targetConflict && (
                <div
                  className="workbench-conflict-hint"
                  data-testid="workbench-conflict-hint"
                  role="status"
                >
                  {targetConflict.message}
                </div>
              )}
              <div className="workbench-template-row" data-testid="workbench-task-templates">
                {TASK_TEMPLATES.map((template) => (
                  <button
                    type="button"
                    className="workbench-template-chip"
                    key={template.id}
                    data-testid={`workbench-template-${template.id}`}
                    disabled={selectedConversationRunning || !hasChapter}
                    title={!hasChapter ? '请先选择或创建目标章节' : undefined}
                    onClick={() => setDraft(template.goal)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
              <div className="workbench-input-row">
                <textarea
                  data-testid="workbench-composer-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="描述你要推进的创作任务…（Ctrl/Cmd + Enter 发送）"
                  rows={3}
                  disabled={selectedConversationRunning}
                />
                <button
                  className="workbench-send-button"
                  data-testid="workbench-send-task"
                  onClick={() => void sendMessage()}
                  disabled={selectedConversationRunning || !draft.trim()}
                >
                  {selectedConversationRunning ? '运行中…' : '发送'}
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
      {showPlugins && (
        <PanelErrorBoundary panelTitle="当前插件">
          <PluginPanel plugins={plugins} onClose={() => setShowPlugins(false)} />
        </PanelErrorBoundary>
      )}
    </div>
  );
}

export default WorkbenchPage;
