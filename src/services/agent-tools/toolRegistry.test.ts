import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolDescriptorV1 } from '../../types/toolRegistry';
import { ToolRegistry, ToolRegistryError, type ToolDefinition } from './toolRegistry';

const outputSchema = {
  type: 'object' as const,
  required: ['ok'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' as const },
    data: {},
    error: { type: 'string' as const },
  },
};

function descriptor(
  name: string,
  overrides: Partial<ToolDescriptorV1> = {},
): ToolDescriptorV1 {
  return {
    name,
    version: '1',
    description: `Tool ${name}`,
    inputSchema: {
      type: 'object',
      required: ['novelId'],
      additionalProperties: false,
      properties: {
        novelId: { type: 'string', minLength: 1, maxLength: 160 },
      },
    },
    outputSchema,
    permissions: ['novel.read'],
    scope: 'novel',
    sideEffect: 'none',
    confirmationPolicy: 'never',
    timeoutMs: 1000,
    ...overrides,
  };
}

function definition(
  name: string,
  handler: ToolDefinition['handler'] = async () => ({ ok: true, data: { value: 1 } }),
  overrides: Partial<ToolDescriptorV1> = {},
  verifyConfirmation?: ToolDefinition['verifyConfirmation'],
): ToolDefinition {
  return { descriptor: descriptor(name, overrides), handler, verifyConfirmation };
}

function invocationContext(overrides = {}) {
  return {
    invocationId: 'invoke-1',
    novelId: 'novel-1',
    grantedPermissions: ['novel.read' as const],
    allowedTools: ['novel.read_context@1'],
    ...overrides,
  };
}

test('registry manifest and hash are deterministic across definition order', async () => {
  const left = new ToolRegistry([
    definition('novel.read_context'),
    definition('novel.read_settings'),
  ]);
  const right = new ToolRegistry([
    definition('novel.read_settings'),
    definition('novel.read_context'),
  ]);
  const leftManifest = await left.getManifest();
  const rightManifest = await right.getManifest();
  assert.deepEqual(leftManifest, rightManifest);
  assert.match(leftManifest.registryHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(leftManifest.tools.map((tool) => `${tool.name}@${tool.version}`), [
    'novel.read_context@1',
    'novel.read_settings@1',
  ]);

  leftManifest.tools[0].name = 'tampered.tool';
  leftManifest.registryHash = '0'.repeat(64);
  const reread = await left.getManifest();
  assert.equal(reread.tools[0].name, 'novel.read_context');
  assert.equal(reread.registryHash, rightManifest.registryHash);
});

test('production registry exposes eight executable read/verification contracts and no hidden writes', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  const manifest = await productionToolRegistry.getManifest();
  assert.equal(manifest.tools.length, 8);
  assert.equal(
    manifest.registryHash,
    'c03ae58009cfb47b84f85dbb907b427cd1d659149af0a6133ec6898e8de4a0a5',
  );
  assert.equal(new Set(manifest.tools.map((tool) => `${tool.name}@${tool.version}`)).size, 8);
  assert.equal(manifest.tools.every((tool) => tool.sideEffect === 'none'), true);
  assert.equal(manifest.tools.every((tool) => tool.confirmationPolicy === 'never'), true);
  assert.equal(manifest.tools.some((tool) => tool.name === 'chapter.save_candidate_draft'), false);
});

test('registry validates allowlist, permission, schema and scope before invoking handler', async () => {
  let calls = 0;
  const registry = new ToolRegistry([
    definition('novel.read_context', async () => {
      calls += 1;
      return { ok: true, data: { value: 1 } };
    }),
  ]);
  await assert.rejects(
    () => registry.invoke(
      'novel.read_context',
      '1',
      { novelId: 'novel-1' },
      invocationContext({ allowedTools: [] }),
    ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_NOT_ALLOWED',
  );
  await assert.rejects(
    () => registry.invoke(
      'novel.read_context',
      '1',
      { novelId: 'novel-1' },
      invocationContext({ grantedPermissions: [] }),
    ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_PERMISSION_DENIED',
  );
  await assert.rejects(
    () => registry.invoke(
      'novel.read_context',
      '1',
      { novelId: 'novel-1', unexpected: true },
      invocationContext(),
    ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_ARGUMENT_INVALID',
  );
  await assert.rejects(
    () => registry.invoke(
      'novel.read_context',
      '1',
      { novelId: 'novel-2' },
      invocationContext(),
    ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_SCOPE_MISMATCH',
  );
  assert.equal(calls, 0);
  const result = await registry.invoke(
    'novel.read_context',
    '1',
    { novelId: 'novel-1' },
    invocationContext(),
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test('registry rejects unknown versions and handler output outside the frozen schema', async () => {
  const registry = new ToolRegistry([
    definition('novel.read_context', async () => ({ ok: true, extra: true } as never)),
  ]);
  await assert.rejects(
    () => registry.invoke(
      'novel.read_context',
      '2',
      { novelId: 'novel-1' },
      invocationContext(),
    ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_VERSION_MISMATCH',
  );
  await assert.rejects(
    () => registry.invoke(
      'novel.read_context',
      '1',
      { novelId: 'novel-1' },
      invocationContext(),
    ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_OUTPUT_INVALID',
  );
});

test('side-effect descriptors cannot execute without durable user confirmation fields', async () => {
  let calls = 0;
  let confirmationVerified = false;
  const registry = new ToolRegistry([
    definition(
      'novel.create_setting',
      async () => {
        calls += 1;
        return { ok: true };
      },
      {
        permissions: ['business.write'],
        sideEffect: 'create',
        confirmationPolicy: 'user_confirmation',
      },
      async () => confirmationVerified,
    ),
  ]);
  const context = invocationContext({
    grantedPermissions: ['business.write'],
    allowedTools: ['novel.create_setting@1'],
  });
  await assert.rejects(
    () => registry.invoke(
      'novel.create_setting',
      '1',
      { novelId: 'novel-1' },
      context,
    ),
    (error: unknown) => (
      error instanceof ToolRegistryError && error.code === 'TOOL_CONFIRMATION_REQUIRED'
    ),
  );
  assert.equal(calls, 0);
  const evidenceContext = {
    ...context,
    confirmation: {
      confirmedBy: 'user' as const,
      userConfirmedAt: '2026-07-26T00:00:00Z',
      planId: 'plan-1',
      operationId: 'operation-1',
      planHash: 'a'.repeat(64),
    },
  };
  await assert.rejects(
    () => registry.invoke(
      'novel.create_setting',
      '1',
      { novelId: 'novel-1' },
      evidenceContext,
    ),
    (error: unknown) => (
      error instanceof ToolRegistryError && error.code === 'TOOL_CONFIRMATION_REQUIRED'
    ),
  );
  confirmationVerified = true;
  const confirmed = await registry.invoke(
    'novel.create_setting',
    '1',
    { novelId: 'novel-1' },
    evidenceContext,
  );
  assert.equal(confirmed.ok, true);
  assert.equal(calls, 1);
});
