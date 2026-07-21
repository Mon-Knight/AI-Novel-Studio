import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/common/ErrorBoundary';
import LoadingModal from './components/common/LoadingModal';
import { useGlobalLoadingModal } from './lib/runWithLoading';
import HomePage from './pages/Home/HomePage';
import NovelDetailPage from './pages/NovelDetail/NovelDetailPage';
import WritingWorkspacePage from './pages/WritingWorkspace/WritingWorkspacePage';
import StyleProfilesPage from './pages/StyleProfiles/StyleProfilesPage';
import SettingsPage from './pages/Settings/SettingsPage';
import ComingSoonPage from './pages/ComingSoon/ComingSoonPage';
import NotFoundPage from './pages/NotFound/NotFoundPage';
import AssetsPage from './pages/Assets/AssetsPage';
import TemplatesPage from './pages/Templates/TemplatesPage';
import AiTasksPage from './pages/AiTasks/AiTasksPage';
import ImportExportPage from './pages/ImportExport/ImportExportPage';
import OutlineEditorPage from './pages/OutlineEditor/OutlineEditorPage';
import SettingSuggestionsPage from './pages/SettingSuggestions/SettingSuggestionsPage';
import E2eDialogHost from './components/common/E2eDialogHost';
import StartupRecoveryDialog, { type StartupRecoveryState } from './components/common/StartupRecoveryDialog';

interface AppProps {
  startupRecovery: StartupRecoveryState;
}

function App({ startupRecovery }: AppProps) {
  const globalLoading = useGlobalLoadingModal(1200);

  return (
    <ErrorBoundary>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/novels/:novelId" element={<NovelDetailPage />} />
          <Route path="/novels/:novelId/workspace" element={<WritingWorkspacePage />} />
          <Route path="/styles" element={<StyleProfilesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/ai-tasks" element={<AiTasksPage />} />
          <Route path="/import-export" element={<ImportExportPage />} />
          <Route path="/novels/:novelId/outline" element={<OutlineEditorPage />} />
          <Route path="/novels/:novelId/setting-suggestions" element={<SettingSuggestionsPage />} />
          <Route path="/worlds/:worldId/lore/suggestions" element={<SettingSuggestionsPage />} />
          <Route path="/coming-soon" element={<ComingSoonPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
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
    </ErrorBoundary>
  );
}

export default App;
