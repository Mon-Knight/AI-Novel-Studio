import {
  useCallback,
  useMemo,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { NavigateFunction } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import ChapterSummaryDialog from '../../components/chapter-summary/ChapterSummaryDialog';
import DraftHistoryPanel from '../../components/right-dock/panels/DraftHistoryPanel';
import RightPanel from '../../components/right-dock/RightPanel';
import RightToolbar from '../../components/right-dock/RightToolbar';
import EditorArea, {
  type EditorAreaHandle,
  type EditorContentSnapshot,
} from '../../components/workspace/EditorArea';
import GlobalAiTaskModal from '../../components/workspace/GlobalAiTaskModal';
import RecoveryDialog from '../../components/workspace/RecoveryDialog';
import StatusBar from '../../components/workspace/StatusBar';
import VolumeTree from '../../components/workspace/VolumeTree';
import type { useWorkspaceChapterLoader } from '../../features/workspace/useWorkspaceChapterLoader';
import type { useWorkspaceCreationActions } from '../../features/workspace/useWorkspaceCreationActions';
import type { useWorkspaceDraftApplication } from '../../features/workspace/useWorkspaceDraftApplication';
import type { useWorkspaceRecoveryActions } from '../../features/workspace/useWorkspaceRecoveryActions';
import type { useWorkspaceSummary } from '../../features/workspace/useWorkspaceSummary';
import type { PanelToolState, RightSidebarState } from '../../store/rightSidebarStore';
import type { WorkspaceSessionState } from '../../store/workspaceSessionStore';
import type { QualityCheckItem, QualityCheckReport } from '../../types/qualityCheck';
import type { PanelType } from '../../types/rightSidebar';
import type {
  RecoveryPromptState,
  WorkspaceRecoverySaveStatus,
} from '../../types/workspaceRecovery';
import { hashTextContent } from '../../utils/contentHash';
import { showInfo } from '../../utils/nativeDialog';
import type { WritingContext } from '../../utils/writingContext';

type ChapterLoader = ReturnType<typeof useWorkspaceChapterLoader>;
type DraftApplication = ReturnType<typeof useWorkspaceDraftApplication>;
type CreationActions = ReturnType<typeof useWorkspaceCreationActions>;
type RecoveryActions = ReturnType<typeof useWorkspaceRecoveryActions>;
type WorkspaceSummary = ReturnType<typeof useWorkspaceSummary>;
type ViewSession = Pick<
  WorkspaceSessionState,
  | 'novel'
  | 'volumes'
  | 'chapters'
  | 'activeChapterId'
  | 'currentDraft'
  | 'editorSnapshot'
  | 'draftWordCount'
  | 'isDirty'
  | 'qcReport'
  | 'qcItems'
  | 'aiModal'
>;

interface WorkspaceViewRefs {
  editor: MutableRefObject<EditorAreaHandle | null>;
  activeChapterId: MutableRefObject<string>;
  editorSnapshot: MutableRefObject<EditorContentSnapshot>;
}

interface WorkspaceViewActions {
  selectChapter(chapterId: string): Promise<void>;
  togglePanel(panel: PanelType): Promise<void>;
  closePanel(): Promise<void>;
  editorClick(event: MouseEvent<HTMLDivElement>): void;
  editorContentChange(snapshot: EditorContentSnapshot): void;
  chapterOutlineApplied(chapterId: string): Promise<void>;
  confirmEditorLeave(): Promise<boolean>;
  openSidebarTool(panel: Exclude<PanelType, null>): void;
  closeSidebar(): void;
  setChapterGoalDirty(dirty: boolean): void;
  bumpContextVersion(): void;
  locateText(start: number, end: number, quote?: string, paragraphIndex?: number): void;
  locateDone(): void;
  setQuality(report: QualityCheckReport | null, items: QualityCheckItem[]): void;
  showAiModal(title: string, subtitle?: string): void;
  updateAiModal(stage: string, progress: number): void;
  hideAiModal(): void;
  updateSidebarTool(toolKey: string, patch: Partial<PanelToolState>): void;
  dismissRecoveryPrompt(): void;
}

interface WritingWorkspaceViewProps {
  novelId?: string;
  navigate: NavigateFunction;
  session: ViewSession;
  sidebarState: RightSidebarState;
  chapterLoader: ChapterLoader;
  draftApplication: DraftApplication;
  creationActions: CreationActions;
  recoveryActions: RecoveryActions;
  summary: WorkspaceSummary;
  recoveryPrompt: RecoveryPromptState;
  recoverySaveStatus: WorkspaceRecoverySaveStatus;
  refs: WorkspaceViewRefs;
  actions: WorkspaceViewActions;
  contextVersion: number;
  locateTarget: {
    startOffset: number;
    endOffset: number;
    quote?: string;
    paragraphIndex?: number;
  } | null;
  writingContext: WritingContext;
  leaveGuardDialog: ReactNode;
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
  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === activeChapterId),
    [activeChapterId, chapters],
  );
  const activeDraft = currentDraft?.chapterId === activeChapterId ? currentDraft : null;
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
      className={`workspace-page${!isChapterDocumentBlocked && activePanel && activePanel !== 'draft-history' ? ' has-right-panel' : ''}`}
      data-summary-exists={summary.exists ? 'true' : 'false'}
    >
      {pageLoading && (
        <div className="workspace-full-state">
          <div className="workspace-full-state-content workspace-muted">
            <div className="workspace-state-icon">⏳</div>
            <div>正在加载写作工作台...</div>
          </div>
        </div>
      )}
      {pageError && !pageLoading && (
        <div className="workspace-full-state">
          <div className="workspace-full-state-content">
            <div className="workspace-state-icon">❌</div>
            <div className="workspace-error-message">{pageError}</div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/novels/${novelId}`)}
            >
              ← 返回作品详情
            </button>
          </div>
        </div>
      )}
      {loadState === 'novel_not_found' && !pageLoading && (
        <div className="workspace-full-state">
          <div className="workspace-full-state-content">
            <div className="workspace-empty-icon">📖</div>
            <div className="workspace-muted workspace-state-copy">作品不存在或本地数据已损坏</div>
            <div className="workspace-state-actions">
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}>
                ← 返回首页
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings')}>
                🔧 修复本地数据
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="workspace-sidebar">
        <div className="workspace-sidebar-header">
          <BackButton label="返回作品详情" to={`/novels/${novelId}`} />
        </div>
        {novel && <div className="workspace-novel-title">📖 {novel.title}</div>}
        {novelId && (
          <VolumeTree
            volumes={volumes}
            chapters={chapters}
            activeChapterId={activeChapterId}
            loading={pageLoading}
            onSelectChapter={actions.selectChapter}
            onCreateVolume={creationActions.handleCreateVolume}
            onCreateChapter={creationActions.handleCreateChapter}
            onCreateFirstChapter={creationActions.handleCreateFirstChapter}
          />
        )}
      </div>

      <div className="workspace-editor" onClick={actions.editorClick}>
        <GlobalAiTaskModal state={aiModal} />
        <div className="workspace-topbar">
          <div className="workspace-topbar-title">
            <BackButton label="返回作品" to={`/novels/${novelId}`} />
            <span>{novel?.title || '未选择作品'}</span>
          </div>
          {activeChapter && (
            <div className="workspace-current-chapter">
              当前：第{activeChapter.chapterNumber}章 {activeChapter.title}
            </div>
          )}
          <div className="workspace-topbar-spacer" aria-hidden="true" />
        </div>

        {loadState === 'ready' && chapters.length === 0 && !pageLoading ? (
          <div data-testid="workspace-empty-state" className="workspace-empty-state">
            <div className="workspace-empty-content">
              <div className="workspace-empty-icon">📝</div>
              <div className="workspace-empty-title">当前作品还没有章节</div>
              <div className="workspace-empty-copy">你可以在左侧目录先创建分卷，再创建第一章。</div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate(`/novels/${novelId}`)}
              >
                ← 返回作品详情
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
              onOpenDraftHistory={() => actions.openSidebarTool('draft-history')}
              onBackToChapters={() => navigate(`/novels/${novelId}`)}
            />
            <StatusBar
              chapter={activeChapter}
              draftWordCount={draftWordCount}
              isDirty={isDirty}
              draftVersion={activeDraft ? `v${activeDraft.versionNo}` : 'v0 占位'}
              contentAvailable={contentAvailable}
              recoverySaveStatus={recoverySaveStatus}
            />
          </>
        )}
      </div>

      <RightToolbar
        activePanel={activePanel}
        onTogglePanel={actions.togglePanel}
        onRunCommand={runEditorCommand}
        documentAvailable={contentAvailable}
      />

      {!isChapterDocumentBlocked && activePanel === 'draft-history' && (
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

      {!isChapterDocumentBlocked && (
        <RightPanel
          panelType={activePanel === 'draft-history' ? null : activePanel}
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
              <span className="right-panel-title">⏳ 生成章节总结</span>
              <button className="right-panel-close" onClick={summary.stop} title="停止生成">
                ■
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
              <span className="right-panel-title">❌ 总结失败</span>
              <button className="right-panel-close" onClick={() => summary.setError('')}>
                ✕
              </button>
            </div>
            <div className="right-panel-body">
              <div className="workspace-summary-error">{summary.error}</div>
              <div className="workspace-summary-actions">
                <button className="btn btn-primary btn-sm" onClick={summary.regenerate}>
                  🔄 重试
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
