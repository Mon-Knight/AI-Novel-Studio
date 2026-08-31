import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, LoaderCircle, NotebookPen, RefreshCw, Square, X } from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import ChapterSummaryDialog from '../../components/chapter-summary/ChapterSummaryDialog';
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
import { isWorkspaceAiPanelRetired } from '../../types/rightSidebar';

function WorkspaceDocumentSkeleton() {
  return (
    <div
      className="workspace-document-skeleton"
      data-testid="workspace-document-loading"
      role="status"
      aria-live="polite"
    >
      <span className="workspace-loading-label">正在加载写作工作台...</span>
      <div className="workspace-skeleton-line is-title" aria-hidden="true" />
      <div className="workspace-skeleton-line is-meta" aria-hidden="true" />
      <div className="workspace-skeleton-paper" aria-hidden="true">
        <div className="workspace-skeleton-line is-paragraph" />
        <div className="workspace-skeleton-line is-paragraph is-short" />
        <div className="workspace-skeleton-line is-paragraph" />
      </div>
    </div>
  );
}

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
  const e2ePanelsEnabled = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';
  const visibleActivePanel = isWorkspaceAiPanelRetired(activePanel, e2ePanelsEnabled)
    ? null
    : activePanel;
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [editorActionState, setEditorActionState] = useState<EditorActionState>({
    saving: false,
    adopting: false,
    saveState: 'idle',
    saveMessage: '',
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
    <div className="workspace-page" data-summary-exists={summary.exists ? 'true' : 'false'}>
      <div className="workspace-sidebar">
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
            <BackButton label="返回创作工作台" to="/" />
          </div>
          {activeChapter && (
            <div className="workspace-current-chapter">
              当前：第{activeChapter.chapterNumber}章 {activeChapter.title}
            </div>
          )}
          <div className="workspace-topbar-spacer" aria-hidden="true" />
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

      {summary.dialogOpen && summary.result && (
        <ChapterSummaryDialog
          result={summary.result}
          chapterTitle={activeChapter?.title || ''}
          loading={summary.loading}
          error={summary.error}
          onClose={() => {
            summary.setDialogOpen(false);
            summary.setResult(null);
            summary.setError('');
          }}
          onConfirm={summary.save}
          onRegenerate={summary.regenerate}
        />
      )}

      {summary.loading && !summary.result && (
        <>
          <div className="right-panel-overlay" onClick={summary.stop} />
          <div className="right-panel workspace-summary-panel">
            <div className="right-panel-header">
              <span className="right-panel-title">
                <LoaderCircle
                  className="workspace-spinning-icon"
                  aria-hidden="true"
                  size={16}
                  strokeWidth={1.8}
                />
                <span>生成章节总结</span>
              </span>
              <button
                className="right-panel-close"
                onClick={summary.stop}
                aria-label="停止生成"
                title="停止生成"
              >
                <Square aria-hidden="true" size={13} strokeWidth={1.8} />
              </button>
            </div>
            <div className="right-panel-body">
              <div className="workspace-summary-state">
                AI 正在分析已采用正文，提取关键信息……
                <button className="btn btn-secondary workspace-summary-stop" onClick={summary.stop}>
                  停止总结
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {summary.error && !summary.dialogOpen && (
        <>
          <div className="right-panel-overlay" onClick={() => summary.setError('')} />
          <div className="right-panel workspace-summary-panel">
            <div className="right-panel-header">
              <span className="right-panel-title">
                <CircleAlert aria-hidden="true" size={16} strokeWidth={1.8} />
                <span>总结失败</span>
              </span>
              <button
                className="right-panel-close"
                onClick={() => summary.setError('')}
                aria-label="关闭错误"
                title="关闭"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            </div>
            <div className="right-panel-body">
              <div className="workspace-summary-error">{summary.error}</div>
              <div className="workspace-summary-actions">
                <button className="btn btn-primary btn-sm" onClick={summary.regenerate}>
                  <RefreshCw aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>重试</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

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
