import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import DraftHistoryPanel from '../../components/right-dock/panels/DraftHistoryPanel';
import RightPanel from '../../components/right-dock/RightPanel';
import RightToolbar from '../../components/right-dock/RightToolbar';
import { ChapterReadinessPlanCard } from '../../features/agent-planner/ChapterReadinessPlanCard';
import EditorArea, { type EditorActionState } from '../../components/workspace/EditorArea';
import GlobalAiTaskModal from '../../components/workspace/GlobalAiTaskModal';
import RecoveryDialog from '../../components/workspace/RecoveryDialog';
import StatusBar from '../../components/workspace/StatusBar';
import VolumeTree from '../../components/workspace/VolumeTree';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import { hashTextContent } from '../../utils/contentHash';
import { showInfo } from '../../utils/nativeDialog';
import type { WritingWorkspaceViewProps } from './WritingWorkspaceView.types';
import {
  isE2eLegacyWorkspacePanelsEnabled,
  isWorkspaceAiPanelRetired,
} from '../../types/rightSidebar';
import { WorkspaceDocumentSkeleton } from './WorkspaceDocumentSkeleton';
import { WorkspaceFocusToggle } from './WorkspaceFocusToggle';
import { ChapterSummaryWorkflowNotice } from '../../components/workspace/ChapterSummaryWorkflowNotice';
import { WorkspaceSummaryDialogs } from './WorkspaceSummaryDialogs';

