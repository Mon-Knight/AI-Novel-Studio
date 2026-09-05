import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { CurrentPluginProjection } from '../../../services/conversation/currentPluginService';
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

// Import after the DOM shim is installed. Direct tsx imports keep this unit
// test free of a long-lived Vite server, so name-filtered runs cannot retain
// file watchers or sockets from module initialization.
const hookModule =
  (await import('./useWorkbenchPlugins')) as typeof import('./useWorkbenchPlugins');
const runtimeModule =
  (await import('../../../services/dsh/taskRuntimeService')) as typeof import('../../../services/dsh/taskRuntimeService');
const registryModule =
  (await import('../../../services/agent-tools/productionToolRegistry')) as typeof import('../../../services/agent-tools/productionToolRegistry');
const { useWorkbenchPlugins } = hookModule;
const { dshTaskRuntimeService } = runtimeModule;
const { productionToolRegistry } = registryModule;
const { act, cleanup, renderHook, waitFor } = await import('@testing-library/react');

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function model(modelId: string): TaskModelSnapshot {
  return {
    providerId: 'test-provider',
    modelId,
    runtimeMode: 'api',
    baseUrl: 'http://127.0.0.1:12074/v1',
    capabilities: ['conversation_turn'],
    options: {},
    capturedAt: '2026-09-01T00:00:00.000Z',
  };
}

function runtimeModelRow(modelId: string): Record<string, unknown> {
  return {
    id: `model:test-provider:${modelId}`,
    name: modelId,
    category: 'model',
    version: 'test',
    description: 'Test runtime model.',
    status: 'loaded',
    availability: 'available',
    initialization: 'initialized',
    health: 'healthy',
    source: 'test-runtime',
    capabilities: ['conversation_turn'],
  };
}

const originalListCurrentPlugins = dshTaskRuntimeService.listCurrentPlugins;
const originalGetManifest = productionToolRegistry.getManifest;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(dom.window, '__TAURI__', {
    value: {},
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  dshTaskRuntimeService.listCurrentPlugins = originalListCurrentPlugins;
  productionToolRegistry.getManifest = originalGetManifest;
  delete (dom.window as typeof dom.window & { __TAURI__?: unknown }).__TAURI__;
});

test('does not let a background model refresh replace the open task creator directory', async () => {
  const pending = new Map<string, Deferred<Record<string, unknown>[]>>();
  const requested: string[] = [];
  dshTaskRuntimeService.listCurrentPlugins = async (_conversationId, snapshot) => {
    const modelId = snapshot?.modelId ?? 'unknown';
    requested.push(modelId);
    const gate = deferred<Record<string, unknown>[]>();
    pending.set(modelId, gate);
    return gate.promise;
  };

  const modelA = model('model-a');
  const modelB = model('model-b');
  const { result } = renderHook(() => useWorkbenchPlugins(true));

  let foreground!: Promise<CurrentPluginProjection[]>;
  await act(async () => {
    foreground = result.current.refreshPlugins(undefined, true, modelB);
    await Promise.resolve();
  });
  await waitFor(() => assert.deepEqual(requested, ['model-b']));

  let background!: Promise<CurrentPluginProjection[]>;
  await act(async () => {
    background = result.current.refreshPlugins('conversation-a', false, modelA, 'background');
    await Promise.resolve();
  });
  await waitFor(() => assert.deepEqual(requested, ['model-b', 'model-a']));

  let backgroundRows!: CurrentPluginProjection[];
  await act(async () => {
    pending.get('model-a')?.resolve([runtimeModelRow('model-a')]);
    backgroundRows = await background;
  });
  assert.equal(
    backgroundRows.some((row) => row.id === 'model:test-provider:model-a'),
    true,
  );
  assert.deepEqual(result.current.plugins, []);
  assert.equal(result.current.pluginsLoading, true);

  let foregroundRows!: CurrentPluginProjection[];
  await act(async () => {
    pending.get('model-b')?.resolve([runtimeModelRow('model-b')]);
    foregroundRows = await foreground;
  });
  await waitFor(() => {
    assert.equal(
      result.current.plugins.some((row) => row.id === 'model:test-provider:model-b'),
      true,
    );
    assert.equal(result.current.pluginsLoading, false);
  });
  assert.equal(
    foregroundRows.some((row) => row.id === 'model:test-provider:model-b'),
    true,
  );
});

