import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../../types/ai';
import type { ToolRegistryManifestV1 } from '../../../types/toolRegistry';
import { compileAiContext, verifyAiContextSourceDrift } from './contextCompiler';
import {
  compileAiExecutionContract,
  type AiTaskCompilationDefinition,
} from './executionContractCompiler';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'compiler-test-secret-must-not-persist',
  modelName: 'test-model',
  temperature: 0.2,
  maxTokens: 9999,
  timeoutSeconds: 5,
  mockMode: false,
};

const registry: ToolRegistryManifestV1 = {
  contractVersion: 'tool_registry_manifest_v1',
  registryVersion: 'tool_registry_v1',
  registryHash: 'a'.repeat(64),
  tools: [{
    name: 'novel.read_context',
    version: '1',
    description: 'read',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['novel.read'],
    scope: 'novel',
    sideEffect: 'none',
    confirmationPolicy: 'never',
    timeoutMs: 1000,
  }],
};

const definition: AiTaskCompilationDefinition = {
  taskType: 'setting_expand',
  expectedArtifactType: 'setting_candidates',
  expectedArtifactSchemaVersion: 1,
  promptTemplateId: 'setting/expand',
  promptTemplateVersion: '2',
  promptTemplateBody: 'Return setting candidates as JSON only.',
  userPrompt: 'Suggest settings.',
  responseSchema: 'setting_candidates_v1',
  constraints: { candidateOnly: true, maximumCandidates: 8 },
  allowedSourceTypes: ['novel', 'chapter', 'world_setting'],
  requiredSourceTypes: ['novel'],
  allowedTools: [],
  modelContextTokens: 4000,
  maxOutputTokens: 500,
  defaultTemperature: 0.7,
};

function sources() {
  return [
    {
      sourceType: 'world_setting' as const,
      sourceId: 'world-1',
      sourceVersion: '2026-07-26T00:00:00Z',
      origin: 'sqlite' as const,
      label: 'World',
      content: 'A city floats above a permanent storm.',
      order: 20,
      priority: 80,
    },
    {
      sourceType: 'novel' as const,
      sourceId: 'novel-1',
      sourceVersion: '2026-07-26T00:00:00Z',
      origin: 'sqlite' as const,
      label: 'Novel',
      content: 'Title: Storm Archive',
      order: 10,
      priority: 100,
      required: true,
    },
  ];
}

test('formal compiler is deterministic across source and JSON key order', async () => {
  const first = await compileAiExecutionContract({
    definition,
    scope: { scopeType: 'novel', novelId: 'novel-1' },
    compilation: { sources: sources(), taskInput: { z: 1, a: 2 } },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  });
  const second = await compileAiExecutionContract({
    definition,
    scope: { scopeType: 'novel', novelId: 'novel-1' },
    compilation: { sources: [...sources()].reverse(), taskInput: { a: 2, z: 1 } },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  });
  assert.equal(first.contextSnapshot.compiledContext, second.contextSnapshot.compiledContext);
  assert.deepEqual(first.contextSnapshot.sourceManifestJson, second.contextSnapshot.sourceManifestJson);
  assert.equal(first.inputPayloadJson.compilationHash, second.inputPayloadJson.compilationHash);
  assert.equal(first.request.taskType, definition.taskType);
  assert.equal(first.contextSnapshot.schemaVersion, 2);
  assert.equal(first.constraintSnapshot.schemaVersion, 2);
});

test('context compiler enforces the versioned budget with deterministic truncation', async () => {
  const compiled = await compileAiContext({
    sources: [
      { ...sources()[1], content: '主'.repeat(1200), maxTokens: 250 },
      { ...sources()[0], content: 'world '.repeat(1200) },
    ],
    modelContextTokens: 1000,
    reservedOutputTokens: 200,
    fixedMessageTokens: 200,
  });
  assert.ok(compiled.budgetJson.compiledContextTokens <= 600);
  assert.equal(compiled.sourceManifestJson.sources[0].status, 'truncated');
  assert.ok(compiled.sourceManifestJson.sources.some((source) => (
    source.status === 'truncated' || source.status === 'omitted_budget'
  )));
  const replay = await compileAiContext({
    sources: [
      { ...sources()[0], content: 'world '.repeat(1200) },
      { ...sources()[1], content: '主'.repeat(1200), maxTokens: 250 },
    ],
    modelContextTokens: 1000,
    reservedOutputTokens: 200,
    fixedMessageTokens: 200,
  });
  assert.equal(replay.compiledContext, compiled.compiledContext);
  assert.deepEqual(replay.budgetJson, compiled.budgetJson);
});

test('source drift verifier reports changed, missing and unexpected identities', async () => {
  const compiled = await compileAiContext({
    sources: sources(),
    modelContextTokens: 2000,
    reservedOutputTokens: 200,
    fixedMessageTokens: 200,
  });
  const changed = sources()[1];
  const report = await verifyAiContextSourceDrift(
    compiled.sourceManifestJson,
    [
      { ...changed, content: `${changed.content} changed` },
      {
        ...sources()[0],
        sourceId: 'world-2',
      },
    ],
  );
  assert.equal(report.matches, false);
  assert.deepEqual(report.items.map((item) => item.status).sort(), [
    'changed',
    'missing',
    'unexpected',
  ]);
});

test('compiled request separates template, context, registry and provider identity without secrets', async () => {
  const compiled = await compileAiExecutionContract({
    definition,
    scope: { scopeType: 'novel', novelId: 'novel-1' },
    compilation: { sources: sources(), taskInput: { purpose: 'test' } },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  });
  assert.equal(compiled.constraintSnapshot.promptTemplateBody.includes('Storm Archive'), false);
  assert.match(compiled.request.messages[0].content, /Storm Archive/);
  assert.equal(compiled.constraintSnapshot.payloadJson.toolPolicy.registryHash, registry.registryHash);
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.maxTokens, 500);
  const persisted = JSON.stringify(compiled);
  assert.equal(persisted.includes(settings.apiKey), false);
  assert.equal(persisted.includes(settings.baseUrl), false);
});

test('compiler rejects unsupported sources, scope drift and unregistered tools', async () => {
  await assert.rejects(() => compileAiExecutionContract({
    definition: { ...definition, allowedTools: ['missing.tool@1'] },
    scope: { scopeType: 'novel', novelId: 'novel-1' },
    compilation: { sources: sources() },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  }), /未注册工具/);
  await assert.rejects(() => compileAiExecutionContract({
    definition,
    scope: { scopeType: 'novel', novelId: 'novel-other' },
    compilation: { sources: sources() },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  }), /Novel 来源与 Task scope/);
});
