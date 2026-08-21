import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiSettings } from '../../types/ai';
import type { ToolDescriptorV1, ToolRegistryManifestV1 } from '../../types/toolRegistry';
import {
  buildCurrentPluginProjection,
  WORKBENCH_TOOLS,
  type CurrentPluginProjection,
} from './currentPluginService';

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
