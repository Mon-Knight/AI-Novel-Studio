import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/settings',
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { MemoryRouter } = await import('react-router-dom');

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
});

const pageModule = (await vite.ssrLoadModule(
  '/src/pages/Settings/SettingsPage.tsx',
)) as typeof import('./SettingsPage');
const SettingsPage = pageModule.default;

const { act, cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');

afterEach(() => cleanup());
after(async () => {
  await vite.close();
  dom.window.close();
});

test('SettingsPage: 桌面级左侧分类导航与面板动态切换', async () => {
  await act(async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
  });

  // 1. 验证基础布局与 5 大分类导航
  await waitFor(() => {
    assert.ok(screen.getByTestId('settings-layout'));
    assert.ok(screen.getByTestId('settings-sidebar'));
    assert.ok(screen.getByTestId('settings-nav-general'));
    assert.ok(screen.getByTestId('settings-nav-ai_models'));
    assert.ok(screen.getByTestId('settings-nav-governance'));
    assert.ok(screen.getByTestId('settings-nav-data'));
    assert.ok(screen.getByTestId('settings-nav-diagnostics'));
  });

  // 2. 默认分类为常规与外观 (general)
  assert.ok(screen.getByTestId('settings-tab-pane-general'));

  // 3. 切换至 AI 模型分类 (ai_models)
  await act(async () => {
    fireEvent.click(screen.getByTestId('settings-nav-ai_models'));
  });

  await waitFor(() => {
    assert.ok(screen.getByTestId('settings-tab-pane-ai-models'));
    assert.ok(screen.getByTestId('ai-runtime-overview-card'));
    assert.ok(screen.getByTestId('runtime-cloud-status'));
    assert.ok(screen.getByTestId('runtime-local-status'));
    assert.ok(screen.getByTestId('runtime-gateway-status'));
    assert.ok(screen.getByTestId('runtime-agent-status'));
  });

  // 4. 切换至网关与治理分类 (governance)
  await act(async () => {
    fireEvent.click(screen.getByTestId('settings-nav-governance'));
  });

  await waitFor(() => {
    assert.ok(screen.getByTestId('settings-tab-pane-governance'));
    assert.ok(screen.getByTestId('settings-security-card'));
  });

  // 5. 切换至数据与存储分类 (data)
  await act(async () => {
    fireEvent.click(screen.getByTestId('settings-nav-data'));
  });

  await waitFor(() => {
    assert.ok(screen.getByTestId('settings-tab-pane-data'));
    assert.ok(screen.getByTestId('settings-data-storage-card'));
    assert.ok(screen.getByTestId('settings-repair-data-btn'));
  });

  // 6. 切换至诊断与关于分类 (diagnostics)
  await act(async () => {
    fireEvent.click(screen.getByTestId('settings-nav-diagnostics'));
  });

  await waitFor(() => {
    assert.ok(screen.getByTestId('settings-tab-pane-diagnostics'));
    assert.ok(screen.getByTestId('settings-about-card'));
  });
});

test('SettingsPage keeps session API keys fixed to their exact model identity', async () => {
  localStorage.removeItem('ai_novel_studio_ai_settings');
  await act(async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId('settings-nav-ai_models'));
  });
  const mockMode = screen.getByRole('checkbox', { name: /Mock 模式/ });
  await act(async () => {
    fireEvent.click(mockMode);
  });

  const baseUrl = screen.getByPlaceholderText(/api\.deepseek\.com\/v1/) as HTMLInputElement;
  const apiKey = screen.getByPlaceholderText('sk-...') as HTMLInputElement;
  const modelName = screen.getByPlaceholderText(
    '例如：deepseek-chat / deepseek-reasoner',
  ) as HTMLInputElement;
  const saveProvider = screen.getAllByRole('button', { name: /保存设置/ })[0];
  assert.ok(saveProvider);

  await act(async () => {
    fireEvent.change(baseUrl, { target: { value: 'https://session-provider.invalid/v1' } });
    fireEvent.change(modelName, { target: { value: 'session-model-a' } });
    fireEvent.change(apiKey, { target: { value: 'session-key-model-a' } });
    fireEvent.click(saveProvider);
  });
  await waitFor(() => assert.equal(apiKey.value, 'session-key-model-a'));

  const persistedA = localStorage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(persistedA.includes('session-key-model-a'), false);
  assert.equal(persistedA.includes('apiKey'), false);

  await act(async () => {
    fireEvent.change(modelName, { target: { value: 'session-model-b' } });
  });
  assert.equal(apiKey.value, '');

  await act(async () => {
    fireEvent.change(apiKey, { target: { value: 'session-key-model-b' } });
    fireEvent.click(saveProvider);
  });
  await waitFor(() => assert.equal(apiKey.value, 'session-key-model-b'));

  const persistedB = localStorage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(persistedB.includes('session-key-model-a'), false);
  assert.equal(persistedB.includes('session-key-model-b'), false);
  assert.equal(persistedB.includes('apiKey'), false);

  await act(async () => {
    fireEvent.change(modelName, { target: { value: 'session-model-a' } });
  });
  assert.equal(apiKey.value, 'session-key-model-a');
});
