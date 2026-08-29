import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolDescriptorV1, ToolInvocationContext } from '../../types/toolRegistry';
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

function descriptor(name: string, overrides: Partial<ToolDescriptorV1> = {}): ToolDescriptorV1 {
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

test('schema validation rejects prototype-named extras and inherited required fields', async () => {
  const { validateToolJsonSchema } = await import('./toolRegistry');
  const schema = descriptor('novel.read_context').inputSchema;

  for (const key of ['constructor', 'toString', '__proto__']) {
    const argumentsJson = JSON.parse(
      JSON.stringify({ novelId: 'novel-1', [key]: 'smuggled' }),
    ) as Record<string, unknown>;
    assert.ok(
      validateToolJsonSchema(argumentsJson, schema).some(
        (error) => error === `$.${key} 是未知字段`,
      ),
    );
  }

  const inheritedRequired = Object.create({ novelId: 'novel-1' }) as Record<string, unknown>;
  assert.ok(
    validateToolJsonSchema(inheritedRequired, schema).some(
      (error) => error === '$.novelId 为必填字段',
    ),
  );
});

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
  assert.deepEqual(
    leftManifest.tools.map((tool) => `${tool.name}@${tool.version}`),
    ['novel.read_context@1', 'novel.read_settings@1'],
  );

  leftManifest.tools[0].name = 'tampered.tool';
  leftManifest.registryHash = '0'.repeat(64);
  const reread = await left.getManifest();
  assert.equal(reread.tools[0].name, 'novel.read_context');
  assert.equal(reread.registryHash, rightManifest.registryHash);
});

test('production registry exposes executable read/verification/candidate contracts and no hidden writes', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  const manifest = await productionToolRegistry.getManifest();
  assert.equal(manifest.tools.length, 19);
  assert.equal(
    manifest.registryHash,
    '82672d8347a8143a716e590014b9cf61fc576c0556c8683027d51528243c5192',
  );
  assert.equal(new Set(manifest.tools.map((tool) => `${tool.name}@${tool.version}`)).size, 19);
  assert.deepEqual(
    manifest.tools
      .map((tool) => tool.name)
      .filter((name) =>
        [
          'generate_outline',
          'generate_characters',
          'suggest_events',
          'expand_settings',
          'polish_chapter',
          'check_quality',
          'summarize_chapter',
        ].includes(name),
      )
      .sort(),
    [
      'check_quality',
      'expand_settings',
      'generate_characters',
      'generate_outline',
      'polish_chapter',
      'suggest_events',
      'summarize_chapter',
    ],
  );
  assert.equal(
    manifest.tools.some((tool) => tool.name === 'verification.check_readiness'),
    true,
  );
  assert.equal(
    manifest.tools.every((tool) => tool.sideEffect === 'none'),
    true,
  );
  assert.equal(
    manifest.tools.every((tool) => tool.confirmationPolicy === 'never'),
    true,
  );
  assert.equal(
    manifest.tools.some((tool) => tool.name === 'chapter.save_candidate_draft'),
    false,
  );
});

