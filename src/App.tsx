import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/common/ErrorBoundary';
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

function App() {
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
          <Route path="/coming-soon" element={<ComingSoonPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </ErrorBoundary>
  );
}

export default App;
