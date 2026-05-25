import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
