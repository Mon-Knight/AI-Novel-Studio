import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { AiSettings } from '../../../types/ai';
import type { TaskModelSnapshot } from '../../../types/conversation';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
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

// Import after the DOM shim is installed. This avoids starting a Vite SSR
// server for a small hook test and keeps filtered test runs deterministic.
const hookModule =
  (await import('./useWorkbenchModelCredential')) as typeof import('./useWorkbenchModelCredential');
const settingsModule =
  (await import('../../../services/ai/aiSettingsStore')) as typeof import('../../../services/ai/aiSettingsStore');
const { useWorkbenchModelCredential } = hookModule;
const { resetSessionModelCredentialsForTests, saveAiSettings } = settingsModule;
const { cleanup, renderHook, waitFor } = await import('@testing-library/react');

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'openai_compatible',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'session-fixture-key',
  modelName: 'gpt-5.6-luna',
  mockMode: false,
};

function legacySnapshot(overrides: Partial<TaskModelSnapshot> = {}): TaskModelSnapshot {
  const { baseUrl: _baseUrl, ...snapshotWithoutEndpoint } = {
    providerId: 'openai_compatible',
    modelId: 'gpt-5.6-luna',
    runtimeMode: 'api' as const,
    baseUrl: settings.baseUrl,
    capabilities: ['conversation_turn'],
    options: {},
    capturedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  return snapshotWithoutEndpoint;
}

beforeEach(() => {
  localStorage.clear();
  resetSessionModelCredentialsForTests();
});

afterEach(() => {
  cleanup();
});

test('UI credential readiness hydrates a legacy snapshot exactly like the send path', async () => {
  saveAiSettings(settings);

  const { result } = renderHook(() => useWorkbenchModelCredential(legacySnapshot()));

  await waitFor(() => assert.equal(result.current.status, 'available'));
  assert.equal(result.current.credentialAvailable, true);
});

test('UI credential readiness fails closed for an ambiguous legacy identity', async () => {
  saveAiSettings({ ...settings, modelName: 'different-active-model' });

  const { result } = renderHook(() => useWorkbenchModelCredential(legacySnapshot()));

  await waitFor(() => assert.equal(result.current.status, 'unavailable'));
  assert.equal(result.current.credentialAvailable, false);
});