test('publishes background model refreshes when the task creator is closed', async () => {
  dshTaskRuntimeService.listCurrentPlugins = async (_conversationId, snapshot) => [
    runtimeModelRow(snapshot?.modelId ?? 'unknown'),
  ];

  const { result } = renderHook(() => useWorkbenchPlugins(false));
  let rows!: Promise<CurrentPluginProjection[]>;
  await act(async () => {
    rows = result.current.refreshPlugins('conversation-a', false, model('model-a'), 'background');
    await rows;
  });

  assert.equal(
    (await rows).some((row) => row.id === 'model:test-provider:model-a'),
    true,
  );
  assert.equal(
    result.current.plugins.some((row) => row.id === 'model:test-provider:model-a'),
    true,
  );
  assert.equal(result.current.pluginsLoading, false);
});

test('clears a background loading state when the task creator opens mid-refresh', async () => {
  const pending = deferred<Record<string, unknown>[]>();
  dshTaskRuntimeService.listCurrentPlugins = async () => pending.promise;

  const { result, rerender } = renderHook(
    ({ open }: { open: boolean }) => useWorkbenchPlugins(open),
    { initialProps: { open: false } },
  );
  let background!: Promise<CurrentPluginProjection[]>;
  await act(async () => {
    background = result.current.refreshPlugins(
      'conversation-a',
      false,
      model('model-a'),
      'background',
    );
    await Promise.resolve();
  });

  await waitFor(() => assert.equal(result.current.pluginsLoading, true));
  await act(async () => {
    rerender({ open: true });
  });
  await waitFor(() => assert.equal(result.current.pluginsLoading, false));

  let rows!: CurrentPluginProjection[];
  await act(async () => {
    pending.resolve([runtimeModelRow('model-a')]);
    rows = await background;
  });
  assert.equal(
    rows.some((row) => row.id === 'model:test-provider:model-a'),
    true,
  );
  assert.deepEqual(result.current.plugins, []);
  assert.equal(result.current.pluginsLoading, false);
});

test('keeps an active foreground refresh ahead of a concurrent background refresh', async () => {
  const pending = new Map<string, Deferred<Record<string, unknown>[]>>();
  dshTaskRuntimeService.listCurrentPlugins = async (_conversationId, snapshot) => {
    const modelId = snapshot?.modelId ?? 'unknown';
    const gate = deferred<Record<string, unknown>[]>();
    pending.set(modelId, gate);
    return gate.promise;
  };

  const { result } = renderHook(() => useWorkbenchPlugins(false));
  let foreground!: Promise<CurrentPluginProjection[]>;
  let background!: Promise<CurrentPluginProjection[]>;
  await act(async () => {
    foreground = result.current.refreshPlugins(undefined, true, model('model-b'));
    await Promise.resolve();
    background = result.current.refreshPlugins(
      'conversation-a',
      false,
      model('model-a'),
      'background',
    );
    await Promise.resolve();
  });

  await waitFor(() => assert.deepEqual([...pending.keys()].sort(), ['model-a', 'model-b']));
  let backgroundRows!: CurrentPluginProjection[];
  await act(async () => {
    pending.get('model-a')?.resolve([runtimeModelRow('model-a')]);
    backgroundRows = await background;
  });
  assert.equal(
    backgroundRows.some((row) => row.id === 'model:test-provider:model-a'),
    true,
  );
  assert.deepEqual(result.current.plugins, []);
  assert.equal(result.current.pluginsLoading, true);

  let foregroundRows!: CurrentPluginProjection[];
  await act(async () => {
    pending.get('model-b')?.resolve([runtimeModelRow('model-b')]);
    foregroundRows = await foreground;
  });
  await waitFor(() => {
    assert.equal(
      result.current.plugins.some((row) => row.id === 'model:test-provider:model-b'),
      true,
    );
    assert.equal(result.current.pluginsLoading, false);
  });
  assert.equal(
    foregroundRows.some((row) => row.id === 'model:test-provider:model-b'),
    true,
  );
});

test('captures and rethrows background refresh failures when the creator is closed', async () => {
  productionToolRegistry.getManifest = async () => ({ tools: undefined }) as never;
  const { result } = renderHook(() => useWorkbenchPlugins(false));

  await act(async () => {
    await assert.rejects(
      result.current.refreshPlugins('conversation-a', false, model('model-a'), 'background'),
    );
  });
  await waitFor(() => assert.equal(result.current.pluginsLoading, false));
  assert.match(result.current.pluginsError, /map|undefined|null/i);
});
