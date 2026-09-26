import type { ComponentProps, ReactNode, RefObject } from 'react';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';
import type { Chapter } from '../../types/chapter';
import type { Novel } from '../../types/novel';
import type { TaskConversation, TaskConversationBundle } from '../../types/conversation';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import type { WorkbenchAssetScopeSummary } from '../../services/conversation/workbenchAssetScopeService';
import { WorkbenchComposer } from './WorkbenchComposer';
import { WorkbenchMessageStream } from './WorkbenchMessageStream';
import { WorkbenchNavigation } from './WorkbenchNavigation';
import { WorkbenchSidePanel } from './WorkbenchSidePanel';
import { WorkbenchRuleChangeReview } from './WorkbenchRuleChangeReview';
import {
  WorkbenchEmptyProjects,
  WorkbenchEmptyTasks,
  WorkbenchFailureState,
  WorkbenchPreparingState,
  WorkbenchStartupHeader,
} from './WorkbenchPageStates';
import { WorkbenchTaskCreator } from './WorkbenchTaskCreator';
import { WorkbenchTaskHeader } from './WorkbenchTaskHeader';
import type { WorkbenchSidePanelState } from './hooks/useWorkbenchSidePanel';
import type { useWorkbenchArtifacts } from './hooks/useWorkbenchArtifacts';

type StreamProps = ComponentProps<typeof WorkbenchMessageStream>;
type ComposerProps = ComponentProps<typeof WorkbenchComposer>;
type NavigationProps = ComponentProps<typeof WorkbenchNavigation>;
type CreatorProps = ComponentProps<typeof WorkbenchTaskCreator>;

export interface WorkbenchPresentationContext {
  novelId: string;
  novelTitle: string;
  chapters: { id: string; title: string }[];
}

interface WorkbenchPageContentProps {
  pageRef: RefObject<HTMLDivElement>;
  focusMode: boolean;
  sidePanel: WorkbenchSidePanelState;
  openReference: WorkbenchSidePanelState['open'];
  toggleSidePanel: () => void;
  toggleFocusMode: () => void;
  composerProps: ComposerProps;
  navigationProps: NavigationProps;
  startupPending: boolean;
  startupFailure: string;
  selectedNovel: Novel | undefined;
  selectedConversation: TaskConversation | undefined;
  novelsEmpty: boolean;
  creatingTask: boolean;
  conversationsLoading: boolean;
  onCreateTask: () => void;
  onOpenLibrary: () => void;
  onRetryStartup: () => void;
  chapters: Chapter[];
  chapterId?: string;
  hasChapter: boolean;
  chaptersLoading: boolean;
  chaptersError: string;
  effectiveStatus: string;
  compressionBusy: boolean;
  bundleReady: boolean;
  bundle: TaskConversationBundle | null | undefined;
  conversationsError: string;
  onSelectChapter: (chapterId: string) => void;
  onCreateChapter: () => void;
  onCompress: () => void;
  streamProps: StreamProps | null;
  onRetryBundle: () => void;
  selectedNovelId: string;
  selectedConversationId: string;
  selectedChapterId?: string;
  plugins: CurrentPluginProjection[];
  pluginsLoading: boolean;
  pluginsError: string;
  assetScope: WorkbenchAssetScopeSummary | null;
  assetScopeLoading: boolean;
  assetScopeError: string;
  onRefreshAssetScope: () => void;
  onOpenAssetScopePath: (path: string) => void;
  onLocateArtifact: (cardId: string) => void;
  artifactActions: ReturnType<typeof useWorkbenchArtifacts>;
  taskCreator: CreatorProps | null;
}

