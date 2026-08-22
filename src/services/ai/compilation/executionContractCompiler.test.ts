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
  tools: [
    {
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
    },
  ],
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
  assert.deepEqual(
    first.contextSnapshot.sourceManifestJson,
    second.contextSnapshot.sourceManifestJson,
  );
  assert.equal(first.inputPayloadJson.compilationHash, second.inputPayloadJson.compilationHash);
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
  assert.ok(
    compiled.sourceManifestJson.sources.some(
      (source) => source.status === 'truncated' || source.status === 'omitted_budget',
    ),
  );
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
  const report = await verifyAiContextSourceDrift(compiled.sourceManifestJson, [
    { ...changed, content: `${changed.content} changed` },
    {
      ...sources()[0],
      sourceId: 'world-2',
    },
  ]);
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
  assert.equal(
    compiled.constraintSnapshot.payloadJson.toolPolicy.registryHash,
    registry.registryHash,
  );
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.maxTokens, 500);
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.temperature, settings.temperature);
  const persisted = JSON.stringify(compiled);
  assert.equal(persisted.includes(settings.apiKey), false);
  assert.equal(persisted.includes(settings.baseUrl), false);
});

test('connection test locks deterministic temperature instead of inheriting creative settings', async () => {
  const connectionDefinition: AiTaskCompilationDefinition = {
    ...definition,
    taskType: 'connection_test',
    expectedArtifactType: 'generic_text',
    promptTemplateId: 'system/connection_test',
    promptTemplateBody: 'Reply OK only.',
    userPrompt: 'OK only.',
    responseSchema: 'exact_text_ok_v1',
    constraints: { exactText: 'OK' },
    allowedSourceTypes: [],
    requiredSourceTypes: [],
    modelContextTokens: 512,
    maxOutputTokens: 128,
    defaultTemperature: 0,
  };
  const compiled = await compileAiExecutionContract({
    definition: connectionDefinition,
    scope: { scopeType: 'system', novelId: 'system' },
    compilation: { sources: [], taskInput: { purpose: 'connection_test' } },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  });

  assert.equal(compiled.request.temperature, 0);
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.temperature, 0);
  assert.equal(compiled.request.maxTokens, 128);
});

test('local chapter scene compiles one user message with the verified sampling protocol', async () => {
  const localDefinition: AiTaskCompilationDefinition = {
    ...definition,
    taskType: 'chapter_scene_generate',
    expectedArtifactType: 'scene_text',
    promptTemplateId: 'chapter/scene_generation_local',
    promptTemplateBody: 'Only output continuous scene prose.',
    userPrompt: (taskInput) =>
      [
        `Goal：\n${String(taskInput.sceneGoal)}`,
        `Beats：\n${JSON.stringify(taskInput.sceneBeats)}`,
        `Constraints：\n${JSON.stringify(taskInput.sceneConstraints)}`,
      ].join('\n'),
    responseSchema: 'scene_text_v1',
    constraints: { outputMode: 'scene_prose', candidateOnly: true },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    modelContextTokens: 64_000,
    maxOutputTokens: 12_000,
    defaultTemperature: 0.7,
    messageMode: 'single_user',
  };
  const localSettings: AiSettings = {
    ...settings,
    localChapterModel: {
      enabled: true,
      providerId: 'local_llama_cpp',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'local-no-key-required',
      modelName: 'qwen35-9b-novel-v3',
      timeoutSeconds: 120,
      contextTokens: 4096,
      maxTokens: 1024,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.08,
      seed: 7,
    },
  };
  const compiled = await compileAiExecutionContract({
    definition: localDefinition,
    scope: { scopeType: 'chapter', novelId: 'novel-1', chapterId: 'chapter-1' },
    compilation: {
      sources: [
        {
          sourceType: 'request_context',
          sourceId: 'chapter-1:scene',
          sourceVersion: 'hash-1',
          origin: 'request',
          label: 'Scene context',
          content: '夜雨中的旧车站，沈岚等待一列不该出现的列车。',
          order: 0,
          priority: 100,
          required: true,
        },
      ],
      taskInput: {
        chapterTitle: '第一章',
        contextHash: 'a'.repeat(64),
        sceneGoal: '让主角确认列车与失踪案有关。',
        sceneBeats: ['听见列车进站', '发现车票上的异常日期'],
        sceneConstraints: ['第一人称', '不揭示幕后真相'],
        routeDecision: {
          schemaVersion: 1,
          role: 'writer.beat_prose',
          taskType: 'chapter_scene_generate',
          primary: {
            endpointId: 'local.local_llama_cpp.qwen35-9b-novel-v3',
            providerId: 'local_llama_cpp',
            modelId: 'qwen35-9b-novel-v3',
            kind: 'local',
          },
          selected: {
            endpointId: 'local.local_llama_cpp.qwen35-9b-novel-v3',
            providerId: 'local_llama_cpp',
            modelId: 'qwen35-9b-novel-v3',
            kind: 'local',
          },
          reason: 'local_available',
          fallbackUsed: false,
          decidedAt: '2026-08-22T00:00:00.000Z',
        },
      },
    },
    settings: localSettings,
    providerId: 'local_llama_cpp',
    modelId: 'qwen35-9b-novel-v3',
    toolRegistry: registry,
  });
  const cloudCompiled = await compileAiExecutionContract({
    definition: localDefinition,
    scope: { scopeType: 'chapter', novelId: 'novel-1', chapterId: 'chapter-1' },
    compilation: {
      sources: [
        {
          sourceType: 'request_context',
          sourceId: 'chapter-1:scene-cloud',
          sourceVersion: 'hash-cloud',
          origin: 'request',
          label: 'Scene context',
          content: '夜雨中的旧车站，沈岚等待一列不该出现的列车。',
          order: 0,
          priority: 100,
          required: true,
        },
      ],
      taskInput: {
        chapterTitle: '第一章',
        contextHash: 'b'.repeat(64),
        sceneGoal: '让主角确认列车与失踪案有关。',
        sceneBeats: ['听见列车进站'],
        sceneConstraints: ['不揭示幕后真相'],
      },
    },
    settings,
    providerId: 'deepseek',
    modelId: 'test-model',
    toolRegistry: registry,
  });

  assert.equal(compiled.request.messages.length, 1);
  assert.equal(compiled.request.messages[0].role, 'user');
  assert.doesNotMatch(compiled.request.messages[0].content, /Instruction:/);
  assert.match(compiled.request.messages[0].content, /Context：/);
  assert.match(compiled.request.messages[0].content, /Goal：/);
  assert.match(compiled.request.messages[0].content, /Beats：/);
  assert.match(compiled.request.messages[0].content, /Constraints：/);
  assert.doesNotMatch(compiled.request.messages[0].content, /## Scene context/);
  assert.doesNotMatch(compiled.contextSnapshot.compiledContext, /^## /);
  assert.equal(compiled.contextSnapshot.budgetJson.modelContextTokens, 4096);
  assert.equal(compiled.request.maxTokens, 1024);
  assert.equal(compiled.request.topP, 0.8);
  assert.equal(compiled.request.topK, 20);
  assert.equal(compiled.request.repeatPenalty, 1.08);
  assert.equal(compiled.request.seed, 7);
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.providerId, 'local_llama_cpp');
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.maxTokens, 1024);
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.topK, 20);
  assert.equal(cloudCompiled.request.messages.length, 1);
  assert.equal(cloudCompiled.contextSnapshot.budgetJson.modelContextTokens, 64_000);
  assert.equal(cloudCompiled.request.maxTokens, 12_000);
  assert.equal(cloudCompiled.request.topP, undefined);
  assert.equal(cloudCompiled.constraintSnapshot.providerOptionsJson.providerId, 'deepseek');
});