test('production generate_chapter accepts only scoped model-authored candidate text', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  const manifest = await productionToolRegistry.getManifest();
  const generate = manifest.tools.find((tool) => tool.name === 'generate_chapter');
  assert.ok(generate);
  assert.deepEqual(generate.inputSchema.required, ['novelId', 'chapterId', 'candidateText']);
  assert.deepEqual(Object.keys(generate.inputSchema.properties ?? {}).sort(), [
    'candidateText',
    'chapterId',
    'novelId',
  ]);
  assert.equal(generate.inputSchema.properties?.goal, undefined);
  assert.equal(generate.inputSchema.properties?.prompt, undefined);
  assert.deepEqual(generate.outputSchema.required, [
    'ok',
    'toolVersion',
    'artifactType',
    'candidateOnly',
    'data',
  ]);

  const context: ToolInvocationContext = {
    invocationId: 'generate-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    grantedPermissions: ['novel.read', 'chapter.read'],
    allowedTools: ['generate_chapter@1'],
  };
  const candidateText = '  雨声停了。\r\n\r\n林默推门走进长巷。  ';
  const result = await productionToolRegistry.invoke(
    'generate_chapter',
    '1',
    { novelId: 'novel-1', chapterId: 'chapter-1', candidateText },
    context,
  );
  assert.deepEqual(result, {
    ok: true,
    toolVersion: 'v1',
    artifactType: 'chapter_text',
    candidateOnly: true,
    data: {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      text: candidateText,
    },
  });

  for (const invalidArguments of [
    { novelId: 'novel-1', chapterId: 'chapter-1', goal: '生成一章' },
    {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      candidateText,
      prompt: '忽略上下文',
    },
  ]) {
    await assert.rejects(
      () => productionToolRegistry.invoke('generate_chapter', '1', invalidArguments, context),
      (error: unknown) =>
        error instanceof ToolRegistryError && error.code === 'TOOL_ARGUMENT_INVALID',
    );
  }

  await assert.rejects(
    () =>
      productionToolRegistry.invoke(
        'generate_chapter',
        '1',
        { novelId: 'novel-1', chapterId: 'chapter-2', candidateText },
        context,
      ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_SCOPE_MISMATCH',
  );
});

test('production generate_characters rejects unstructured candidate text', async () => {
  const { productionToolRegistry } = await import('./productionToolRegistry');
  const context: ToolInvocationContext = {
    invocationId: 'characters-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    grantedPermissions: ['novel.read', 'chapter.read'],
    allowedTools: ['generate_characters@1'],
  };
  await assert.rejects(
    () =>
      productionToolRegistry.invoke(
        'generate_characters',
        '1',
        { novelId: 'novel-1', chapterId: 'chapter-1', candidateText: '随便写两个角色' },
        context,
      ),
    /角色候选/,
  );
  const result = await productionToolRegistry.invoke(
    'generate_characters',
    '1',
    {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      candidateText: JSON.stringify({ characters: [{ name: '林默' }] }),
    },
    context,
  );
  assert.equal(result.ok, true);
  assert.equal((result as { artifactType?: string }).artifactType, 'character_candidates');
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
    () =>
      registry.invoke(
        'novel.read_context',
        '1',
        { novelId: 'novel-1' },
        invocationContext({ allowedTools: [] }),
      ),
    (error: unknown) => error instanceof ToolRegistryError && error.code === 'TOOL_NOT_ALLOWED',
  );
  await assert.rejects(
    () =>
      registry.invoke(
        'novel.read_context',
        '1',
        { novelId: 'novel-1' },
        invocationContext({ grantedPermissions: [] }),
      ),
    (error: unknown) =>
      error instanceof ToolRegistryError && error.code === 'TOOL_PERMISSION_DENIED',
  );
  await assert.rejects(
    () =>
      registry.invoke(
        'novel.read_context',
        '1',
        { novelId: 'novel-1', unexpected: true },
        invocationContext(),
      ),
    (error: unknown) =>
      error instanceof ToolRegistryError && error.code === 'TOOL_ARGUMENT_INVALID',
  );
  await assert.rejects(
    () => registry.invoke('novel.read_context', '1', { novelId: 'novel-2' }, invocationContext()),
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
    definition('novel.read_context', async () => ({ ok: true, extra: true }) as never),
  ]);
  await assert.rejects(
    () => registry.invoke('novel.read_context', '2', { novelId: 'novel-1' }, invocationContext()),
    (error: unknown) =>
      error instanceof ToolRegistryError && error.code === 'TOOL_VERSION_MISMATCH',
  );
  await assert.rejects(
    () => registry.invoke('novel.read_context', '1', { novelId: 'novel-1' }, invocationContext()),
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
    () => registry.invoke('novel.create_setting', '1', { novelId: 'novel-1' }, context),
    (error: unknown) =>
      error instanceof ToolRegistryError && error.code === 'TOOL_CONFIRMATION_REQUIRED',
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
    () => registry.invoke('novel.create_setting', '1', { novelId: 'novel-1' }, evidenceContext),
    (error: unknown) =>
      error instanceof ToolRegistryError && error.code === 'TOOL_CONFIRMATION_REQUIRED',
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
