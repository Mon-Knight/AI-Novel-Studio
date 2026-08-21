import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/common/ErrorBoundary';
import LoadingModal from './components/common/LoadingModal';
import { useGlobalLoadingModal } from './lib/runWithLoading';
import E2eDialogHost from './components/common/E2eDialogHost';
import StartupRecoveryDialog, {
  type StartupRecoveryState,
} from './components/common/StartupRecoveryDialog';
import StartupContextMigrationDialog, {
  type StartupContextMigrationState,
} from './components/common/StartupContextMigrationDialog';

const NovelDetailPage = lazy(() => import('./pages/NovelDetail/NovelDetailPage'));
const HomePage = lazy(() => import('./pages/Home/HomePage'));
const WorkbenchPage = lazy(() => import('./pages/Workbench/WorkbenchPage'));
const WritingWorkspacePage = lazy(() => import('./pages/WritingWorkspace/WritingWorkspacePage'));
const StyleProfilesPage = lazy(() => import('./pages/StyleProfiles/StyleProfilesPage'));
const ReferenceLibraryPage = lazy(() => import('./pages/ReferenceLibrary/ReferenceLibraryPage'));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage'));
const ComingSoonPage = lazy(() => import('./pages/ComingSoon/ComingSoonPage'));
const NotFoundPage = lazy(() => import('./pages/NotFound/NotFoundPage'));
const AssetsPage = lazy(() => import('./pages/Assets/AssetsPage'));
const TemplatesPage = lazy(() => import('./pages/Templates/TemplatesPage'));
const AiTasksPage = lazy(() => import('./pages/AiTasks/AiTasksPage'));
const ImportExportPage = lazy(() => import('./pages/ImportExport/ImportExportPage'));
const OutlineEditorPage = lazy(() => import('./pages/OutlineEditor/OutlineEditorPage'));
const SettingSuggestionsPage = lazy(
  () => import('./pages/SettingSuggestions/SettingSuggestionsPage'),
);
const AutonomousPlanningPage = lazy(
  () => import('./pages/AutonomousPlanning/AutonomousPlanningPage'),
);
const StoryAssetsPage = lazy(() => import('./pages/StoryAssets/StoryAssetsPage'));

interface AppProps {
  startupRecovery: StartupRecoveryState;
  startupContextMigration: StartupContextMigrationState;
}

function App({ startupRecovery, startupContextMigration }: AppProps) {
  const globalLoading = useGlobalLoadingModal(1200);

  return (
    <ErrorBoundary>
      <AppShell>
        <Suspense
          fallback={
            <div className="page-loading" role="status">
              正在加载页面…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<WorkbenchPage />} />
            <Route path="/novels" element={<HomePage />} />
            <Route path="/novels/:novelId" element={<NovelDetailPage />} />
            <Route path="/novels/:novelId/workspace" element={<WritingWorkspacePage />} />
            <Route path="/novels/:novelId/references" element={<ReferenceLibraryPage />} />
            <Route path="/novels/:novelId/story-assets" element={<StoryAssetsPage />} />
            <Route path="/styles" element={<StyleProfilesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/assets" element={<AssetsPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/ai-tasks" element={<AiTasksPage />} />
            <Route path="/import-export" element={<ImportExportPage />} />
            <Route path="/novels/:novelId/outline" element={<OutlineEditorPage />} />
            <Route
              path="/novels/:novelId/setting-suggestions"
              element={<SettingSuggestionsPage />}
            />
            <Route
              path="/novels/:novelId/autonomous-planning"
              element={<AutonomousPlanningPage />}
            />
            <Route path="/worlds/:worldId/lore/suggestions" element={<SettingSuggestionsPage />} />
            <Route path="/coming-soon" element={<ComingSoonPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppShell>

      {/* 全局加载弹窗 */}
      <LoadingModal
        open={globalLoading.open}
        state={globalLoading.state}
        title={globalLoading.title}
        message={globalLoading.message}
        stage={globalLoading.stage}
        percent={globalLoading.percent}
        cancelable={globalLoading.cancelable}
        errorMessage={globalLoading.errorMessage}
        autoCloseMs={1200}
        onCancel={globalLoading.onCancel}
        onClose={globalLoading.closeModal}
        onRetry={globalLoading.onRetry}
      />
      <E2eDialogHost />
      <StartupRecoveryDialog recovery={startupRecovery} />
      <StartupContextMigrationDialog migration={startupContextMigration} />
    </ErrorBoundary>
  );
}

export default App;