test('DeepSeek V4 Beat repair compiles non-thinking mode into request and audit snapshot', async () => {
  const beatRepairDefinition: AiTaskCompilationDefinition = {
    ...definition,
    taskType: 'chapter_beat_repair',
    expectedArtifactType: 'chapter_text',
    promptTemplateId: 'chapter/beat_repair_external',
    promptTemplateBody: 'Return only the repaired Beat prose.',
    userPrompt: 'Repair this Beat.',
    responseSchema: 'chapter_text_v1',
    constraints: { outputMode: 'beat_prose', candidateOnly: true },
    allowedSourceTypes: ['request_context'],
    requiredSourceTypes: ['request_context'],
    modelContextTokens: 64_000,
    maxOutputTokens: 4_000,
    defaultTemperature: 0.35,
    thinkingMode: 'disabled',
  };
  const source = {
    sourceType: 'request_context' as const,
    sourceId: 'chapter-1:beat-repair',
    sourceVersion: 'hash-1',
    origin: 'request' as const,
    label: 'Rejected Beat',
    content: '待修正文',
    order: 0,
    priority: 100,
    required: true,
  };
  const compiled = await compileAiExecutionContract({
    definition: beatRepairDefinition,
    scope: { scopeType: 'chapter', novelId: 'novel-1', chapterId: 'chapter-1' },
    compilation: { sources: [source], taskInput: { purpose: 'repair' } },
    settings,
    providerId: 'openai_compatible',
    modelId: 'deepseek-v4-flash',
    toolRegistry: registry,
  });
  const otherModel = await compileAiExecutionContract({
    definition: beatRepairDefinition,
    scope: { scopeType: 'chapter', novelId: 'novel-1', chapterId: 'chapter-1' },
    compilation: { sources: [source], taskInput: { purpose: 'repair' } },
    settings,
    providerId: 'openai_compatible',
    modelId: 'other-openai-compatible-model',
    toolRegistry: registry,
  });

  assert.equal(compiled.request.thinkingMode, 'disabled');
  assert.equal(compiled.request.maxTokens, 4_000);
  assert.equal(compiled.constraintSnapshot.providerOptionsJson.thinkingMode, 'disabled');
  assert.equal(otherModel.request.thinkingMode, undefined);
  assert.equal(otherModel.constraintSnapshot.providerOptionsJson.thinkingMode, undefined);
});

test('compiler rejects unsupported sources, scope drift and unregistered tools', async () => {
  await assert.rejects(
    () =>
      compileAiExecutionContract({
        definition: { ...definition, allowedTools: ['missing.tool@1'] },
        scope: { scopeType: 'novel', novelId: 'novel-1' },
        compilation: { sources: sources() },
        settings,
        providerId: 'deepseek',
        modelId: 'test-model',
        toolRegistry: registry,
      }),
    /未注册工具/,
  );
  await assert.rejects(
    () =>
      compileAiExecutionContract({
        definition,
        scope: { scopeType: 'novel', novelId: 'novel-other' },
        compilation: { sources: sources() },
        settings,
        providerId: 'deepseek',
        modelId: 'test-model',
        toolRegistry: registry,
      }),
    /Novel 来源与 Task scope/,
  );
});
