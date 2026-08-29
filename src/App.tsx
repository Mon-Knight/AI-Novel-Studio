import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useReducer,
  useSyncExternalStore,
} from 'react';
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
import StartupConversationRecoveryDialog, {
  type StartupConversationRecoveryState,
} from './components/common/StartupConversationRecoveryDialog';
import WorkbenchRouteFallback from './pages/Workbench/WorkbenchRouteFallback';
import {
  startupCoordinator as defaultStartupCoordinator,
  type StartupCoordinator,
  type StartupSnapshot,
} from './services/startup/startupCoordinator';

const NovelDetailPage = lazy(() => import('./pages/NovelDetail/NovelDetailPage'));
const WorkbenchPage = lazy(() => import('./pages/Workbench/WorkbenchPage'));
const HomePage = lazy(() => import('./pages/Home/HomePage'));
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

type StartupDialogKind = 'conversationRecovery' | 'recovery' | 'contextMigration';

interface StartupDialogQueueState {
  active: StartupDialogKind | null;
  pending: StartupDialogKind[];
  seen: Record<StartupDialogKind, boolean>;
}

type StartupDialogQueueAction =
  { type: 'enqueue'; kind: StartupDialogKind } | { type: 'dismiss'; kind: StartupDialogKind };

const INITIAL_STARTUP_DIALOG_QUEUE: StartupDialogQueueState = {
  active: null,
  pending: [],
  seen: { conversationRecovery: false, recovery: false, contextMigration: false },
};

function startupDialogQueueReducer(
  state: StartupDialogQueueState,
  action: StartupDialogQueueAction,
): StartupDialogQueueState {
  if (action.type === 'enqueue') {
    if (state.seen[action.kind]) return state;
    const seen = { ...state.seen, [action.kind]: true };
    if (!state.active) return { ...state, active: action.kind, seen };
    return { ...state, pending: [...state.pending, action.kind], seen };
  }

  if (state.active !== action.kind) return state;
  return {
    ...state,
    active: state.pending[0] ?? null,
    pending: state.pending.slice(1),
  };
}

export interface AppProps {
  startupCoordinator?: StartupCoordinator;
  onShellReady?: () => void;
}

const EMPTY_RECOVERY: StartupRecoveryState = {
  recoveredJobs: 0,
  recoveredAt: '',
};

const EMPTY_CONVERSATION_RECOVERY: StartupConversationRecoveryState = {
  recoveredRuns: 0,
};

const EMPTY_CONTEXT_MIGRATION: StartupContextMigrationState = {
  performed: false,
  chapterSummaries: { inserted: 0, matched: 0, skipped: 0 },
  contextRecords: { inserted: 0, matched: 0, skipped: 0 },
  characterStates: { inserted: 0, matched: 0, skipped: 0 },
  idMap: {},
  warnings: [],
  localRecordsRemoved: { chapterSummaries: 0, contextRecords: 0, characterStates: 0 },
};

function recoveryDialogState(snapshot: StartupSnapshot): StartupRecoveryState {
  const task = snapshot.generationRecovery;
  if (task.status === 'succeeded' && task.result) return task.result;
  if (task.status === 'failed') return { ...EMPTY_RECOVERY, error: task.error };
  return EMPTY_RECOVERY;
}

function conversationRecoveryDialogState(
  snapshot: StartupSnapshot,
): StartupConversationRecoveryState {
  const task = snapshot.conversationRecovery;
  if (task.status === 'succeeded' && task.result) return task.result;
  if (task.status === 'failed') return { ...EMPTY_CONVERSATION_RECOVERY, error: task.error };
  return EMPTY_CONVERSATION_RECOVERY;
}

function contextMigrationDialogState(snapshot: StartupSnapshot): StartupContextMigrationState {
  const task = snapshot.contextMigration;
  if (task.status === 'succeeded' && task.result) return task.result;
  if (task.status === 'failed') return { ...EMPTY_CONTEXT_MIGRATION, error: task.error };
  return EMPTY_CONTEXT_MIGRATION;
}

function shouldQueueRecoveryDialog(recovery: StartupRecoveryState): boolean {
  return recovery.recoveredJobs > 0 || Boolean(recovery.error);
}

function shouldQueueConversationRecoveryDialog(
  recovery: StartupConversationRecoveryState,
): boolean {
  return recovery.recoveredRuns > 0 || Boolean(recovery.error);
}

function shouldQueueContextMigrationDialog(migration: StartupContextMigrationState): boolean {
  const migrated =
    migration.chapterSummaries.inserted +
    migration.chapterSummaries.matched +
    migration.contextRecords.inserted +
    migration.contextRecords.matched +
    migration.characterStates.inserted +
    migration.characterStates.matched;
  return (
    Boolean(migration.error) ||
    migration.warnings.length > 0 ||
    (migration.performed && migrated > 0)
  );
}

function App({ startupCoordinator = defaultStartupCoordinator, onShellReady }: AppProps) {
  const globalLoading = useGlobalLoadingModal(1200);
  const startupSnapshot = useSyncExternalStore(
    startupCoordinator.subscribe,
    startupCoordinator.getSnapshot,
    startupCoordinator.getSnapshot,
  );
  const startupRecovery = recoveryDialogState(startupSnapshot);
  const startupConversationRecovery = conversationRecoveryDialogState(startupSnapshot);
  const startupContextMigration = contextMigrationDialogState(startupSnapshot);
  const conversationRecoveryNoticeReady = shouldQueueConversationRecoveryDialog(
    startupConversationRecovery,
  );
  const recoveryNoticeReady = shouldQueueRecoveryDialog(startupRecovery);
  const contextMigrationNoticeReady = shouldQueueContextMigrationDialog(startupContextMigration);
  const [startupDialogQueue, dispatchStartupDialog] = useReducer(
    startupDialogQueueReducer,
    INITIAL_STARTUP_DIALOG_QUEUE,
  );

  useLayoutEffect(() => {
    onShellReady?.();
  }, [onShellReady]);

  useEffect(() => {
    if (conversationRecoveryNoticeReady) {
      dispatchStartupDialog({ type: 'enqueue', kind: 'conversationRecovery' });
    }
    if (recoveryNoticeReady) {
      dispatchStartupDialog({ type: 'enqueue', kind: 'recovery' });
    }
    if (contextMigrationNoticeReady) {
      dispatchStartupDialog({ type: 'enqueue', kind: 'contextMigration' });
    }
  }, [contextMigrationNoticeReady, conversationRecoveryNoticeReady, recoveryNoticeReady]);

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
            <Route
              path="/"
              element={
                <Suspense fallback={<WorkbenchRouteFallback />}>
                  <WorkbenchPage />
                </Suspense>
              }
            />
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
      {startupDialogQueue.active === 'conversationRecovery' && (
        <StartupConversationRecoveryDialog
          recovery={startupConversationRecovery}
          onDismiss={() => dispatchStartupDialog({ type: 'dismiss', kind: 'conversationRecovery' })}
        />
      )}
      {startupDialogQueue.active === 'recovery' && (
        <StartupRecoveryDialog
          recovery={startupRecovery}
          onDismiss={() => dispatchStartupDialog({ type: 'dismiss', kind: 'recovery' })}
        />
      )}
      {startupDialogQueue.active === 'contextMigration' && (
        <StartupContextMigrationDialog
          migration={startupContextMigration}
          onDismiss={() => dispatchStartupDialog({ type: 'dismiss', kind: 'contextMigration' })}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
