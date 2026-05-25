import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { invoke } from '@tauri-apps/api';
import App from './App';
import ToastProvider from './components/ToastProvider';
import './styles/variables.css';
import './styles/global.css';

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
    const accent = await invoke<string | null>('get_system_accent_color');
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

applySystemAccentColor().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </HashRouter>
    </React.StrictMode>,
  );
});
