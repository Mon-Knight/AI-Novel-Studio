import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import type { AiSettings } from '../../types/ai';
import type { ToolDescriptorV1, ToolRegistryManifestV1 } from '../../types/toolRegistry';
import { productionToolRegistry } from '../agent-tools/productionToolRegistry';
import {
  buildCurrentPluginProjection,
  getCurrentPluginProjection,
  safePluginErrorText,
  WORKBENCH_TOOLS,
  type CurrentPluginProjection,
} from './currentPluginService';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
const E2E_WORKBENCH_MODEL_STORAGE_KEY = 'ai_novel_studio_e2e_workbench_model';

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    runtimeMode: 'mock',
    provider: 'mock',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    mockMode: true,
    ...overrides,
  };
}

function tool(name: (typeof WORKBENCH_TOOLS)[number]): ToolDescriptorV1 {
  return {
    name,
    version: '1',
    description: `${name} production descriptor.`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['novel.read'],
    scope: name === 'chapter.read_outline' || name === 'generate_chapter' ? 'chapter' : 'novel',
    sideEffect: 'none',
    confirmationPolicy: 'never',
    timeoutMs: 20_000,
  };
}

function manifest(): ToolRegistryManifestV1 {
  return {
    contractVersion: 'tool_registry_manifest_v1',
    registryVersion: 'tool_registry_v1',
    registryHash: 'test-registry',
    tools: WORKBENCH_TOOLS.map(tool),
  };
}

function runtimeRow(overrides: Partial<CurrentPluginProjection> = {}): CurrentPluginProjection {
  return {
    id: 'dsh-carrier:47f94385',
    name: 'Pinned DSH Carrier',
    category: 'other',
    version: '47f94385',
    description: 'Fixed carrier projection.',
    status: 'unavailable',
    availability: 'available',
    initialization: 'not_initialized',
    health: 'unknown',
    source: 'dsh-runtime-descriptor',
    capabilities: ['runtime-health'],
    ...overrides,
  };
}

test('production Tool Registry manifest covers every Workbench tool', async () => {
  const manifest = await productionToolRegistry.getManifest();
  const names = new Set(manifest.tools.map((item) => item.name));
  assert.deepEqual(
    WORKBENCH_TOOLS.filter((name) => !names.has(name)),
    [],
  );
});

test('browser fallback never presents DSH tools as loaded', () => {
  const rows = buildCurrentPluginProjection({
    desktop: false,
    settings: settings(),
    manifest: manifest(),
  });
  const functions = rows.filter((row) => row.category === 'function');
  assert.equal(functions.length, WORKBENCH_TOOLS.length);
  assert.ok(functions.every((row) => row.status === 'unavailable'));
  assert.ok(functions.every((row) => row.initialization === 'not_initialized'));
  assert.ok(
    rows.some(
      (row) =>
        row.id === 'model:browser-fallback:Mock' &&
        row.status === 'loaded' &&
        row.source === 'browser-fallback',
    ),
  );
  assert.ok(
    rows.some((row) => row.id === 'dsh-carrier:unavailable' && row.status === 'unavailable'),
  );
});

test('non-E2E builds ignore the deterministic model storage opt-in', async () => {
  storage.clear();
  storage.setItem(E2E_WORKBENCH_MODEL_STORAGE_KEY, 'enabled');

  const rows = await getCurrentPluginProjection();

  assert.equal(
    rows.some((row) => row.id === 'model:mock:Mock'),
    false,
  );
  assert.equal(rows.find((row) => row.id === 'model:browser-fallback:Mock')?.status, 'loaded');
});

