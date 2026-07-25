import './services/tauri/e2eBridge';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import ToastProvider from './components/ToastProvider';
import { generationJobService } from './services/generation/generationJobService';
import { legacyChapterContextMigrationService } from './services/context/legacyChapterContextMigrationService';
import { tauriInvoke } from './services/tauri/runtime';
import { describeUnknownError } from './utils/errorMessage';
import './styles/variables.css';
import './styles/global.css';

performance.mark('app-script-start');

const startupScriptStartedAt = performance.now();
const MIN_STARTUP_SPLASH_MS = 700;
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
  const scriptStart = get('app-script-start');
  const reactMounted = get('react-mounted');
  const firstReady = get('first-page-ready');
  console.info(`[Startup] script start -> React mounted: ${Math.round(reactMounted - scriptStart)} ms`);
  console.info(`[Startup] React mounted -> first page ready: ${Math.round(firstReady - reactMounted)} ms`);
  console.info(`[Startup] total startup: ${Math.round(firstReady - scriptStart)} ms`);
}

function hideStartupSplash() {
  const splash = document.getElementById('startup-splash');
  if (!splash) return;
  splash.classList.add('is-hidden');
  window.setTimeout(() => splash.remove(), STARTUP_SPLASH_FADE_MS);
}

function scheduleHideStartupSplash() {
  const elapsed = performance.now() - startupScriptStartedAt;
  const delay = Math.max(0, MIN_STARTUP_SPLASH_MS - elapsed);
  window.setTimeout(hideStartupSplash, delay);
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

async function bootstrapApplication() {
  let startupContextMigration;
  try {
    startupContextMigration = await legacyChapterContextMigrationService.migrate();
  } catch (error) {
    const message = describeUnknownError(error, '旧章节上下文迁移失败');
    console.error('[STARTUP_CONTEXT_MIGRATION_FAILED]', { message });
    startupContextMigration = {
      performed: false,
      chapterSummaries: { inserted: 0, matched: 0, skipped: 0 },
      contextRecords: { inserted: 0, matched: 0, skipped: 0 },
      characterStates: { inserted: 0, matched: 0, skipped: 0 },
      idMap: {},
      warnings: [],
      localRecordsRemoved: { chapterSummaries: 0, contextRecords: 0, characterStates: 0 },
      error: message,
    };
  }

  let startupRecovery;
  try {
    startupRecovery = await generationJobService.recoverInterruptedAtStartup();
  } catch (error) {
    const message = describeUnknownError(error, '生成任务恢复检查失败');
    console.error('[STARTUP_TASK_RECOVERY_FAILED]', { message });
    startupRecovery = {
      recoveredJobs: 0,
      recoveredAt: new Date().toISOString(),
      error: message,
    };
  }

  markStartup('react-before-render');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <ToastProvider>
          <App
            startupRecovery={startupRecovery}
            startupContextMigration={startupContextMigration}
          />
        </ToastProvider>
      </HashRouter>
    </React.StrictMode>,
  );

  requestAnimationFrame(() => {
    markStartup('react-mounted');
    requestAnimationFrame(() => {
      markStartup('first-page-ready');
      scheduleHideStartupSplash();
      logStartupTimings();
    });
  });

  void applySystemAccentColor();
}

void bootstrapApplication();
