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

const { act, cleanup, fireEvent, render, screen, waitFor, within } =
  await import('@testing-library/react');

const AI_SETTINGS_STORAGE_KEY = 'ai_novel_studio_ai_settings';

function readStoredSettings(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
    string,
    unknown
  >;
}

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
  const temperature = screen.getByLabelText('温度参数') as HTMLInputElement;
  const maxTokens = screen.getByLabelText('最大输出 Token') as HTMLInputElement;
  const timeoutSeconds = screen.getByLabelText('超时时间（秒）') as HTMLInputElement;
  const saveProvider = screen.getAllByRole('button', { name: /保存设置/ })[0];
  assert.ok(saveProvider);

  await act(async () => {
    fireEvent.change(baseUrl, { target: { value: 'https://session-provider.invalid/v1' } });
    fireEvent.change(modelName, { target: { value: 'session-model-a' } });
    fireEvent.change(apiKey, { target: { value: 'session-key-model-a' } });
    fireEvent.change(temperature, { target: { value: '0.5' } });
    fireEvent.change(maxTokens, { target: { value: '12000' } });
    fireEvent.change(timeoutSeconds, { target: { value: '600' } });
    fireEvent.click(saveProvider);
  });
  await waitFor(() => assert.equal(apiKey.value, 'session-key-model-a'));

  const persistedA = localStorage.getItem('ai_novel_studio_ai_settings') ?? '';
  assert.equal(persistedA.includes('session-key-model-a'), false);
  assert.equal(persistedA.includes('apiKey'), false);
  const parsedA = JSON.parse(persistedA) as Record<string, unknown>;
  assert.equal(parsedA.temperature, 0.5);
  assert.equal(parsedA.maxTokens, 12000);
  assert.equal(parsedA.timeoutSeconds, 600);

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

test('SettingsPage keeps an active saved model when governance settings are saved', async () => {
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
  await waitFor(() => assert.ok(screen.getByTestId('settings-tab-pane-ai-models')));
  await act(async () => {
    fireEvent.click(screen.getByRole('checkbox', { name: /Mock 模式/ }));
  });

  await act(async () => {
    const editor = screen.getByTestId('ai-api-model-editor');
    const provider = editor.querySelector('#saved-api-model-provider');
    const baseUrl = editor.querySelector('#saved-api-model-url');
    const modelName = editor.querySelector('#saved-api-model-name');
    const maxTokens = editor.querySelector('#saved-api-model-max-tokens');
    const timeoutSeconds = editor.querySelector('#saved-api-model-timeout');
    const apiKey = editor.querySelector('#saved-api-model-key');
    assert.ok(provider && baseUrl && modelName && maxTokens && timeoutSeconds && apiKey);
    fireEvent.change(provider, {
      target: { value: 'openai_compatible' },
    });
    fireEvent.change(baseUrl, {
      target: { value: 'http://localhost:12074/v1' },
    });
    fireEvent.change(modelName, {
      target: { value: 'gpt-5.6-luna' },
    });
    fireEvent.change(maxTokens, {
      target: { value: '12000' },
    });
    fireEvent.change(timeoutSeconds, {
      target: { value: '600' },
    });
    fireEvent.change(apiKey, {
      target: { value: 'session-only-card-key' },
    });
    fireEvent.click(screen.getByTestId('ai-api-model-save'));
  });

  await waitFor(() => {
    const stored = JSON.parse(
      localStorage.getItem('ai_novel_studio_ai_settings') ?? '{}',
    ) as Record<string, unknown>;
    assert.equal(stored.runtimeMode, 'api');
    assert.equal(stored.provider, 'openai_compatible');
    assert.equal(stored.modelName, 'gpt-5.6-luna');
    assert.equal(stored.maxTokens, 12000);
    assert.equal(stored.timeoutSeconds, 600);
    assert.equal((stored.savedApiModels as unknown[] | undefined)?.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'apiKey'), false);
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId('settings-nav-governance'));
  });
  await waitFor(() => assert.ok(screen.getByTestId('settings-tab-pane-governance')));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存调用保护' }));
  });

  await waitFor(() => {
    const stored = JSON.parse(
      localStorage.getItem('ai_novel_studio_ai_settings') ?? '{}',
    ) as Record<string, unknown>;
    assert.equal(stored.runtimeMode, 'api');
    assert.equal(stored.modelName, 'gpt-5.6-luna');
    assert.equal((stored.savedApiModels as unknown[] | undefined)?.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'apiKey'), false);
  });
});