test('E2E build exposes deterministic Mock only after the exact storage opt-in', async () => {
  storage.clear();
  const vite = await createServer({
    appType: 'custom',
    define: {
      'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
    },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const e2eModule = (await vite.ssrLoadModule(
      '/src/services/conversation/currentPluginService.ts',
    )) as typeof import('./currentPluginService');

    let rows = await e2eModule.getCurrentPluginProjection();
    assert.equal(
      rows.some((row) => row.id === 'model:mock:Mock'),
      false,
    );

    storage.setItem(E2E_WORKBENCH_MODEL_STORAGE_KEY, 'true');
    rows = await e2eModule.getCurrentPluginProjection();
    assert.equal(
      rows.some((row) => row.id === 'model:mock:Mock'),
      false,
    );

    storage.setItem(E2E_WORKBENCH_MODEL_STORAGE_KEY, 'enabled');
    rows = await e2eModule.getCurrentPluginProjection();
    const deterministic = rows.find((row) => row.id === 'model:mock:Mock');
    assert.deepEqual(deterministic, {
      id: 'model:mock:Mock',
      name: 'Mock',
      category: 'model',
      version: 'e2e-deterministic',
      description: 'Deterministic Workbench model exposed only by an explicitly enabled E2E test.',
      status: 'loaded',
      availability: 'available',
      initialization: 'initialized',
      health: 'healthy',
      source: 'e2e-deterministic-runtime',
      capabilities: ['conversation_turn', 'chapter_generate'],
    });
    assert.equal(rows.filter((row) => row.id === 'model:mock:Mock').length, 1);
    assert.equal(rows.find((row) => row.id === 'model:browser-fallback:Mock')?.status, 'loaded');
  } finally {
    await vite.close();
    storage.clear();
  }
});

test('desktop carrier files remain available but not initialized without health', () => {
  const rows = buildCurrentPluginProjection({
    desktop: true,
    settings: settings(),
    manifest: manifest(),
    runtimeRows: [
      runtimeRow(),
      runtimeRow({
        id: 'dsh-composition:sessions',
        name: 'Session Persistence',
        source: 'pinned-cordis-composition',
      }),
    ],
  });
  assert.ok(rows.every((row) => row.status !== 'loaded'));
  assert.equal(rows.find((row) => row.id.startsWith('dsh-carrier:'))?.availability, 'available');
  assert.equal(
    rows.find((row) => row.id === 'dsh-composition:sessions')?.initialization,
    'not_initialized',
  );
});

test('healthy runtime rows load provider, model, composition and workbench scoped tools', () => {
  const runtimeRows: CurrentPluginProjection[] = [
    runtimeRow({ status: 'loaded', initialization: 'initialized', health: 'healthy' }),
    runtimeRow({
      id: 'dsh-composition:sessions',
      name: 'Session Persistence',
      status: 'loaded',
      initialization: 'initialized',
      health: 'healthy',
      source: 'pinned-cordis-composition',
    }),
    runtimeRow({
      id: 'provider:deepseek-official',
      name: 'DeepSeek',
      category: 'model',
      status: 'loaded',
      initialization: 'initialized',
      health: 'unknown',
      source: 'dsh-runtime-health',
    }),
    runtimeRow({
      id: 'model:deepseek-official:deepseek-chat',
      name: 'DeepSeek Chat',
      category: 'model',
      status: 'loaded',
      initialization: 'initialized',
      health: 'unknown',
      source: 'dsh-runtime-health',
    }),
    ...WORKBENCH_TOOLS.map((name) =>
      runtimeRow({
        id: `tool:${name}@1`,
        name,
        category: 'function',
        version: '1',
        status: 'loaded',
        initialization: 'initialized',
        health: 'unknown',
        source: 'dsh-runtime-health',
      }),
    ),
  ];
  const rows = buildCurrentPluginProjection({
    desktop: true,
    settings: settings({
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'must-never-project',
      modelName: 'deepseek-chat',
      mockMode: false,
    }),
    manifest: manifest(),
    runtimeRows,
  });
  const functions = rows.filter((row) => row.category === 'function');
  assert.deepEqual(functions.map((row) => row.name).sort(), [...WORKBENCH_TOOLS].sort());
  assert.ok(functions.every((row) => row.status === 'loaded'));
  assert.ok(functions.every((row) => row.source.includes('dsh-runtime-health')));
  assert.equal(rows.find((row) => row.id === 'provider:deepseek-official')?.status, 'loaded');
  assert.equal(
    rows.find((row) => row.id === 'model:deepseek-official:deepseek-chat')?.status,
    'loaded',
  );
  assert.equal(rows.find((row) => row.id === 'dsh-composition:sessions')?.health, 'healthy');
  assert.doesNotMatch(JSON.stringify(rows), /must-never-project/);
});

test('malformed runtime rows are ignored and cannot manufacture loaded state', () => {
  const rows = buildCurrentPluginProjection({
    desktop: true,
    settings: settings(),
    manifest: manifest(),
    runtimeRows: [
      { id: 'malformed-loaded', name: 'Spoofed', category: 'other', status: 'loaded' },
      runtimeRow({ id: '', name: '' }),
    ],
  });
  assert.equal(
    rows.some((row) => row.id === 'malformed-loaded'),
    false,
  );
  assert.ok(rows.every((row) => row.status !== 'loaded'));
});

test('catalog-only canonical runtime rows cannot manufacture loaded function state', () => {
  const rows = buildCurrentPluginProjection({
    desktop: true,
    settings: settings(),
    manifest: manifest(),
    runtimeRows: [
      runtimeRow({
        id: 'tool:novel.read@1',
        name: 'novel.read',
        category: 'function',
        version: '1',
        status: 'loaded',
        initialization: 'initialized',
        health: 'healthy',
      }),
    ],
  });

  const functions = rows.filter((row) => row.category === 'function');
  assert.equal(functions.length, WORKBENCH_TOOLS.length);
  assert.equal(
    functions.some((row) => row.id === 'tool:novel.read@1'),
    false,
  );
  assert.equal(
    functions.some((row) => row.name === 'novel.read'),
    false,
  );
  assert.ok(functions.every((row) => row.status !== 'loaded'));
});

test('credential-shaped projection text is redacted', () => {
  const rows = buildCurrentPluginProjection({
    desktop: true,
    settings: settings({ apiKey: 'settings-super-secret' }),
    manifest: manifest(),
    runtimeRows: [
      runtimeRow({
        description:
          'Authorization: Bearer runtime-super-secret apiKey=settings-super-secret sk-abcdefghijklmnop',
      }),
    ],
  });
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /runtime-super-secret|settings-super-secret|sk-abcdefghijklmnop/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('Tauri string rejections retain a sanitized runtime reason', () => {
  assert.equal(
    safePluginErrorText(
      '代理进程树隔离失败: AssignProcessToJobObject failed',
      'DSH Runtime Projection 不可读取。',
    ),
    '代理进程树隔离失败: AssignProcessToJobObject failed',
  );
  assert.equal(
    safePluginErrorText(
      'runtime failed with agt_example_session_credential',
      'DSH Runtime Projection 不可读取。',
    ),
    'runtime failed with [REDACTED]',
  );
});
