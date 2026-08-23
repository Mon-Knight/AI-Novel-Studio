import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import { getAiSettings } from '../../services/ai/aiSettingsStore';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import {
  AgentConsoleStatusBar,
  AgentConsoleTabs,
  AgentTraceCanvas,
  ArtifactCard,
  PluginPanel,
  ToolEventRow,
} from './WorkbenchComponents';
import { statusLabel } from './workbenchHelpers';
import { useWorkbenchArtifacts } from './hooks/useWorkbenchArtifacts';
import { useWorkbenchCompression } from './hooks/useWorkbenchCompression';
import { useWorkbenchConversations } from './hooks/useWorkbenchConversations';
import { useWorkbenchPlugins } from './hooks/useWorkbenchPlugins';
import { useWorkbenchTaskRunner } from './hooks/useWorkbenchTaskRunner';
import '../../styles/workbench.css';

const TASK_TEMPLATES = [
  { id: 'generate-chapter', label: '生成下一章', goal: '生成下一章' },
  { id: 'audit-chapter', label: '审计章节', goal: '审计本章质量并检查人物与设定一致性' },
  { id: 'outline', label: '完善大纲', goal: '完善当前章节大纲与分镜' },
  { id: 'characters', label: '检查人物', goal: '提取并核对本章登场人物' },
  { id: 'settings', label: '整理设定', goal: '整理并沉淀本章新增设定' },
  { id: 'polish', label: '润色候选', goal: '润色本章候选正文，增强文风表现力' },
];

function formatTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

import { captureTaskModelSnapshot } from '../../services/conversation/taskModelSnapshot';

export function WorkbenchPage() {
  const navigate = useNavigate();
  const { plugins, setPlugins, showPlugins, setShowPlugins, refreshPlugins } =
    useWorkbenchPlugins();
  const [activeTab, setActiveTab] = useState<'chat' | 'trace'>('chat');

  const {
    novels,
    conversations,
    setConversations,
    selectedNovelId,
    selectedConversationId,
    chapterId,
    chapters,
    bundle,
    loading,
    selectedNovel,
    selectedNovelRef,
    selectedModel,
    setSelectedModel,
    selectNovel,
    selectConversation,
    selectChapter,
    createTask,
    refreshBundle,
    loadConversations,
  } = useWorkbenchConversations({ setPlugins });

  const hasChapter = Boolean(chapterId && chapters.some((chapter) => chapter.id === chapterId));

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
  const latestToolEvent = bundle?.toolEvents[bundle.toolEvents.length - 1];

  if (loading) return <div className="workbench-loading">正在恢复创作控制台…</div>;
  if (novels.length === 0) {
    return (
      <div className="workbench-empty-state" data-testid="workbench-no-projects">
        <h1>还没有小说项目</h1>
        <p>先创建一本小说，再从 Agent 创作控制台推进长篇小说生成。</p>
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

  const effectiveStatus = selectedConversationRunning
    ? 'running'
    : bundle?.conversation.status || 'idle';

  return (
    <div className="workbench-page agent-console-layout" data-testid="creative-workbench">
      {/* 1. 左侧会话与小说项目树 (Conversations Sidebar) */}
      <aside className="workbench-tree">
        <div className="workbench-tree-header">
          <div>
            <div className="workbench-eyebrow">Agent Console</div>
            <h1>创作会话</h1>
          </div>
          <button
            className="workbench-new-task"
            data-testid="workbench-create-task"
            onClick={() => void createTask()}
          >
            ＋ 新建会话
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

      {/* 2. 主区域：Agent Console 对话画布 (Main Agent Console Canvas) */}
      <main className="workbench-main agent-console-main">
        {!bundle ? (
          <div className="workbench-empty-state">
            <h2>选择或创建一个创作会话</h2>
            <p>会话驱动的 Agent Console 将实时记录创作目标、工具调用轨迹与章节候选产物。</p>
            <button
              className="btn btn-primary"
              data-testid="workbench-create-task"
              onClick={() => void createTask()}
            >
              新建创作会话
            </button>
          </div>
        ) : (
          <>
            {/* 2.1 顶部控制台导航与章节绑定 */}
            <header
              className="workbench-task-header agent-console-header"
              data-testid="workbench-task-header"
              data-conversation-id={bundle.conversation.conversationId}
            >
              <div className="agent-header-left">
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
                  className={`workbench-run-badge is-${effectiveStatus}`}
                  data-testid="workbench-conversation-status"
                  data-status={effectiveStatus}
                >
                  {statusLabel(effectiveStatus)}
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

            {/* 2.2 Agent 阶段状态栏 (Planning -> Executing -> Checking -> Completed) */}
            <AgentConsoleStatusBar
              status={effectiveStatus}
              activeWorkerId={selectedRun?.workerId}
              latestToolName={latestToolEvent?.toolName}
            />

            {/* 2.3 对话 / 轨迹 双 Tab 切换器 */}
            <AgentConsoleTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              eventCount={bundle.toolEvents.length}
            />

            {/* 2.4 主内容视口（对话视图 vs 轨迹视图） */}
            <PanelErrorBoundary panelTitle="Agent 控制台画布">
              {activeTab === 'chat' ? (
                <section
                  className="workbench-message-scroll"
                  data-testid="workbench-message-list"
                  aria-live="polite"
                >
                  {bundle.turns.length === 0 && !compressionCandidate && (
                    <div className="workbench-intro">
                      <div className="workbench-intro-icon">✦</div>
                      <h3>向创作 Agent 输入目标</h3>
                      <p>
                        先选择目标章节，在下方输入“生成下一章”或点击快捷芯片。Agent
                        将自动拆解大纲、调用工具并输出候选正文。
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
                            {turn.role === 'user'
                              ? '你'
                              : turn.role === 'assistant'
                                ? 'AI Agent'
                                : '系统'}
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
                            {/* 对话中默认展示简化工具摘要 */}
                            <div className="workbench-tool-summaries">
                              {events.map((event) => (
                                <ToolEventRow event={event} key={event.eventId} />
                              ))}
                            </div>
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
              ) : (
                <AgentTraceCanvas bundle={bundle} onRetry={(goal) => void sendMessage(goal)} />
              )}
            </PanelErrorBoundary>

            {/* 2.5 底部固定输入 Composer (Sticky Composer) */}
            <footer className="workbench-composer agent-console-composer">
              {/* 快捷 Prompt Chips */}
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

              {/* 模型选择与停止按钮 */}
              <div className="workbench-model-row">
                <label htmlFor="workbench-model">Agent 模型</label>
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

              {/* 输入框与发送按钮 */}
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
                  placeholder="描述你要 Agent 推进的创作目标…（Ctrl/Cmd + Enter 发送）"
                  rows={2}
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

      {/* 3. 插件只读面板 */}
      {showPlugins && (
        <PanelErrorBoundary panelTitle="当前插件">
          <PluginPanel plugins={plugins} onClose={() => setShowPlugins(false)} />
        </PanelErrorBoundary>
      )}
    </div>
  );
}

export default WorkbenchPage;
