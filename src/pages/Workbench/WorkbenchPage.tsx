import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Novel } from '../../types/novel';
import type {
  ArtifactDecisionKind,
  ConversationArtifactCard,
  TaskConversation,
  TaskConversationBundle,
  TaskModelSnapshot,
} from '../../types/conversation';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { getAiSettings } from '../../services/ai/aiSettingsStore';
import { artifactDecisionService } from '../../services/conversation/artifactDecisionService';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../../services/conversation/taskModelSnapshot';
import { taskSessionAdapter } from '../../services/dsh/taskSessionAdapter';
import {
  getCurrentPluginProjection,
  type CurrentPluginProjection,
} from '../../services/conversation/currentPluginService';
import { ArtifactCard, PluginPanel, ToolEventRow } from './WorkbenchComponents';
import '../../styles/workbench.css';

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
  const [novels, setNovels] = useState<Novel[]>([]);
  const [conversations, setConversations] = useState<TaskConversation[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [bundle, setBundle] = useState<TaskConversationBundle | null>(null);
  const [chapterId, setChapterId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [selectedModel, setSelectedModel] = useState<TaskModelSnapshot>(() =>
    captureTaskModelSnapshot(),
  );
  const [plugins, setPlugins] = useState<CurrentPluginProjection[]>([]);
  const [showPlugins, setShowPlugins] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composerError, setComposerError] = useState('');
  const [decisionBusyCardId, setDecisionBusyCardId] = useState('');
  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedNovelRef = useRef('');
  const selectedConversationRef = useRef('');

  const selectedNovel = novels.find((novel) => novel.id === selectedNovelId);

  const selectNovel = useCallback((novelId: string) => {
    selectedNovelRef.current = novelId;
    setSelectedNovelId(novelId);
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    selectedConversationRef.current = conversationId;
    setSelectedConversationId(conversationId);
  }, []);

  const loadConversations = useCallback(
    async (novelId?: string) => {
      const items = await taskConversationService.list(novelId);
      setConversations((current) => {
        if (!novelId) return items;
        return [...current.filter((item) => item.novelId !== novelId), ...items].sort(
          (left, right) => right.updatedAt.localeCompare(left.updatedAt),
        );
      });
      const selectedId = selectedConversationRef.current;
      const selectedStillVisible = items.some((item) => item.conversationId === selectedId);
      if (!selectedId || (!selectedStillVisible && !novelId)) {
        const next = items[0];
        if (next) {
          selectNovel(next.novelId);
          selectConversation(next.conversationId);
        } else {
          selectConversation('');
          setBundle(null);
        }
      }
    },
    [selectConversation, selectNovel],
  );

  const refreshBundle = useCallback(async (conversationId: string) => {
    const next = await taskConversationService.get(conversationId);
    if (selectedConversationRef.current !== conversationId) return;
    setBundle(next);
    if (next?.conversation.defaultModel) setSelectedModel(next.conversation.defaultModel);
  }, []);

  const refreshPlugins = useCallback(async (conversationId?: string, allowProbe = false) => {
    const target = conversationId?.trim() || (allowProbe ? '__ans_plugin_probe__' : undefined);
    const current = await getCurrentPluginProjection(target);
    setPlugins(current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      return Promise.all([novelRepository.getAll(), getCurrentPluginProjection()]);
    })()
      .then(async ([items, currentPlugins]) => {
        if (cancelled) return;
        setNovels(items);
        setPlugins(currentPlugins);
        const first = items[0];
        if (!first) {
          setLoading(false);
          return;
        }
        selectNovel(first.id);
        const chapters = await chapterRepository.getByNovelId(first.id);
        setChapterId(first.currentChapterId ?? chapters[0]?.id);
        await loadConversations();
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [loadConversations, selectNovel]);

  useEffect(() => {
    if (!selectedConversationId) return;
    void refreshBundle(selectedConversationId);
  }, [refreshBundle, selectedConversationId]);

  useEffect(() => {
    if (!showPlugins) return;
    void refreshPlugins(undefined, true);
  }, [refreshPlugins, showPlugins]);

  useEffect(() => {
    if (!selectedNovelId) return;
    void chapterRepository.getByNovelId(selectedNovelId).then((chapters) => {
      const current = novels.find((novel) => novel.id === selectedNovelId);
      setChapterId(current?.currentChapterId ?? chapters[0]?.id);
    });
  }, [novels, selectedNovelId]);

  useEffect(() => {
    let cancelled = false;
    const refreshRunning = async () => {
      try {
        const ids = await taskSessionAdapter.listRunningConversationIds();
        if (!cancelled) {
          setRunningConversationIds((current) => {
            const next = new Set(ids);
            current.forEach((id) => {
              if (taskSessionAdapter.isRunning(id)) next.add(id);
            });
            return next;
          });
        }
      } catch {
        if (!cancelled) return;
      }
    };
    void refreshRunning();
    const timer = window.setInterval(() => void refreshRunning(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function createTask() {
    if (!selectedNovelId) return;
    const created = await taskConversationService.create(
      selectedNovelId,
      '新的创作任务',
      selectedModel,
    );
    selectConversation(created.conversationId);
    await loadConversations(selectedNovelId);
    await refreshBundle(created.conversationId);
  }

  async function sendMessage(messageOverride?: string) {
    const message = (messageOverride ?? draft).trim();
    const conversationId = selectedConversationId;
    if (
      !message ||
      !selectedNovelId ||
      !conversationId ||
      runningConversationIds.has(conversationId)
    ) {
      return;
    }
    const novelId = selectedNovelId;
    setComposerError('');
    setRunningConversationIds((current) => new Set(current).add(conversationId));
    setDraft('');
    try {
      const turn = await taskConversationService.appendTurn(conversationId, 'user', message);
      await refreshBundle(conversationId);
      await taskSessionAdapter.startTurn(
        {
          conversationId,
          novelId,
          chapterId,
          turnId: turn.turnId,
          goal: message,
          modelSnapshot: selectedModel,
        },
        ({ run }) => {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.conversationId === conversationId
                ? {
                    ...conversation,
                    status:
                      run.status === 'completed'
                        ? 'completed'
                        : run.status === 'failed'
                          ? 'failed'
                          : run.status === 'cancelled'
                            ? 'idle'
                            : 'running',
                    updatedAt: run.updatedAt,
                  }
                : conversation,
            ),
          );
          void refreshBundle(conversationId);
        },
      );
      await refreshBundle(conversationId);
      if (selectedNovelRef.current === novelId) await loadConversations(novelId);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : '任务启动失败');
      await refreshBundle(conversationId);
      if (selectedNovelRef.current === novelId) await loadConversations(novelId);
    } finally {
      void refreshPlugins(conversationId);
      setRunningConversationIds((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
    }
  }

  function cancelTask() {
    if (selectedConversationId) taskSessionAdapter.cancel(selectedConversationId);
  }

  async function decideArtifact(
    artifact: ConversationArtifactCard,
    decision: ArtifactDecisionKind,
  ) {
    if (!selectedNovelId || !artifact.artifactId) return;
    setDecisionBusyCardId(artifact.cardId);
    setComposerError('');
    try {
      const payload = {
        conversationId: artifact.conversationId,
        cardId: artifact.cardId,
        artifactId: artifact.artifactId,
        decision,
        targetType: artifact.artifactType === 'chapter_text' ? 'chapter' : 'asset',
        targetId: chapterId || selectedNovelId,
        novelId: selectedNovelId,
        chapterId,
      };
      const result =
        decision === 'request_apply'
          ? await artifactDecisionService.applyStructured(payload)
          : await artifactDecisionService.record(payload);
      await refreshBundle(artifact.conversationId);
      if (selectedNovelRef.current === selectedNovelId) {
        await loadConversations(selectedNovelId);
      }
      if (result.authorization && chapterId) {
        navigate(
          `/novels/${selectedNovelId}/workspace?chapterId=${encodeURIComponent(chapterId)}&authorizationId=${encodeURIComponent(result.authorization.authorizationId)}&artifactId=${encodeURIComponent(artifact.artifactId)}`,
        );
      }
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : '产物决定失败');
    } finally {
      setDecisionBusyCardId('');
    }
  }

  const selectedRun = bundle?.runs[bundle.runs.length - 1];
  const selectedConversationRunning = selectedConversationId
    ? runningConversationIds.has(selectedConversationId) ||
      taskSessionAdapter.isRunning(selectedConversationId)
    : false;

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
                  data-testid="workbench-current-plugins"
                  onClick={() => setShowPlugins(true)}
                >
                  当前插件
                </button>
              </div>
            </header>
            <section
              className="workbench-message-scroll"
              data-testid="workbench-message-list"
              aria-live="polite"
            >
              {bundle.turns.length === 0 && (
                <div className="workbench-intro">
                  <div className="workbench-intro-icon">✦</div>
                  <h3>从一个创作目标开始</h3>
                  <p>
                    例如“生成下一章”或“审计前十章人物一致性”。运行中的工具和候选产物会直接出现在这里。
                  </p>
                </div>
              )}
              {bundle.turns.map((turn) => {
                const run = bundle.runs.find((item) => item.turnId === turn.turnId);
                const events = run
                  ? bundle.toolEvents.filter((event) => event.runId === run.runId)
                  : [];
                const artifacts = run
                  ? bundle.artifacts.filter((artifact) => artifact.runId === run.runId)
                  : [];
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
                          <div className="workbench-inline-error" data-testid="workbench-run-error">
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
      {showPlugins && <PluginPanel plugins={plugins} onClose={() => setShowPlugins(false)} />}
    </div>
  );
}

export default WorkbenchPage;