test('SettingsPage keeps each active model when another saved card is deleted', async () => {
  const cloudProfiles = ['a', 'b', 'c'].map((suffix) => ({
    id: `cloud-${suffix}`,
    label: `Cloud ${suffix.toUpperCase()}`,
    provider: 'openai_compatible',
    baseUrl: `https://cloud-${suffix}.invalid/v1`,
    modelName: `cloud-model-${suffix}`,
    temperature: 0.7,
    maxTokens: 8000,
    timeoutSeconds: 120,
  }));
  const localProfiles = ['a', 'b', 'c'].map((suffix, index) => ({
    id: `local-${suffix}`,
    label: `Local ${suffix.toUpperCase()}`,
    providerId: 'llama.cpp',
    baseUrl: `http://127.0.0.1:${9101 + index}/v1`,
    modelName: `local-model-${suffix}`,
    timeoutSeconds: 120,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.08,
    allowCloudWriterFallback: true,
  }));
  const gatewayProfiles = ['a', 'b', 'c'].map((suffix) => ({
    id: `gateway-${suffix}`,
    label: `Gateway ${suffix.toUpperCase()}`,
    providerId: 'gateway-provider',
    baseUrl: `https://gateway-${suffix}.invalid/v1`,
    modelName: `gateway-model-${suffix}`,
    timeoutSeconds: 120,
    contextTokens: 32000,
    maxTokens: 8000,
    temperature: 0.7,
  }));
  localStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      runtimeMode: 'api',
      mockMode: false,
      provider: cloudProfiles[1]!.provider,
      baseUrl: cloudProfiles[1]!.baseUrl,
      modelName: cloudProfiles[1]!.modelName,
      temperature: cloudProfiles[1]!.temperature,
      maxTokens: cloudProfiles[1]!.maxTokens,
      timeoutSeconds: cloudProfiles[1]!.timeoutSeconds,
      savedApiModels: cloudProfiles,
      activeSavedApiModelId: 'cloud-b',
      localChapterModel: {
        enabled: true,
        providerId: localProfiles[1]!.providerId,
        baseUrl: localProfiles[1]!.baseUrl,
        modelName: localProfiles[1]!.modelName,
        timeoutSeconds: localProfiles[1]!.timeoutSeconds,
        contextTokens: 4096,
        maxTokens: 1024,
        temperature: localProfiles[1]!.temperature,
        topP: localProfiles[1]!.topP,
        topK: localProfiles[1]!.topK,
        repeatPenalty: localProfiles[1]!.repeatPenalty,
        allowCloudWriterFallback: true,
      },
      savedLocalModels: localProfiles,
      activeSavedLocalModelId: 'local-b',
      gateway: {
        enabled: true,
        providerId: gatewayProfiles[1]!.providerId,
        baseUrl: gatewayProfiles[1]!.baseUrl,
        modelName: gatewayProfiles[1]!.modelName,
        timeoutSeconds: gatewayProfiles[1]!.timeoutSeconds,
        contextTokens: gatewayProfiles[1]!.contextTokens,
        maxTokens: gatewayProfiles[1]!.maxTokens,
        temperature: gatewayProfiles[1]!.temperature,
      },
      savedGatewayModels: gatewayProfiles,
      activeSavedGatewayModelId: 'gateway-b',
    }),
  );

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
  await waitFor(() => {
    assert.equal(screen.getAllByTestId('ai-saved-model-card').length, 3);
    assert.equal(screen.getAllByTestId('local-saved-model-card').length, 3);
    assert.equal(screen.getAllByTestId('gateway-saved-model-card').length, 3);
  });

  const deleteCard = async (testId: string, modelId: string) => {
    const card = screen
      .getAllByTestId(testId)
      .find((candidate) => candidate.getAttribute('data-model-id') === modelId);
    assert.ok(card);
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: '删除' }));
    });
  };
  const assertActiveCard = (testId: string, modelId: string) => {
    const card = screen
      .getAllByTestId(testId)
      .find((candidate) => candidate.getAttribute('data-model-id') === modelId);
    assert.ok(card);
    assert.equal(card.getAttribute('data-active'), 'true');
  };

  await deleteCard('ai-saved-model-card', 'cloud-c');
  await waitFor(() => {
    const stored = readStoredSettings();
    assert.equal(stored.activeSavedApiModelId, 'cloud-b');
    assert.equal(stored.baseUrl, cloudProfiles[1]!.baseUrl);
    assert.equal(stored.modelName, cloudProfiles[1]!.modelName);
    assert.deepEqual(
      (stored.savedApiModels as Array<{ id: string }>).map((profile) => profile.id),
      ['cloud-a', 'cloud-b'],
    );
    assertActiveCard('ai-saved-model-card', 'cloud-b');
  });

  await deleteCard('local-saved-model-card', 'local-c');
  await waitFor(() => {
    const stored = readStoredSettings();
    const local = stored.localChapterModel as { baseUrl: string; modelName: string };
    assert.equal(stored.activeSavedLocalModelId, 'local-b');
    assert.equal(local.baseUrl, localProfiles[1]!.baseUrl);
    assert.equal(local.modelName, localProfiles[1]!.modelName);
    assert.deepEqual(
      (stored.savedLocalModels as Array<{ id: string }>).map((profile) => profile.id),
      ['local-a', 'local-b'],
    );
    assertActiveCard('local-saved-model-card', 'local-b');
  });

  await deleteCard('gateway-saved-model-card', 'gateway-c');
  await waitFor(() => {
    const stored = readStoredSettings();
    const gateway = stored.gateway as { baseUrl: string; modelName: string };
    assert.equal(stored.activeSavedGatewayModelId, 'gateway-b');
    assert.equal(gateway.baseUrl, gatewayProfiles[1]!.baseUrl);
    assert.equal(gateway.modelName, gatewayProfiles[1]!.modelName);
    assert.deepEqual(
      (stored.savedGatewayModels as Array<{ id: string }>).map((profile) => profile.id),
      ['gateway-a', 'gateway-b'],
    );
    assertActiveCard('gateway-saved-model-card', 'gateway-b');
  });
});

