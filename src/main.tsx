import '@/services/tauri/e2eBridge';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import ToastProvider from './components/ToastProvider';
import { tauriInvoke } from './services/tauri/runtime';
import { describeUnknownError } from './utils/errorMessage';
import { initializeTheme } from './store/themeStore';
import { appLogger, installGlobalErrorHandlers } from './services/observability/appLogger';
import { startupCoordinator } from './services/startup/startupCoordinator';
import { restoreSessionModelCredentialsFromNative } from './services/ai/aiSettingsStore';
import './styles/variables.css';
import './styles/global.css';
import './styles/theme.css';

performance.mark('app-script-start');
initializeTheme();
installGlobalErrorHandlers();

const STARTUP_SPLASH_FADE_MS = 220;

function markStartup(name: string) {
  performance.mark(name);
}

function logStartupTimings() {
  if (!import.meta.env.DEV) return;
  const get = (name: string) => {
    const entries = performance.getEntriesByName(name);
    return entries.length > 0 ? entries[entries.length - 1].startTime : 0;
  };
  const htmlStart = get('app-html-start');
  const scriptStart = get('app-script-start');
  const shellReady = get('react-shell-ready');
  appLogger.info(
    `[Startup] HTML start -> React shell ready: ${Math.round(shellReady - htmlStart)} ms`,
  );
  appLogger.info(
    `[Startup] script start -> React shell ready: ${Math.round(shellReady - scriptStart)} ms`,
  );
  appLogger.info(`[Startup] visible shell startup: ${Math.round(shellReady - scriptStart)} ms`);
}

function hideStartupSplash() {
  const splash = document.getElementById('startup-splash');
  if (!splash) return;
  markStartup('startup-splash-hide-requested');
  splash.classList.add('is-hidden');
  window.setTimeout(() => {
    splash.remove();
    markStartup('startup-splash-removed');
  }, STARTUP_SPLASH_FADE_MS);
}

// Native Feel P1: 禁用 WebView 默认右键菜单（保留输入框和编辑区的原生右键）
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;

  const allowNativeTextMenu =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable === true ||
    target?.closest('[data-allow-context-menu]') !== null;

  if (!allowNativeTextMenu) {
    event.preventDefault();
  }
});

// Native Feel P2: 读取系统强调色并写入 CSS 变量
async function applySystemAccentColor() {
  try {
    const accent = await tauriInvoke<string | null>('get_system_accent_color');
    if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
      document.documentElement.style.setProperty('--color-accent', accent);
      document.documentElement.style.setProperty('--color-focus-ring', accent);
      // 仅当 accent 与默认色不同时覆盖 primary（保留用户认知中的品牌色）
      document.documentElement.style.setProperty('--color-primary', accent);
      document.documentElement.style.setProperty('--color-primary-hover', accent + 'cc');
    }
  } catch {
    // 静默回退：保留 variables.css 中定义的默认颜色
  }
}

function createAppRouter() {
  // Keep hash-based desktop URLs while opting into React Router's data-router
  // transition coordinator. The workspace Leave Guard relies on its blocker to
  // cover Link, navigate(), browser history and direct hash transitions.
  return createHashRouter([
    {
      path: '*',
      element: (
        <ToastProvider>
          <App startupCoordinator={startupCoordinator} onShellReady={handleShellReady} />
        </ToastProvider>
      ),
    },
  ]);
}

function startAutonomousSchedulerRecovery(): void {
  void import('./services/autonomous-creation/autonomousSchedulerWorker')
    .then(({ autonomousSchedulerWorker }) => autonomousSchedulerWorker.recoverStartup())
    .catch((error: unknown) => {
      appLogger.error('[STARTUP_AUTONOMOUS_RECOVERY_FAILED]', {
        message: describeUnknownError(error, '自主创作调度恢复失败'),
      });
    });
}

let shellReadyReported = false;

function handleShellReady(): void {
  if (shellReadyReported) return;
  shellReadyReported = true;
  markStartup('react-mounted');
  markStartup('react-shell-ready');
  hideStartupSplash();
  logStartupTimings();
  window.setTimeout(startAutonomousSchedulerRecovery, 0);
}

function bootstrapApplication() {
  // Establish recovery gates synchronously, while every recovery task itself
  // remains asynchronous and does not delay the first React render.
  void startupCoordinator.start();
  void restoreSessionModelCredentialsFromNative().catch(() => {
    appLogger.warn('[SESSION_CREDENTIAL_RESTORE_FAILED]');
  });
  const router = createAppRouter();
  markStartup('react-before-render');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );

  void applySystemAccentColor();
}

void bootstrapApplication();