export default function WritingWorkspaceView({
  novelId,
  navigate,
  session,
  sidebarState,
  chapterLoader,
  draftApplication,
  creationActions,
  recoveryActions,
  summary,
  recoveryPrompt,
  recoverySaveStatus,
  refs,
  actions,
  contextVersion,
  locateTarget,
  writingContext,
  leaveGuardDialog,
  reviewLocked = false,
  onUnlockReview,
  reviewCandidate,
  reviewAuthorizationId,
  reviewArtifactId,
  onBeforeAdopt,
}: WritingWorkspaceViewProps) {
  const {
    novel,
    volumes,
    chapters,
    activeChapterId,
    currentDraft,
    editorSnapshot,
    draftWordCount,
    isDirty,
    qcReport,
    qcItems,
    aiModal,
  } = session;
  const activePanel = sidebarState.activeTool;
  const e2ePanelsEnabled = isE2eLegacyWorkspacePanelsEnabled();
  const visibleActivePanel = isWorkspaceAiPanelRetired(activePanel, e2ePanelsEnabled)
    ? null
    : activePanel;
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [editorActionState, setEditorActionState] = useState<EditorActionState>({
    saving: false,
    adopting: false,
    saveState: 'idle',
    saveMessage: '',
    adoptState: 'idle',
    adoptMessage: '',
  });
  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === activeChapterId),
    [activeChapterId, chapters],
  );
  const activeDraft = currentDraft?.chapterId === activeChapterId ? currentDraft : null;
  const activeReviewCandidate = reviewCandidate ?? chapterLoader.reviewCandidate;
  useEffect(() => {
    setEditorActionState({
      saving: false,
      adopting: false,
      saveState: 'idle',
      saveMessage: '',
      adoptState: 'idle',
      adoptMessage: '',
    });
  }, [activeChapterId]);
  const activeContentState = chapterLoader.contentLoadError ?? activeDraft?.contentState;
  const contentAvailable = activeContentState?.status !== 'unavailable';
  const activeQcReport = qcReport?.chapterId === activeChapterId ? qcReport : null;
  const activeQcItems = useMemo(
    () => (activeQcReport ? qcItems.filter((item) => item.chapterId === activeChapterId) : []),
    [activeChapterId, activeQcReport, qcItems],
  );
  const {
    pageLoading,
    pageError,
    loadState,
    chapterDocumentLoad,
    isChapterDocumentBlocked,
    retryChapterDraftLoad,
    retryActiveChapterContent,
    retryingContent,
    loadChapterDraft,
  } = chapterLoader;
  const novelMissing = !pageLoading && loadState === 'novel_not_found';
  const pageFailed = !pageLoading && Boolean(pageError) && !novelMissing;
  const workspaceAvailable = !pageLoading && !pageFailed && !novelMissing;
  const {
    applyTextRequest,
    editorCommandRequest,
    handleDraftApplied,
    handlePersistentDraftSaved,
    applyAiTextToEditor,
    handleApplyTextConsumed,
    handleApplyTextRejected,
    runEditorCommand,
  } = draftApplication;

  const handlePanelAdopted = useCallback(() => {
    const chapterId = refs.activeChapterId.current;
    if (!chapterId) return;
    if (
      refs.editorSnapshot.current.chapterId === chapterId &&
      refs.editorSnapshot.current.isDirty
    ) {
      void showInfo({
        title: '正文已在原章节采用',
        message: '采用期间编辑器已有新修改，已保留未保存内容，未自动重载正文。',
      });
      return;
    }
    void loadChapterDraft(chapterId);
  }, [loadChapterDraft, refs.activeChapterId, refs.editorSnapshot]);

  return (
    <div
      className={`workspace-page${focusMode ? ' is-focused' : ''}`}
      data-focus-mode={focusMode ? 'true' : 'false'}
      data-summary-exists={summary.exists ? 'true' : 'false'}
    >
      <div className="workspace-sidebar" id="workspace-chapter-directory" hidden={focusMode}>
        <div className={`workspace-novel-title${pageLoading ? ' is-loading' : ''}`}>
          {novel?.title || (pageLoading ? '正在载入作品' : '未选择作品')}
        </div>
        {novelId && (
          <PanelErrorBoundary panelTitle="卷章目录">
            <VolumeTree
              volumes={volumes}
              chapters={chapters}
              activeChapterId={activeChapterId}
              loading={pageLoading}
              unavailableMessage={
                novelMissing ? '作品目录不可用' : pageFailed ? '目录载入失败' : undefined
              }
              onSelectChapter={actions.selectChapter}
              onCreateVolume={creationActions.handleCreateVolume}
              onCreateChapter={creationActions.handleCreateChapter}
              onCreateFirstChapter={creationActions.handleCreateFirstChapter}
            />
          </PanelErrorBoundary>
        )}
      </div>

      <div className="workspace-editor" onClick={actions.editorClick}>
        <GlobalAiTaskModal state={aiModal} />
        <div className="workspace-topbar">
          <div className="workspace-topbar-title">
            {activeChapter && reviewAuthorizationId && !e2ePanelsEnabled ? (
              <ChapterSummaryWorkflowNotice
                novelId={novelId}
                chapter={activeChapter}
                authorizationId={reviewAuthorizationId}
                returnOnly
                onBeforeNavigate={actions.confirmEditorLeave}
              />
            ) : (
              <BackButton label="返回创作工作台" to="/" />
            )}
          </div>
          <div className="workspace-topbar-spacer" aria-hidden="true" />
          <WorkspaceFocusToggle
            active={focusMode}
            onToggle={() => {
              setFocusMode((current) => !current);
              refs.editor.current?.focus();
            }}
          />
        </div>

        {pageLoading ? (
          <WorkspaceDocumentSkeleton />
        ) : novelMissing ? (
          <div className="workspace-empty-state" role="alert" data-testid="workspace-missing-state">
            <div className="workspace-empty-content">
              <div className="workspace-empty-title">无法打开作品</div>
              <div className="workspace-empty-copy">作品不存在或本地数据已损坏。</div>
              <div className="workspace-state-actions">
                <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}>
                  返回首页
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings')}>
                  检查本地数据
                </button>
              </div>
            </div>
          </div>
        ) : pageFailed ? (
          <div className="workspace-empty-state" role="alert" data-testid="workspace-error-state">
            <div className="workspace-empty-content">
              <div className="workspace-empty-title">写作工作台载入失败</div>
              <div className="workspace-error-message">{pageError}</div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate(`/novels/${novelId}`)}
              >
                返回作品详情
              </button>
            </div>
          </div>
        ) : loadState === 'ready' && chapters.length === 0 ? (
          <div data-testid="workspace-empty-state" className="workspace-empty-state">
            <div className="workspace-empty-content">
              <div className="workspace-empty-icon">
                <NotebookPen aria-hidden="true" size={36} strokeWidth={1.8} />
              </div>
              <div className="workspace-empty-title">当前作品还没有章节</div>
              <div className="workspace-empty-copy">你可以在左侧目录先创建分卷，再创建第一章。</div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate(`/novels/${novelId}`)}
              >
                返回作品详情
              </button>
            </div>
          </div>
        ) : (
          <>
            {chapterDocumentLoad.status === 'error' && (
              <div
                data-testid="error-notice"
                data-chapter-id={chapterDocumentLoad.chapterId}
                role="alert"
                className="workspace-document-error"
              >
                <span>{chapterDocumentLoad.message}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  data-testid="chapter-load-retry"
                  onClick={retryChapterDraftLoad}
                >
                  重试
                </button>
              </div>
            )}
            <PanelErrorBoundary panelTitle="正文编辑区">
              {activeChapter && !e2ePanelsEnabled && (
                <ChapterSummaryWorkflowNotice
                  novelId={novelId}
                  chapter={activeChapter}
                  authorizationId={reviewAuthorizationId}
                  compact
                  onBeforeNavigate={actions.confirmEditorLeave}
                />
              )}
              <EditorArea
                ref={refs.editor}
                chapter={activeChapter}
                novelTitle={novel?.title}
                novelId={novelId}
                currentDraft={activeDraft}
                documentState={isChapterDocumentBlocked ? chapterDocumentLoad.status : 'ready'}
                contentStateOverride={activeContentState}
                onEditorContentChange={actions.editorContentChange}
                onDraftSaved={handlePersistentDraftSaved}
                applyTextRequest={applyTextRequest}
                onApplyTextConsumed={handleApplyTextConsumed}
                onApplyTextRejected={handleApplyTextRejected}
                commandRequest={editorCommandRequest}
                onChapterUpdated={actions.chapterOutlineApplied}
                locateTarget={locateTarget}
                onLocateDone={actions.locateDone}
                onRetryContent={() => void retryActiveChapterContent()}
                retryingContent={retryingContent}
                onOpenDraftHistory={
                  e2ePanelsEnabled ? () => actions.openSidebarTool('draft-history') : undefined
                }
                onBackToChapters={() => navigate(`/novels/${novelId}`)}
                reviewLocked={reviewLocked}
                onUnlockReview={onUnlockReview}
                reviewCandidate={activeReviewCandidate}
                reviewAuthorizationId={reviewAuthorizationId}
                reviewArtifactId={reviewArtifactId}
                onBeforeAdopt={onBeforeAdopt}
                onActionStateChange={setEditorActionState}
              />
            </PanelErrorBoundary>
            <StatusBar
              chapter={activeChapter}
              draftWordCount={draftWordCount}
              isDirty={isDirty}
              draftVersion={activeDraft ? `v${activeDraft.versionNo}` : 'v0 占位'}
              contentAvailable={contentAvailable}
              recoverySaveStatus={recoverySaveStatus}
              documentSaveState={editorActionState.saveState}
              documentSaveMessage={editorActionState.saveMessage}
              documentAdoptState={editorActionState.adoptState}
              documentAdoptMessage={editorActionState.adoptMessage}
              draftAdopted={activeDraft?.isAdopted}
            />
          </>
        )}
      </div>

      {pageLoading ? (
        <div className="right-toolbar workspace-toolbar-skeleton" aria-hidden="true" />
      ) : workspaceAvailable ? (
        <RightToolbar
          activePanel={visibleActivePanel}
          onTogglePanel={actions.togglePanel}
          onRunCommand={runEditorCommand}
          onToggleReadiness={() => setReadinessOpen((open) => !open)}
          readinessOpen={readinessOpen}
          documentAvailable={contentAvailable}
          reviewLocked={reviewLocked}
          documentDirty={isDirty}
          documentSaving={editorActionState.saving}
          documentAdopting={editorActionState.adopting}
          hasCurrentDraft={Boolean(activeDraft)}
          currentDraftAdopted={Boolean(activeDraft?.isAdopted)}
          hasReviewCandidate={Boolean(activeReviewCandidate)}
        />
      ) : null}

      {workspaceAvailable && readinessOpen && novelId && activeChapter && (
        <div className="workspace-readiness-dock" data-testid="chapter-readiness-dock">
          <ChapterReadinessPlanCard novelId={novelId} chapterId={activeChapter.id} />
        </div>
      )}

      {workspaceAvailable &&
        !isChapterDocumentBlocked &&
        visibleActivePanel === 'draft-history' && (
          <DraftHistoryPanel
            chapterId={activeChapterId}
            currentDraftId={activeDraft?.id}
            onBeforeDocumentChange={actions.confirmEditorLeave}
            onLoadDraft={(draft) => {
              handleDraftApplied(draft);
              actions.closeSidebar();
            }}
            onDraftAdopted={(draft) => {
              handleDraftApplied(draft);
              void actions.chapterOutlineApplied(draft.chapterId);
            }}
            onClose={actions.closePanel}
          />
        )}

      {workspaceAvailable && !isChapterDocumentBlocked && (
        <RightPanel
          panelType={visibleActivePanel === 'draft-history' ? null : visibleActivePanel}
          onClose={actions.closePanel}
          novelId={novelId}
          chapter={activeChapter}
          onGenerated={handleDraftApplied}
          onAdopted={handlePanelAdopted}
          onBeforeDocumentChange={actions.confirmEditorLeave}
          onChapterOutlineApplied={actions.chapterOutlineApplied}
          onChapterGoalDirtyChange={actions.setChapterGoalDirty}
          onChapterCharactersChanged={actions.bumpContextVersion}
          contextVersion={contextVersion}
          onLocateText={actions.locateText}
          qcReport={activeQcReport}
          qcItems={activeQcItems}
          onQcChange={actions.setQuality}
          currentEditorContent={
            contentAvailable
              ? editorSnapshot.chapterId === activeChapterId
                ? editorSnapshot.content
                : activeDraft?.content || ''
              : ''
          }
          currentEditorWordCount={
            contentAvailable
              ? editorSnapshot.chapterId === activeChapterId
                ? editorSnapshot.wordCount
                : activeDraft?.wordCount || 0
              : 0
          }
          currentEditorDirty={
            contentAvailable &&
            editorSnapshot.chapterId === activeChapterId &&
            editorSnapshot.isDirty
          }
          currentContentHash={
            contentAvailable
              ? editorSnapshot.chapterId === activeChapterId
                ? editorSnapshot.contentHash
                : hashTextContent(activeDraft?.content || '')
              : hashTextContent('')
          }
          currentDraftId={activeDraft?.id}
          currentDraftVersion={activeDraft?.versionNo}
          onApplyAiText={applyAiTextToEditor}
          showAiModal={actions.showAiModal}
          updateAiModal={actions.updateAiModal}
          hideAiModal={actions.hideAiModal}
          writingContext={writingContext}
          sidebarState={sidebarState}
          onUpdateToolState={actions.updateSidebarTool}
          documentAvailable={contentAvailable}
        />
      )}

      <WorkspaceSummaryDialogs summary={summary} chapterTitle={activeChapter?.title || ''} />

      {(recoveryPrompt.status === 'available' || recoveryPrompt.status === 'conflict') && (
        <RecoveryDialog
          state={recoveryPrompt}
          currentContent={contentAvailable ? editorSnapshot.content : ''}
          busy={recoveryActions.busy}
          onRestore={recoveryActions.restore}
          onDiscard={recoveryActions.discard}
          onLater={actions.dismissRecoveryPrompt}
          onSaveAsDraft={recoveryActions.saveAsDraft}
        />
      )}

      {leaveGuardDialog}
    </div>
  );
}
