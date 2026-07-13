import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/common/ErrorBoundary';
import LoadingModal from './components/common/LoadingModal';
import { useGlobalLoadingModal } from './lib/runWithLoading';
import HomePage from './pages/Home/HomePage';

const NovelDetailPage = lazy(() => import('./pages/NovelDetail/NovelDetailPage'));
const WritingWorkspacePage = lazy(() => import('./pages/WritingWorkspace/WritingWorkspacePage'));
const StyleProfilesPage = lazy(() => import('./pages/StyleProfiles/StyleProfilesPage'));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage'));
const ComingSoonPage = lazy(() => import('./pages/ComingSoon/ComingSoonPage'));
const NotFoundPage = lazy(() => import('./pages/NotFound/NotFoundPage'));
const AssetsPage = lazy(() => import('./pages/Assets/AssetsPage'));
const TemplatesPage = lazy(() => import('./pages/Templates/TemplatesPage'));
const AiTasksPage = lazy(() => import('./pages/AiTasks/AiTasksPage'));
const ImportExportPage = lazy(() => import('./pages/ImportExport/ImportExportPage'));
const OutlineEditorPage = lazy(() => import('./pages/OutlineEditor/OutlineEditorPage'));
const SettingSuggestionsPage = lazy(() => import('./pages/SettingSuggestions/SettingSuggestionsPage'));
const CreativeIntentPage = lazy(() => import('./pages/CreativeIntent/CreativeIntentPage'));

function RouteLoadingState() {
  return (
    <div className="route-loading-state" role="status" aria-live="polite">
      <span className="route-loading-spinner" aria-hidden="true" />
      <span>正在打开页面…</span>
    </div>
  );
}

function App() {
  const globalLoading = useGlobalLoadingModal(1200);

  return (
    <ErrorBoundary>
      <AppShell>
        <Suspense fallback={<RouteLoadingState />}>
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
            <Route path="/novels/:novelId/creative-intent" element={<CreativeIntentPage />} />
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
    </ErrorBoundary>
  );
}

export default App;
