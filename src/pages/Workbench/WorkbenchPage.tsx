import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import { captureTaskModelSnapshot } from '../../services/conversation/taskModelSnapshot';
import {
  buildCoreAssetEditPath,
  type ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';
import { resolveWorkbenchModelDirectoryTarget } from '../../services/conversation/workbenchModelAvailability';
import {
  settleStructuredArtifactDecision,
  type StructuredArtifactDecisionInput,
} from '../../features/workbench/structuredArtifactDecisionSettlement';
import { WorkbenchComposer } from './WorkbenchComposer';
import { WorkbenchMessageStream } from './WorkbenchMessageStream';
import { WorkbenchNavigation } from './WorkbenchNavigation';
import { WorkbenchSidePanel } from './WorkbenchSidePanel';
import {
  WorkbenchEmptyProjects,
  WorkbenchEmptyTasks,
  WorkbenchFailureState,
  WorkbenchPreparingState,
  WorkbenchStartupHeader,
} from './WorkbenchPageStates';
import { WorkbenchTaskCreator } from './WorkbenchTaskCreator';
import { WorkbenchTaskHeader } from './WorkbenchTaskHeader';
import { submitWorkbenchTask } from './workbenchTaskSubmission';
import { WORKBENCH_TASK_TEMPLATES } from './workbenchTaskTemplates';
import { useWorkbenchVisibility } from './hooks/useWorkbenchVisibility';
import { resolveWorkbenchConversationStatus } from './workbenchRunProgress';
import { useWorkbenchArtifacts } from './hooks/useWorkbenchArtifacts';
import { useWorkbenchAssetScope } from './hooks/useWorkbenchAssetScope';
import { useWorkbenchCompression } from './hooks/useWorkbenchCompression';
import { useWorkbenchConversations } from './hooks/useWorkbenchConversations';
import { useWorkbenchIntent } from './hooks/useWorkbenchIntent';
import { useWorkbenchPlugins } from './hooks/useWorkbenchPlugins';
import { useWorkbenchSidePanel } from './hooks/useWorkbenchSidePanel';
import { useWorkbenchStartupReadiness } from './hooks/useWorkbenchStartupReadiness';
import { useWorkbenchTaskRunner } from './hooks/useWorkbenchTaskRunner';

export function WorkbenchPage() {
  const navigate = useNavigate();
  const [taskCreatorOpen, setTaskCreatorOpen] = useState(false);
  const [newTaskGoal, setNewTaskGoal] = useState('');
  const [newTaskChapterId, setNewTaskChapterId] = useState('');
  const [newTaskModel, setNewTaskModel] = useState(() => captureTaskModelSnapshot());
  const [taskCreatorError, setTaskCreatorError] = useState('');
  const { plugins, pluginsLoading, pluginsError, showPlugins, setShowPlugins, refreshPlugins } =
    useWorkbenchPlugins(taskCreatorOpen);
  const sidePanel = useWorkbenchSidePanel(showPlugins, setShowPlugins);
  const { contextPending, contextFailed } = useWorkbenchStartupReadiness();
  const [startupDraft, setStartupDraft] = useState('');
  const newTaskSubmissionRef = useRef(false);

  const {
    novels,
    directory,
    conversations,
    setConversations,
    selectedNovelId,
    selectedConversationId,
    chapterId,
    chapters,
    bundle,
    selectedNovel,
    selectedNovelRef,
    selectedConversationRef,
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
  useWorkbenchVisibility(
    !projectsLoading && !conversationsLoading && !bundleLoading && !chaptersLoading,
  );
  const selectedChapter = chapters.find((chapter) => chapter.id === chapterId);
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
    selectedConversationPreparing,
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
    reloadChapters,
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
    (input: StructuredArtifactDecisionInput) =>
      settleStructuredArtifactDecision({
        ...input,
        selectedNovelId,
        selectedConversationRef,
        selectedNovelRef,
        reloadChapters,
        selectChapter,
        settleAssetCandidateDecision,
      }),
    [
      reloadChapters,
      selectChapter,
      selectedConversationRef,
      selectedNovelId,
      selectedNovelRef,
      settleAssetCandidateDecision,
    ],
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
  const pluginProbeModel = resolveWorkbenchModelDirectoryTarget(
    taskCreatorOpen,
    selectedModel,
    newTaskModel,
  );
  useEffect(() => {
    void refreshPlugins(undefined, true, pluginProbeModel).catch(() => undefined);
  }, [pluginProbeModel, refreshPlugins]);
  useEffect(() => {
    if (!showPlugins) return;
    void refreshPlugins(undefined, true, pluginProbeModel).catch(() => undefined);
  }, [pluginProbeModel, refreshPlugins, showPlugins]);
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
  const openTaskCreator = useCallback(
    (initialGoal?: string) => {
      setNewTaskGoal(typeof initialGoal === 'string' ? initialGoal : startupDraft);
      setNewTaskChapterId(chapterId ?? '');
      setNewTaskModel(captureTaskModelSnapshot());
      setTaskCreatorError('');
      setTaskCreatorOpen(true);
    },
    [chapterId, startupDraft],
  );
  const { searchFocusToken } = useWorkbenchIntent(openTaskCreator);
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
      scopeKey={selectedConversationId || selectedNovelId}
      templates={WORKBENCH_TASK_TEMPLATES}
      plugins={plugins}
      pluginsLoading={pluginsLoading}
      pluginsError={pluginsError}
      selectedModel={selectedModel}
      draft={visibleDraft}
      composerError={composerError}
      conflictMessage={targetConflict?.message}
      selectedConversationPreparing={selectedConversationPreparing}
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
      onCreateTaskWithCurrentModel={() => openTaskCreator(visibleDraft)}
      onSend={() => void sendMessage()}
      onCancel={cancelTask}
      onRefreshAssetScope={() => void assetScope.refresh()}
      onOpenAssetScopePath={(path) => navigate(path)}
      onShowPlugins={sidePanel.openPlugins}
    />
  );
  const editMissingAsset = (asset: ChapterCoreAsset) =>
    assetRecovery && navigate(buildCoreAssetEditPath(assetRecovery, asset));
  const closeTaskCreator = useCallback(() => {
    if (!creatingTask && !newTaskSubmissionRef.current) setTaskCreatorOpen(false);
  }, [creatingTask]);
  const submitNewTask = () =>
    submitWorkbenchTask({
      goal: newTaskGoal,
      requestedChapterId: newTaskChapterId,
      taskModel: newTaskModel,
      selectedNovelId,
      chapters,
      creatingTask,
      contextPending,
      contextFailed,
      submissionRef: newTaskSubmissionRef,
      validateModelForSend,
      selectChapter,
      createTask,
      startInitializedTask,
      onError: setTaskCreatorError,
      onCreated: () => {
        setStartupDraft('');
        setTaskCreatorOpen(false);
      },
    });

  return (
    <div
      className="workbench-page"
      data-testid="creative-workbench"
      data-side-panel={sidePanel.view ?? 'closed'}
    >
      <WorkbenchNavigation
        directory={directory}
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
        searchFocusToken={searchFocusToken}
        onCreateTask={openTaskCreator}
        onSelectProject={selectProject}
        onSelectTask={selectTask}
        onRenameTask={renameTask}
        onSetTaskArchived={setTaskArchived}
        onRetryProjects={() => void loadInitialData()}
        onRetryConversations={() => void loadInitialData()}
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
              onShowPlugins={sidePanel.openPlugins}
              sidePanelOpen={sidePanel.view !== null}
              onToggleSidePanel={sidePanel.toggle}
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
                  onDecideArtifact={decideArtifact}
                  onRetry={(runId) => void retryRun(runId)}
                  retryRunBlockedReason={retryRunBlockedReason}
                  onRetryChapterSummaryStart={retryChapterSummaryStart}
                  onGenerateMissingAsset={(asset) => void generateMissingAsset(asset)}
                  onEditMissingAsset={editMissingAsset}
                  onRefreshAssetReadiness={() =>
                    void refreshChapterAssetReadiness(selectedConversationId)
                  }
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
      {sidePanel.view && (
        <WorkbenchSidePanel
          view={sidePanel.view}
          novelId={selectedNovelId}
          chapterId={selectedChapter?.id}
          bundle={bundleReady ? bundle : null}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          pluginsError={pluginsError}
          assetScope={assetScope.summary}
          assetScopeLoading={assetScope.loading}
          assetScopeError={assetScope.error}
          onRefreshAssetScope={() => void assetScope.refresh()}
          onOpenAssetScopePath={(path) => navigate(path)}
          onOpen={sidePanel.open}
          onBack={sidePanel.back}
          onClose={sidePanel.close}
        />
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
