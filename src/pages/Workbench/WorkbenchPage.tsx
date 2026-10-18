import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildCoreAssetEditPath,
  type ChapterCoreAsset,
} from '../../services/conversation/chapterAssetReadiness';
import { resolveWorkbenchModelDirectoryTarget } from '../../services/conversation/workbenchModelAvailability';
import { useWorkbenchTaskModelSelection } from '../../features/workbench/useWorkbenchTaskModelSelection';
import { useWorkbenchChapterHandoff } from '../../features/workbench/useWorkbenchChapterHandoff';
import { useWorkbenchTaskCreator } from './hooks/useWorkbenchTaskCreator';
import {
  settleStructuredArtifactDecision,
  type StructuredArtifactDecisionInput,
} from '../../features/workbench/structuredArtifactDecisionSettlement';
import { WorkbenchPageContent } from './WorkbenchPageContent';
import { useWorkbenchArtifactFocus } from './hooks/useWorkbenchArtifactFocus';
import { WORKBENCH_TASK_TEMPLATES } from './workbenchTaskTemplates';
import { useWorkbenchVisibility } from './hooks/useWorkbenchVisibility';
import { resolveWorkbenchConversationStatus } from './workbenchRunProgress';
import { useWorkbenchArtifacts } from './hooks/useWorkbenchArtifacts';
import { useWorkbenchAssetScope } from './hooks/useWorkbenchAssetScope';
import { useWorkbenchCompression } from './hooks/useWorkbenchCompression';
import { useWorkbenchConversations } from './hooks/useWorkbenchConversations';
import { useWorkbenchIntent } from './hooks/useWorkbenchIntent';
import { useWorkbenchPageChrome } from './hooks/useWorkbenchPageChrome';
import { useWorkbenchPlugins } from './hooks/useWorkbenchPlugins';
import { useWorkbenchSidePanel } from './hooks/useWorkbenchSidePanel';
import { useWorkbenchStartupReadiness } from './hooks/useWorkbenchStartupReadiness';
import { useWorkbenchTaskRunner } from './hooks/useWorkbenchTaskRunner';
export function WorkbenchPage() {
  const navigate = useNavigate();
  const [taskCreatorOpen, setTaskCreatorOpen] = useState(false);
  const { plugins, pluginsLoading, pluginsError, showPlugins, setShowPlugins, refreshPlugins } =
    useWorkbenchPlugins(taskCreatorOpen);
  const sidePanel = useWorkbenchSidePanel(showPlugins, setShowPlugins);
  const { contextPending, contextFailed } = useWorkbenchStartupReadiness();
  const [startupDraft, setStartupDraft] = useState('');
  const newTaskSubmissionRef = useRef(false);
  const modelSelectionPendingRef = useRef<() => boolean>(() => false);
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
    applyConversationUpdate,
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
    bundleStaleError,
    historyHasOlder,
    historyHasNewer,
    historyExpandToken,
    loadOlderHistory,
    loadLatestHistory,
    ensureArtifactLoaded,
    loadConversations,
    reloadChapters,
    loadInitialData,
  } = useWorkbenchConversations();
  const { artifactFocusRequest, onLocateArtifact } = useWorkbenchArtifactFocus(
    selectedConversationId,
    sidePanel.close,
  );
  useEffect(() => {
    if (!artifactFocusRequest || artifactFocusRequest.conversationId !== selectedConversationId) {
      return;
    }
    void ensureArtifactLoaded(artifactFocusRequest.cardId);
  }, [artifactFocusRequest, ensureArtifactLoaded, selectedConversationId]);
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
    revisionSource,
    clearRevisionSource,
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
    modelSelectionPendingRef,
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
  const chrome = useWorkbenchPageChrome({
    sidePanel,
    selectedConversationId,
    setDraft,
    setStartupDraft,
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
    compressionPresentation,
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
  const artifactActions = useWorkbenchArtifacts({
    selectedNovelId,
    chapterId,
    refreshBundle,
    loadConversations,
    selectedNovelRef,
    selectedConversationRef,
    setComposerError,
    setDraft,
    onStructuredArtifactDecision: handleStructuredArtifactDecision,
  });
  const { decisionBusyCardId, decideArtifact } = artifactActions;
  const taskCreator = useWorkbenchTaskCreator({
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
    chapterId,
    initialGoal: startupDraft,
    setOpen: setTaskCreatorOpen,
    onCreated: () => setStartupDraft(''),
  });
  const openTaskCreator = taskCreator.open;
  const pluginProbeModel = resolveWorkbenchModelDirectoryTarget(
    taskCreatorOpen,
    selectedModel,
    taskCreator.model,
  );
  useEffect(() => {
    // Model selection does not initialize or test a runtime. Execution reports
    // provider failures in the conversation after accepting the user message.
    void refreshPlugins(undefined, false).catch(() => undefined);
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
  const {
    changeModel,
    isChangingModel,
    modelChangePending,
    modelChangeError,
    modelSelectionDisabled,
  } = useWorkbenchTaskModelSelection({
    conversationId: selectedConversationId,
    conversationRef: selectedConversationRef,
    selectedModel,
    disabled:
      !bundleReady ||
      selectedConversationPreparing ||
      selectedConversationRunning ||
      selectedConversationArchived ||
      Boolean(
        bundle?.runs.some((run) => ['queued', 'running', 'cancel_requested'].includes(run.status)),
      ),
    plugins,
    pluginsLoading,
    pluginsError,
    onPersisted: applyConversationUpdate,
  });
  modelSelectionPendingRef.current = isChangingModel;
  const startupPending = projectsLoading || (conversationsLoading && !selectedConversation);
  const startupFailure = projectsError || (!selectedConversation ? conversationsError : '');
  const visibleDraft = selectedConversationId ? draft || startupDraft : startupDraft;
  const { searchFocusToken } = useWorkbenchIntent(openTaskCreator, chrome.exitFocusMode, {
    selectedNovelId,
    novelIds: novels.map((novel) => novel.id),
    loading: startupPending || chaptersLoading,
    selectProject,
  });
  useWorkbenchChapterHandoff({
    loading: startupPending || chaptersLoading || bundleLoading,
    selectedNovelId,
    selectedConversationId,
    chapters,
    bundle,
    draft,
    hasRevisionSource: Boolean(revisionSource),
    selectProject,
    selectTask,
    selectChapter,
    openTaskCreator,
    setDraft,
    setError: setComposerError,
    locateArtifact: onLocateArtifact,
  });
  const effectiveStatus = resolveWorkbenchConversationStatus({
    runtimeActive: selectedConversationRunning,
    bundleConversation:
      bundle?.conversation.conversationId === selectedConversationId
        ? bundle.conversation
        : undefined,
    listedConversation: listedSelectedConversation,
  });
  const editMissingAsset = (asset: ChapterCoreAsset) =>
    assetRecovery && navigate(buildCoreAssetEditPath(assetRecovery, asset));

  return (
    <WorkbenchPageContent
      pageRef={chrome.pageRef}
      focusMode={chrome.focusMode}
      sidePanel={sidePanel}
      openReference={chrome.openReference}
      toggleSidePanel={chrome.toggleSidePanel}
      toggleFocusMode={chrome.toggleFocusMode}
      composerProps={{
        wordPreviewContext: {
          novelId: selectedNovelId,
          conversationId: selectedConversationId || undefined,
          chapterId: selectedChapter?.id,
          chapterTarget: selectedChapter?.targetWordCount,
          historyRevision: bundle?.turns.reduce(
            (latest, turn) => Math.max(latest, turn.sequence),
            0,
          ),
        },
        scopeKey: selectedConversationId || selectedNovelId,
        templates: WORKBENCH_TASK_TEMPLATES,
        plugins,
        pluginsLoading,
        pluginsError,
        selectedModel,
        modelChangePending,
        modelSelectionDisabled,
        modelChangeError,
        onModelChange: (value) => void changeModel(value),
        draft: visibleDraft,
        revisionSource,
        onClearRevisionSource: clearRevisionSource,
        composerError,
        conflictMessage: targetConflict?.message,
        selectedConversationPreparing,
        selectedConversationRunning,
        selectedConversationArchived,
        hasTask: Boolean(selectedConversation),
        taskReady: bundleReady,
        hasChapter,
        chaptersLoading,
        contextPending,
        contextFailed,
        assetScope: assetScope.summary,
        assetScopeLoading: assetScope.loading,
        assetScopeError: assetScope.error,
        onDraftChange: selectedConversationId ? setDraft : setStartupDraft,
        onRetryModels: () =>
          void refreshPlugins(undefined, true, selectedModel).catch(() => undefined),
        onOpenModelSettings: () => navigate('/settings'),
        onCreateTaskWithCurrentModel: () => openTaskCreator(visibleDraft),
        onSend: () => {
          if (!isChangingModel()) void sendMessage();
        },
        onCancel: cancelTask,
        onRefreshAssetScope: () => void assetScope.refresh(),
        onOpenAssetScopePath: (path) => navigate(path),
      }}
      navigationProps={{
        directory,
        novels,
        conversations,
        selectedNovelId,
        selectedConversationId,
        runningConversationIds,
        projectsLoading,
        conversationsLoading,
        projectsError,
        conversationsError,
        creatingTask,
        searchFocusToken,
        onCreateTask: openTaskCreator,
        onSelectProject: selectProject,
        onSelectTask: selectTask,
        onRenameTask: renameTask,
        onSetTaskArchived: setTaskArchived,
        onRetryProjects: () => void loadInitialData(),
        onRetryConversations: () => void loadInitialData(),
        onOpenLibrary: () => navigate('/novels'),
      }}
      startupPending={startupPending}
      startupFailure={startupFailure}
      selectedNovel={selectedNovel}
      selectedConversation={selectedConversation}
      novelsEmpty={novels.length === 0}
      creatingTask={creatingTask}
      conversationsLoading={conversationsLoading}
      onCreateTask={openTaskCreator}
      onOpenLibrary={() => navigate('/novels')}
      onRetryStartup={() => (projectsError ? void loadInitialData() : void loadConversations())}
      chapters={chapters}
      chapterId={chapterId}
      hasChapter={hasChapter}
      chaptersLoading={chaptersLoading}
      chaptersError={chaptersError}
      effectiveStatus={effectiveStatus}
      compressionBusy={compressionBusy}
      bundleReady={bundleReady}
      bundle={bundle}
      conversationsError={conversationsError}
      bundleStaleError={bundleStaleError}
      onSelectChapter={(value) => void selectChapter(value)}
      onCreateChapter={() => navigate(`/novels/${selectedNovelId}`)}
      onCompress={() => void proposeContextCompression()}
      streamProps={
        bundle && selectedConversation
          ? {
              bundle,
              compressionCandidate,
              compressionPresentation,
              artifactFocusRequest,
              presentationContext: {
                novelId: selectedNovelId,
                novelTitle: selectedNovel?.title || '',
                chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
              },
              onInsertExample: chrome.insertExample,
              compressionBusy,
              decisionBusyCardId,
              assetRecovery,
              assetReadinessBusy,
              selectedConversationRunning,
              chapterSummaryOrchestration,
              onDismissCompression: () => setCompressionCandidate(null),
              historyHasOlder,
              historyHasNewer,
              historyExpandToken,
              onLoadOlderHistory: () => void loadOlderHistory(),
              onLoadLatestHistory: () => void loadLatestHistory(),
              onReloadArtifacts: () => void refreshBundle(selectedConversation.conversationId),
              onDecideArtifact: decideArtifact,
              onRetry: (runId) => {
                if (!isChangingModel()) void retryRun(runId);
              },
              retryRunBlockedReason: modelChangePending
                ? '正在保存模型选择，请稍候。'
                : retryRunBlockedReason,
              onRetryChapterSummaryStart: retryChapterSummaryStart,
              onGenerateMissingAsset: (asset) => void generateMissingAsset(asset),
              onEditMissingAsset: editMissingAsset,
              onRefreshAssetReadiness: () =>
                void refreshChapterAssetReadiness(selectedConversationId),
              onResumeChapterGoal: () => void resumeChapterGoal(),
              onDismissAssetReadiness: dismissChapterAssetReadiness,
            }
          : null
      }
      onRetryBundle={() =>
        selectedConversation && void refreshBundle(selectedConversation.conversationId)
      }
      selectedNovelId={selectedNovelId}
      selectedConversationId={selectedConversationId}
      selectedChapterId={selectedChapter?.id}
      plugins={plugins}
      pluginsLoading={pluginsLoading}
      pluginsError={pluginsError}
      assetScope={assetScope.summary}
      assetScopeLoading={assetScope.loading}
      assetScopeError={assetScope.error}
      onRefreshAssetScope={() => void assetScope.refresh()}
      onOpenAssetScopePath={(path) => navigate(path)}
      onLocateArtifact={onLocateArtifact}
      artifactActions={artifactActions}
      taskCreator={
        taskCreatorOpen && selectedNovel
          ? {
              novelTitle: selectedNovel.title,
              chapters,
              templates: WORKBENCH_TASK_TEMPLATES,
              plugins,
              pluginsLoading,
              pluginsError,
              contextPending,
              contextFailed,
              ...taskCreator.formProps,
              onRetryModels: () =>
                void refreshPlugins(undefined, true, taskCreator.model).catch(() => undefined),
              onOpenModelSettings: () => navigate('/settings'),
            }
          : null
      }
    />
  );
}
export default WorkbenchPage;
