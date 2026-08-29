import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import { captureTaskModelSnapshot } from '../../services/conversation/taskModelSnapshot';
import {
  buildCoreAssetEditPath,
  type ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';
import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import { WorkbenchModelUnavailableError } from '../../services/conversation/workbenchModelAvailability';
import type { ArtifactDecisionKind, ConversationArtifactCard } from '../../types/conversation';
import { PluginPanel } from './WorkbenchPluginPanel';
import { WorkbenchComposer } from './WorkbenchComposer';
import { WorkbenchMessageStream } from './WorkbenchMessageStream';
import { WorkbenchNavigation } from './WorkbenchNavigation';
import {
  WorkbenchEmptyProjects,
  WorkbenchEmptyTasks,
  WorkbenchFailureState,
  WorkbenchPreparingState,
  WorkbenchStartupHeader,
} from './WorkbenchPageStates';
import { WorkbenchTaskCreator } from './WorkbenchTaskCreator';
import { WorkbenchTaskHeader } from './WorkbenchTaskHeader';
import { WORKBENCH_TASK_TEMPLATES } from './workbenchTaskTemplates';
import { markWorkbenchOnce } from './workbenchHelpers';
import { resolveWorkbenchConversationStatus } from './workbenchRunProgress';
import { useWorkbenchArtifacts } from './hooks/useWorkbenchArtifacts';
import { useWorkbenchAssetScope } from './hooks/useWorkbenchAssetScope';
import { useWorkbenchCompression } from './hooks/useWorkbenchCompression';
import { useWorkbenchConversations } from './hooks/useWorkbenchConversations';
import { useWorkbenchPlugins } from './hooks/useWorkbenchPlugins';
import { useWorkbenchStartupReadiness } from './hooks/useWorkbenchStartupReadiness';
import { useWorkbenchTaskRunner } from './hooks/useWorkbenchTaskRunner';

export function WorkbenchPage() {
  const navigate = useNavigate();
  const { plugins, pluginsLoading, pluginsError, showPlugins, setShowPlugins, refreshPlugins } =
    useWorkbenchPlugins();
  const { contextPending, contextFailed } = useWorkbenchStartupReadiness();
  const [taskCreatorOpen, setTaskCreatorOpen] = useState(false);
  const [newTaskGoal, setNewTaskGoal] = useState('');
  const [newTaskChapterId, setNewTaskChapterId] = useState('');
  const [newTaskModel, setNewTaskModel] = useState(() => captureTaskModelSnapshot());
  const [taskCreatorError, setTaskCreatorError] = useState('');
  const [startupDraft, setStartupDraft] = useState('');
  const newTaskSubmissionRef = useRef(false);

  const {
    novels,
    conversations,
    setConversations,
    selectedNovelId,
    selectedConversationId,
    chapterId,
    chapters,
    bundle,
    selectedNovel,
    selectedNovelRef,
    selectedModel,
    projectsLoading,
    conversationsLoading,
    bundleLoading,
    chaptersLoading,
    creatingTask,
    projectsError,
    conversationsError,
    chaptersError,
    selectProject,
    selectTask,
    selectChapter,
    createTask,
    renameTask,
    setTaskArchived,
    refreshBundle,
    loadConversations,
    reloadChapters,
    loadInitialData,
  } = useWorkbenchConversations();

  useLayoutEffect(() => {
    markWorkbenchOnce('creative-workbench-visible');
  }, []);

  useEffect(() => {
    if (projectsLoading || conversationsLoading || bundleLoading || chaptersLoading) return;
    markWorkbenchOnce('workbench-content-ready');
  }, [bundleLoading, chaptersLoading, conversationsLoading, projectsLoading]);

  const selectedChapter = chapterId
    ? chapters.find((chapter) => chapter.id === chapterId)
    : undefined;
  const hasChapter = Boolean(selectedChapter);
  const assetScope = useWorkbenchAssetScope({
    novelId: selectedNovelId,
    chapterId: selectedChapter?.id,
    volumeId: selectedChapter?.volumeId,
    refreshKey: bundle
      ? `${bundle.conversation.updatedAt}:${bundle.artifacts.length}:${bundle.decisions?.length ?? 0}`
      : undefined,
  });

  const {
    draft,
    setDraft,
    composerError,
    setComposerError,
    beginComposerErrorOperation,
    commitComposerErrorOperation,
    runningConversationIds,
    targetConflict,
    selectedConversationRunning,
    selectedConversationArchived,
    chapterSummaryOrchestration,
    retryChapterSummaryStart,
    validateModelForSend,
    sendMessage,
    retryRun,
    retryRunBlockedReason,
    startInitializedTask,
    assetRecovery,
    assetReadinessBusy,
    generateMissingAsset,
    refreshChapterAssetReadiness,
    settleAssetCandidateDecision,
    resumeChapterGoal,
    dismissChapterAssetReadiness,
    cancelTask,
  } = useWorkbenchTaskRunner({
    selectedNovelId,
    selectedConversationId,
    chapterId,
    chapters,
    bundle,
    conversations,
    setConversations,
    selectedModel,
    selectedNovelRef,
    selectChapter,
    refreshBundle,
    loadConversations,
    refreshPlugins,
  });

  useEffect(() => {
    if (!selectedConversationId || !startupDraft || newTaskSubmissionRef.current) return;
    if (!draft) setDraft(startupDraft);
    setStartupDraft('');
  }, [draft, selectedConversationId, setDraft, startupDraft]);

  const handleStructuredArtifactDecision = useCallback(
    async (input: {
      artifact: ConversationArtifactCard;
      decision: ArtifactDecisionKind;
      applied: boolean;
    }) => {
      let selectedChapterId: string | undefined;
      if (input.applied) {
        const refreshed = await reloadChapters(selectedNovelId);
        selectedChapterId = refreshed?.chapterId;
        if (selectedChapterId) await selectChapter(selectedChapterId);
      }
      if (!input.artifact.artifactId) return;
      await settleAssetCandidateDecision({
        artifactId: input.artifact.artifactId,
        decision: input.decision,
        applied: input.applied,
        selectedChapterId,
      });
    },
    [reloadChapters, selectChapter, selectedNovelId, settleAssetCandidateDecision],
  );

  const {
    compressionCandidate,
    setCompressionCandidate,
    compressionBusy,
    proposeContextCompression,
  } = useWorkbenchCompression({
    selectedNovelId,
    selectedConversationId,
    refreshBundle,
    beginComposerErrorOperation,
    commitComposerErrorOperation,
  });

  const { decisionBusyCardId, decideArtifact } = useWorkbenchArtifacts({
    selectedNovelId,
    chapterId,
    refreshBundle,
    loadConversations,
    selectedNovelRef,
    setComposerError,
    setDraft,
    onStructuredArtifactDecision: handleStructuredArtifactDecision,
  });

  useEffect(() => {
    void refreshPlugins(undefined, true, selectedModel).catch(() => undefined);
  }, [refreshPlugins, selectedModel]);

  useEffect(() => {
    if (!showPlugins) return;
    void refreshPlugins(undefined, true, selectedModel).catch(() => undefined);
  }, [refreshPlugins, selectedModel, showPlugins]);

  const listedSelectedConversation = conversations.find(
    (conversation) => conversation.conversationId === selectedConversationId,
  );
  const selectedConversation = bundle?.conversation ?? listedSelectedConversation;
  const bundleReady = Boolean(
    bundle && bundle.conversation.conversationId === selectedConversationId,
  );
  const startupPending = projectsLoading || (conversationsLoading && !selectedConversation);
  const startupFailure = projectsError || (!selectedConversation ? conversationsError : '');
  const visibleDraft = selectedConversationId ? draft || startupDraft : startupDraft;
  const effectiveStatus = resolveWorkbenchConversationStatus({
    runtimeActive: selectedConversationRunning,
    bundleConversation:
      bundle?.conversation.conversationId === selectedConversationId
        ? bundle.conversation
        : undefined,
    listedConversation: listedSelectedConversation,
  });

  const composer = (
    <WorkbenchComposer
      templates={WORKBENCH_TASK_TEMPLATES}
      plugins={plugins}
      pluginsLoading={pluginsLoading}
      pluginsError={pluginsError}
      selectedModel={selectedModel}
      draft={visibleDraft}
      composerError={composerError}
      conflictMessage={targetConflict?.message}
      selectedConversationRunning={selectedConversationRunning}
      selectedConversationArchived={selectedConversationArchived}
      hasTask={Boolean(selectedConversation)}
      taskReady={bundleReady}
      hasChapter={hasChapter}
      chaptersLoading={chaptersLoading}
      contextPending={contextPending}
      contextFailed={contextFailed}
      assetScope={assetScope.summary}
      assetScopeLoading={assetScope.loading}
      assetScopeError={assetScope.error}
      onDraftChange={selectedConversationId ? setDraft : setStartupDraft}
      onRetryModels={() =>
        void refreshPlugins(undefined, true, selectedModel).catch(() => undefined)
      }
      onOpenModelSettings={() => navigate('/settings')}
      onSend={() => void sendMessage()}
      onCancel={cancelTask}
      onRefreshAssetScope={() => void assetScope.refresh()}
      onOpenAssetScopePath={(path) => navigate(path)}
    />
  );

  const editMissingAsset = useCallback(
    (asset: ChapterCoreAsset) => {
      if (!assetRecovery) return;
      navigate(buildCoreAssetEditPath(assetRecovery, asset));
    },
    [assetRecovery, navigate],
  );

  const openTaskCreator = useCallback(() => {
    setNewTaskGoal(startupDraft);
    setNewTaskChapterId(chapterId ?? '');
    setNewTaskModel(selectedModel);
    setTaskCreatorError('');
    setTaskCreatorOpen(true);
  }, [chapterId, selectedModel, startupDraft]);

  const closeTaskCreator = useCallback(() => {
    if (!creatingTask && !newTaskSubmissionRef.current) setTaskCreatorOpen(false);
  }, [creatingTask]);

  const submitNewTask = async () => {
    const goal = newTaskGoal.trim();
    if (!goal || creatingTask || !selectedNovelId || newTaskSubmissionRef.current) return;
    const conversationalGoal = isConversationalGoal(goal);
    if (contextPending && !conversationalGoal) {
      setTaskCreatorError('正在整理已有章节上下文；创作目标已保留，完成后即可创建任务。');
      return;
    }
    if (contextFailed && !conversationalGoal) {
      setTaskCreatorError('旧版上下文未能安全整理；创作目标已保留，请重新启动应用后重试。');
      return;
    }
    const requestedChapterId = newTaskChapterId.trim();
    const scopedChapter = requestedChapterId
      ? chapters.find(
          (chapter) => chapter.id === requestedChapterId && chapter.novelId === selectedNovelId,
        )
      : undefined;
    if (requestedChapterId && !scopedChapter) {
      setTaskCreatorError('所选章节不属于当前小说项目，请重新选择。');
      return;
    }
    const scopedChapterId = scopedChapter?.id;
    newTaskSubmissionRef.current = true;
    setTaskCreatorError('');
    try {
      if (!conversationalGoal) {
        try {
          await validateModelForSend(newTaskModel);
        } catch (error) {
          setTaskCreatorError(
            error instanceof WorkbenchModelUnavailableError
              ? error.message
              : 'Runtime 模型目录刷新失败，创作目标已保留，请稍后重试。',
          );
          return;
        }
      }

      await selectChapter(scopedChapterId ?? '');
      const initialized = await createTask(goal, newTaskModel);
      if (!initialized) return;
      setStartupDraft('');
      setTaskCreatorOpen(false);
      await startInitializedTask({
        conversationId: initialized.conversation.conversationId,
        novelId: initialized.conversation.novelId,
        chapterId: scopedChapterId,
        turnId: initialized.turn.turnId,
        goal,
        modelSnapshot: newTaskModel,
      });
    } catch (error) {
      setTaskCreatorError(error instanceof Error ? error.message : '新建创作任务失败，请重试。');
    } finally {
      newTaskSubmissionRef.current = false;
    }
  };

  return (
    <div className="workbench-page" data-testid="creative-workbench">
      <WorkbenchNavigation
        novels={novels}
        conversations={conversations}
        selectedNovelId={selectedNovelId}
        selectedConversationId={selectedConversationId}
        runningConversationIds={runningConversationIds}
        projectsLoading={projectsLoading}
        conversationsLoading={conversationsLoading}
        projectsError={projectsError}
        conversationsError={conversationsError}
        creatingTask={creatingTask}
        onCreateTask={openTaskCreator}
        onSelectProject={selectProject}
        onSelectTask={selectTask}
        onRenameTask={renameTask}
        onSetTaskArchived={setTaskArchived}
        onRetryProjects={() => void loadInitialData()}
        onRetryConversations={() => void loadConversations()}
        onOpenLibrary={() => navigate('/novels')}
      />

      <main
        className="workbench-main agent-console-main"
        aria-busy={
          startupPending || Boolean(selectedConversation && !bundleReady && !conversationsError)
        }
      >
        {startupPending || startupFailure ? (
          <>
            <WorkbenchStartupHeader
              novelTitle={selectedNovel?.title || '创作工作台'}
              failed={Boolean(startupFailure)}
              onShowPlugins={() => setShowPlugins(true)}
            />
            {startupFailure ? (
              <WorkbenchFailureState
                message={startupFailure}
                onRetry={() => (projectsError ? void loadInitialData() : void loadConversations())}
              />
            ) : (
              <WorkbenchPreparingState label="正在恢复项目与任务…" testId="workbench-loading" />
            )}
            {composer}
          </>
        ) : novels.length === 0 ? (
          <WorkbenchEmptyProjects onOpenLibrary={() => navigate('/novels')} />
        ) : !selectedConversation ? (
          <>
            <WorkbenchEmptyTasks
              creatingTask={creatingTask}
              conversationsLoading={conversationsLoading}
              onCreateTask={openTaskCreator}
              onShowPlugins={() => setShowPlugins(true)}
            />
            {composer}
          </>
        ) : (
          <>
            <WorkbenchTaskHeader
              novelTitle={selectedNovel?.title || '小说项目'}
              conversation={selectedConversation}
              chapters={chapters}
              chapterId={chapterId}
              hasChapter={hasChapter}
              chaptersLoading={chaptersLoading}
              chaptersError={chaptersError}
              effectiveStatus={effectiveStatus}
              compressionBusy={compressionBusy}
              bundleReady={bundleReady}
              onSelectChapter={(value) => void selectChapter(value)}
              onCreateChapter={() => navigate(`/novels/${selectedNovelId}`)}
              onCompress={() => void proposeContextCompression()}
              onShowPlugins={() => setShowPlugins(true)}
            />

            <PanelErrorBoundary panelTitle="创作对话">
              {bundle ? (
                <WorkbenchMessageStream
                  bundle={bundle}
                  compressionCandidate={compressionCandidate}
                  compressionBusy={compressionBusy}
                  decisionBusyCardId={decisionBusyCardId}
                  assetRecovery={assetRecovery}
                  assetReadinessBusy={assetReadinessBusy}
                  selectedConversationRunning={selectedConversationRunning}
                  chapterSummaryOrchestration={chapterSummaryOrchestration}
                  onDismissCompression={() => setCompressionCandidate(null)}
                  onReloadArtifacts={() => void refreshBundle(selectedConversation.conversationId)}
                  onDecideArtifact={(artifact, decision) => void decideArtifact(artifact, decision)}
                  onRetry={(runId) => void retryRun(runId)}
                  retryRunBlockedReason={retryRunBlockedReason}
                  onRetryChapterSummaryStart={retryChapterSummaryStart}
                  onGenerateMissingAsset={(asset) => void generateMissingAsset(asset)}
                  onEditMissingAsset={editMissingAsset}
                  onRefreshAssetReadiness={() => void refreshChapterAssetReadiness()}
                  onResumeChapterGoal={() => void resumeChapterGoal()}
                  onDismissAssetReadiness={dismissChapterAssetReadiness}
                />
              ) : conversationsError ? (
                <WorkbenchFailureState
                  message={conversationsError}
                  onRetry={() => void refreshBundle(selectedConversation.conversationId)}
                />
              ) : (
                <WorkbenchPreparingState
                  label="正在恢复这项任务的对话与产物…"
                  testId="workbench-bundle-loading"
                />
              )}
            </PanelErrorBoundary>

            {composer}
          </>
        )}
      </main>

      {showPlugins && (
        <PanelErrorBoundary panelTitle="当前插件">
          <PluginPanel
            plugins={plugins}
            loading={pluginsLoading}
            error={pluginsError}
            onClose={() => setShowPlugins(false)}
          />
        </PanelErrorBoundary>
      )}

      {taskCreatorOpen && selectedNovel && (
        <WorkbenchTaskCreator
          novelTitle={selectedNovel.title}
          chapters={chapters}
          templates={WORKBENCH_TASK_TEMPLATES}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          pluginsError={pluginsError}
          contextPending={contextPending}
          contextFailed={contextFailed}
          goal={newTaskGoal}
          chapterId={newTaskChapterId}
          selectedModel={newTaskModel}
          creating={creatingTask}
          error={taskCreatorError}
          onGoalChange={setNewTaskGoal}
          onChapterChange={setNewTaskChapterId}
          onModelChange={(value) => {
            const [providerId, ...model] = value.split(':');
            setNewTaskModel(captureTaskModelSnapshot(providerId, model.join(':')));
          }}
          onRetryModels={() =>
            void refreshPlugins(undefined, true, newTaskModel).catch(() => undefined)
          }
          onOpenModelSettings={() => navigate('/settings')}
          onSubmit={() => void submitNewTask()}
          onCancel={closeTaskCreator}
        />
      )}
    </div>
  );
}

export default WorkbenchPage;