export function WorkbenchPageContent({
  pageRef,
  focusMode,
  sidePanel,
  openReference,
  toggleSidePanel,
  toggleFocusMode,
  composerProps,
  navigationProps,
  startupPending,
  startupFailure,
  selectedNovel,
  selectedConversation,
  novelsEmpty,
  creatingTask,
  conversationsLoading,
  onCreateTask,
  onOpenLibrary,
  onRetryStartup,
  chapters,
  chapterId,
  hasChapter,
  chaptersLoading,
  chaptersError,
  effectiveStatus,
  compressionBusy,
  bundleReady,
  bundle,
  conversationsError,
  onSelectChapter,
  onCreateChapter,
  onCompress,
  streamProps,
  onRetryBundle,
  selectedNovelId,
  selectedConversationId,
  selectedChapterId,
  plugins,
  pluginsLoading,
  pluginsError,
  assetScope,
  assetScopeLoading,
  assetScopeError,
  onRefreshAssetScope,
  onOpenAssetScopePath,
  onLocateArtifact,
  artifactActions,
  taskCreator,
}: WorkbenchPageContentProps) {
  const composer: ReactNode = (
    <WorkbenchComposer {...composerProps} onShowPlugins={() => openReference('plugins')} />
  );
  const ariaBusy =
    startupPending || Boolean(selectedConversation && !bundleReady && !conversationsError);
  return (
    <div
      ref={pageRef}
      className="workbench-page"
      data-testid="creative-workbench"
      data-side-panel={sidePanel.view ?? 'closed'}
      data-panel-intent={sidePanel.view ? sidePanel.presentation : 'closed'}
      data-focus-mode={focusMode ? 'true' : 'false'}
    >
      <WorkbenchNavigation {...navigationProps} />
      <main className="workbench-main agent-console-main" aria-busy={ariaBusy}>
        {startupPending || startupFailure ? (
          <>
            <WorkbenchStartupHeader
              novelTitle={selectedNovel?.title || '创作工作台'}
              failed={Boolean(startupFailure)}
              onShowPlugins={() => openReference('plugins')}
            />
            {startupFailure ? (
              <WorkbenchFailureState message={startupFailure} onRetry={onRetryStartup} />
            ) : (
              <WorkbenchPreparingState label="正在恢复项目与任务…" testId="workbench-loading" />
            )}
            {composer}
          </>
        ) : novelsEmpty ? (
          <WorkbenchEmptyProjects onOpenLibrary={onOpenLibrary} />
        ) : !selectedConversation ? (
          <>
            <WorkbenchEmptyTasks
              creatingTask={creatingTask}
              conversationsLoading={conversationsLoading}
              onCreateTask={onCreateTask}
              onShowPlugins={() => openReference('plugins')}
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
              onSelectChapter={onSelectChapter}
              onCreateChapter={onCreateChapter}
              onCompress={onCompress}
              onShowPlugins={() => openReference('plugins')}
              sidePanelOpen={sidePanel.view !== null}
              sidePanelView={sidePanel.view}
              onToggleSidePanel={toggleSidePanel}
              focusMode={focusMode}
              onToggleFocus={toggleFocusMode}
              onOpenContext={() => openReference('context')}
              onOpenArtifacts={() => openReference('artifacts')}
            />
            <PanelErrorBoundary panelTitle="创作对话">
              {streamProps ? (
                <WorkbenchMessageStream {...streamProps} />
              ) : conversationsError ? (
                <WorkbenchFailureState message={conversationsError} onRetry={onRetryBundle} />
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
          scopeKey={selectedConversationId || selectedNovelId}
          presentation={sidePanel.presentation}
          temporarilyHidden={focusMode && sidePanel.presentation === 'transient'}
          novelId={selectedNovelId}
          chapterId={selectedChapterId}
          bundle={bundleReady ? (bundle ?? null) : null}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          pluginsError={pluginsError}
          assetScope={assetScope}
          assetScopeLoading={assetScopeLoading}
          assetScopeError={assetScopeError}
          onRefreshAssetScope={onRefreshAssetScope}
          onOpenAssetScopePath={onOpenAssetScopePath}
          onOpen={openReference}
          onBack={sidePanel.back}
          onClose={sidePanel.close}
          onTogglePresentation={sidePanel.togglePresentation}
          onLocateArtifact={onLocateArtifact}
        />
      )}
      <WorkbenchRuleChangeReview actions={artifactActions} />
      {taskCreator && selectedNovel && <WorkbenchTaskCreator {...taskCreator} />}
    </div>
  );
}