test('SettingsPage discards a cancelled first model draft before a general save', async () => {
  const localProfile = {
    id: 'cancel-test-local',
    label: 'Cancel test local',
    providerId: 'llama.cpp',
    baseUrl: 'http://127.0.0.1:9191/v1',
    modelName: 'cancel-test-local-model',
    timeoutSeconds: 120,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.08,
    allowCloudWriterFallback: true,
  };
  localStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      runtimeMode: 'api',
      mockMode: false,
      provider: 'openai_compatible',
      baseUrl: '',
      modelName: '',
      savedApiModels: [],
      localChapterModel: {
        enabled: false,
        providerId: localProfile.providerId,
        baseUrl: localProfile.baseUrl,
        modelName: localProfile.modelName,
        timeoutSeconds: localProfile.timeoutSeconds,
        contextTokens: 4096,
        maxTokens: 1024,
        temperature: localProfile.temperature,
        topP: localProfile.topP,
        topK: localProfile.topK,
        repeatPenalty: localProfile.repeatPenalty,
        allowCloudWriterFallback: true,
      },
      savedLocalModels: [localProfile],
      activeSavedLocalModelId: localProfile.id,
    }),
  );
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
  await waitFor(() => assert.ok(screen.getByTestId('ai-api-model-editor')));

  const editor = screen.getByTestId('ai-api-model-editor');
  const label = editor.querySelector('#saved-api-model-label');
  const baseUrl = editor.querySelector('#saved-api-model-url');
  const modelName = editor.querySelector('#saved-api-model-name');
  const apiKey = editor.querySelector('#saved-api-model-key');
  assert.ok(label && baseUrl && modelName && apiKey);
  await act(async () => {
    fireEvent.change(label, { target: { value: 'Cancelled first model' } });
    fireEvent.change(baseUrl, { target: { value: 'https://cancelled.invalid/v1' } });
    fireEvent.change(modelName, { target: { value: 'cancelled-model' } });
    fireEvent.change(apiKey, { target: { value: 'cancelled-session-key' } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('checkbox', { name: /Mock 模式/ }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /启用已通过 Benchmark 的本地 Scene\/Beat 正文模型/,
      }),
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('ai-api-model-cancel'));
  });
  await waitFor(() => assert.equal(screen.queryByTestId('ai-api-model-editor'), null));

  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: '保存设置' })[0]!);
  });
  await waitFor(() => {
    const stored = readStoredSettings();
    const local = stored.localChapterModel as { enabled: boolean };
    assert.equal(stored.runtimeMode, 'mock');
    assert.equal(stored.mockMode, true);
    assert.equal(stored.provider, 'mock');
    assert.equal(local.enabled, true);
    assert.equal(stored.activeSavedLocalModelId, localProfile.id);
    assert.equal(stored.baseUrl, '');
    assert.equal(stored.modelName, '');
    assert.equal(stored.activeSavedApiModelId, undefined);
    assert.deepEqual(stored.savedApiModels, []);
    assert.equal(JSON.stringify(stored).includes('cancelled'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'apiKey'), false);
    assert.match(screen.getByTestId('ai-saved-model-list').textContent ?? '', /还没有保存/);
  });
});
