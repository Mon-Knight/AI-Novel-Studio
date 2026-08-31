import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import type { CompiledAiExecutionContractV1 } from '../../types/aiCompilation';
import type {
  AiTask,
  AiTaskAttempt,
  AiTaskAttemptResult,
  AiTaskDetail,
  CreateAiTaskInput,
} from '../../types/ai-task';
import type { CreateResultArtifactInput, ResultArtifactBundle } from '../../types/result-artifact';
import { AiRequestCancelledError } from './aiCancellation';
import {
  AiExecutionError,
  executeAiTask,
  type AiExecutionDependencies,
  type ExecuteAiTaskInput,
} from './aiExecutionPipeline';
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderAdapterResult,
} from './providerAdapter';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'never-persist-this-secret-key',
  modelName: 'test-model',
  temperature: 0.1,
  maxTokens: 8,
  timeoutSeconds: 5,
  inputPricePerMillionTokens: 2,
  outputPricePerMillionTokens: 8,
  mockMode: false,
};

function task(status: AiTask['status'], resultArtifactId?: string): AiTask {
  return {
    taskId: 'task-1',
    taskType: 'connection_test',
    novelId: 'system',
    scopeType: 'system',
    status,
    stateRevision: 1,
    inputSnapshotId: 'input-1',
    contextSnapshotId: 'context-1',
    constraintSnapshotId: 'constraint-1',
    currentAttemptId: status === 'ready' ? undefined : 'attempt-1',
    resultArtifactId,
    traceId: 'operation-1',
    operationId: 'operation-1',
    requestHashVersion: 1,
    requestHash: 'a'.repeat(64),
    expectedArtifactType: 'generic_text',
    expectedArtifactSchemaVersion: 1,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
  };
}

function attempt(
  status: AiTaskAttempt['status'],
  responseMetadataJson?: Record<string, unknown>,
): AiTaskAttempt {
  return {
    attemptId: 'attempt-1',
    taskId: 'task-1',
    attemptNumber: 1,
    providerId: status === 'queued' ? undefined : 'deepseek',
    modelId: status === 'queued' ? undefined : 'test-model',
    providerRequestId: status === 'queued' ? undefined : 'attempt-1',
    status,
    stateRevision: 1,
    responseMetadataJson:
      status === 'succeeded'
        ? (responseMetadataJson ?? {
            provider: 'deepseek',
            model: 'test-model',
            responseHash: 'b'.repeat(64),
            responseLength: 2,
            durationMs: 5,
          })
        : undefined,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
  };
}

function attemptResult(
  taskStatus: AiTask['status'],
  attemptStatus: AiTaskAttempt['status'],
): AiTaskAttemptResult {
  return { task: task(taskStatus), attempt: attempt(attemptStatus) };
}

function artifactBundle(
  input: CreateResultArtifactInput,
  processingStatus: ResultArtifactBundle['artifact']['processingStatus'] = 'valid',
): ResultArtifactBundle {
  return {
    artifact: {
      artifactId: 'artifact-1',
      taskId: input.taskId,
      attemptId: input.attemptId,
      sourceInputSnapshotId: 'input-1',
      artifactType: input.artifactType,
      schemaVersion: input.schemaVersion,
      rawContentRefId: 'raw-1',
      sourceNovelId: 'system',
      contentHash: 'c'.repeat(64),
      contentLength: Array.from(input.rawContent).length,
      processingStatus,
      createdAt: '2026-07-26T00:00:00Z',
    },
    rawContent: input.rawContent,
    structuredPayloadJson: input.structuredPayloadJson,
    issues: [],
  };
}

interface RuntimeObservations {
  created?: CreateAiTaskInput;
  claimedProviderRequestId?: string;
  metadata?: Record<string, unknown>;
  artifact?: CreateResultArtifactInput;
  cancellations: number;
  failures: number;
  failureCode?: string;
  failureRetryable?: boolean;
}

function createRuntime(
  observations: RuntimeObservations,
  overrides: Partial<AiExecutionDependencies['runtime']> = {},
): AiExecutionDependencies['runtime'] {
  const defaults: AiExecutionDependencies['runtime'] = {
    async create(input) {
      observations.created = input;
      return task('ready');
    },
    async get(): Promise<AiTaskDetail> {
      throw new Error('unexpected task replay');
    },
    async queueAttempt() {
      return attemptResult('queued', 'queued');
    },
    async claimAttempt(input) {
      observations.claimedProviderRequestId = input.providerRequestId;
      return attemptResult('running', 'running');
    },
    async markProviderSucceeded(_taskId, _attemptId, metadata) {
      observations.metadata = metadata;
      return attemptResult('validating', 'succeeded');
    },
    async failAttempt(_taskId, _attemptId, error) {
      observations.failures += 1;
      observations.failureCode = error.code;
      observations.failureRetryable = error.retryable;
      return attemptResult('failed', 'failed');
    },
    async cancel() {
      observations.cancellations += 1;
      return task('cancelled');
    },
    async createArtifact(input) {
      observations.artifact = input;
      return artifactBundle(input);
    },
    async getArtifact(): Promise<ResultArtifactBundle> {
      throw new Error('unexpected artifact replay');
    },
  };
  return { ...defaults, ...overrides };
}

function executionInput(): ExecuteAiTaskInput {
  return {
    operationId: 'operation-1',
    taskType: 'connection_test',
    scopeType: 'system',
    novelId: 'system',
    settings,
    compilation: { sources: [], taskInput: { purpose: 'test' } },
  };
}

async function compiledContract(
  providerId = 'deepseek',
  model = 'test-model',
): Promise<CompiledAiExecutionContractV1> {
  const promptTemplateBody = 'Reply OK only.';
  const messages = [
    { role: 'system' as const, content: promptTemplateBody },
    { role: 'user' as const, content: 'hi' },
  ];
  const requestBodyHash = await computeContentSha256(JSON.stringify({ messages }));
  const promptTemplateHash = await computeContentSha256(promptTemplateBody);
  const emptyContextHash = await computeContentSha256('');
  return {
    contractVersion: 'compiled_ai_execution_v1',
    taskType: 'connection_test',
    expectedArtifactType: 'generic_text',
    expectedArtifactSchemaVersion: 1,
    request: {
      taskType: 'connection_test',
      messages,
      temperature: 0.1,
      maxTokens: 8,
    },
    inputType: 'compiled_provider_messages_v1',
    inputPayloadJson: {
      contractVersion: 'compiled_ai_request_v1',
      taskType: 'connection_test',
      messageCount: 2,
      requestBodyHash,
      compilationHash: 'f'.repeat(64),
      taskInput: { purpose: 'test' },
    },
    contextSnapshot: {
      schemaVersion: 2,
      compilerVersion: 'context_compiler_v1',
      compiledContext: '',
      sourceManifestJson: {
        contractVersion: 'context_manifest_v1',
        compilerVersion: 'context_compiler_v1',
        tokenEstimator: 'utf8_bytes_div3_v1',
        compiledContextHash: emptyContextHash,
        missingSourceTypes: [],
        sources: [],
      },
      budgetJson: {
        contractVersion: 'context_budget_v1',
        tokenEstimator: 'utf8_bytes_div3_v1',
        modelContextTokens: 512,
        reservedOutputTokens: 8,
        fixedMessageTokens: 300,
        availableContextTokens: 204,
        compiledContextTokens: 0,
        compiledContextChars: 0,
        compiledContextBytes: 0,
        includedSourceCount: 0,
        truncatedSourceCount: 0,
        omittedSourceCount: 0,
      },
    },
    constraintSnapshot: {
      schemaVersion: 2,
      compilerVersion: 'constraint_compiler_v1',
      payloadJson: {
        contractVersion: 'constraint_payload_v1',
        compilerVersion: 'constraint_compiler_v1',
        taskType: 'connection_test',
        expectedArtifact: { type: 'generic_text', schemaVersion: 1 },
        responseSchema: 'exact_text_ok_v1',
        constraints: { exactText: 'OK' },
        constraintsHash: 'e'.repeat(64),
        toolPolicy: {
          registryVersion: 'tool_registry_v1',
          registryHash: 'd'.repeat(64),
          allowedTools: [],
        },
      },
      promptTemplateId: 'system/connection_test',
      promptTemplateVersion: '2',
      promptTemplateHash,
      promptTemplateBody,
      providerOptionsJson: {
        providerId,
        model,
        temperature: 0.1,
        maxTokens: 8,
      },
    },
  };
}

function dependencies(
  runtime: AiExecutionDependencies['runtime'],
  adapter: ProviderAdapter,
  isTauriRuntime = true,
): AiExecutionDependencies {
  return {
    runtime,
    createAdapter: () => adapter,
    compileContract: (input) => compiledContract(input.providerId, input.modelId),
    isTauriRuntime: () => isTauriRuntime,
    createId: () => 'operation-1',
  };
}

test('tracked pipeline persists safe snapshots, response identity and one artifact', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let providerCalls = 0;
  const providerText = 'OK\u{1F600}';
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      providerCalls += 1;
      return {
        text: providerText,
        providerId: 'deepseek',
        modelId: 'test-model',
        tokenInput: 4,
        tokenOutput: 2,
        tokenTotal: 6,
        finishReason: 'stop',
        usageCost: {
          currency: 'USD',
          source: 'user_configured',
          inputPricePerMillionTokens: 2,
          outputPricePerMillionTokens: 8,
          status: 'complete',
          estimatedCost: 0.000024,
        },
        durationMs: 12,
      };
    },
  };

  const result = await executeAiTask(
    executionInput(),
    dependencies(createRuntime(observations), adapter),
  );

  assert.equal(result.persistence, 'sqlite');
  assert.equal(providerCalls, 1);
  assert.equal(observations.claimedProviderRequestId, 'attempt-1');
  assert.deepEqual(observations.metadata, {
    provider: 'deepseek',
    model: 'test-model',
    providerRequestId: 'attempt-1',
    responseHash: await computeContentSha256(providerText),
    responseLength: 3,
    durationMs: 12,
    tokenInput: 4,
    tokenOutput: 2,
    tokenTotal: 6,
    finishReason: 'stop',
    costStatus: 'complete',
    costCurrency: 'USD',
    pricingSource: 'user_configured',
    costEstimate: 0.000024,
    inputPricePerMillionTokens: 2,
    outputPricePerMillionTokens: 8,
  });
  assert.equal(observations.artifact?.rawContent, providerText);
  const persistedTask = JSON.stringify(observations.created);
  assert.equal(persistedTask.includes(settings.apiKey), false);
  assert.equal(persistedTask.includes(settings.baseUrl), false);
  assert.equal(observations.created?.inputSnapshot.schemaVersion, 2);
  assert.equal(observations.created?.inputSnapshot.inputType, 'compiled_provider_messages_v1');
  assert.equal(observations.created?.contextSnapshot.schemaVersion, 2);
  assert.equal(observations.created?.contextSnapshot.compilerVersion, 'context_compiler_v1');
  assert.equal(observations.created?.constraintSnapshot.schemaVersion, 2);
  assert.equal(
    (observations.created?.constraintSnapshot.payloadJson as Record<string, unknown>)
      .compilerVersion,
    'constraint_compiler_v1',
  );
  assert.equal(observations.created?.constraintSnapshot.providerOptionsJson.providerId, 'deepseek');
  assert.equal(observations.created?.constraintSnapshot.providerOptionsJson.maxTokens, 8);
  assert.deepEqual(result.providerRequestEvidence, {
    schemaVersion: 'provider_request_evidence_v1',
    hashAlgorithm: 'sha256',
    messagesSerialization: 'json_stringify_messages_v1',
    messagesSha256: (observations.created?.inputSnapshot.payloadJson as { requestBodyHash: string })
      .requestBodyHash,
    messageCount: 2,
    compiledContextSha256: (
      observations.created?.contextSnapshot.sourceManifestJson as {
        compiledContextHash: string;
      }
    ).compiledContextHash,
    sources: [],
    requestContextSources: [],
  });
  const serializedEvidence = JSON.stringify(result.providerRequestEvidence);
  assert.equal(serializedEvidence.includes(settings.apiKey), false);
  assert.equal(serializedEvidence.includes(settings.baseUrl), false);
  assert.equal(serializedEvidence.includes('Reply OK only.'), false);
  assert.equal(serializedEvidence.includes(providerText), false);
});

test('tracked pipeline projects the formal task into the task center with the same identity', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let projectedId: string | undefined;
  let projectedNovelId: string | undefined;
  let projectedChapterId: string | undefined;
  let projectedTokens: { input?: number; output?: number; total?: number } | undefined;
  let projectedResultText: string | undefined;
  let projectedRunning = 0;
  let released = false;
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      return {
        text: 'OK',
        providerId: 'deepseek',
        modelId: 'test-model',
        tokenInput: 4,
        tokenOutput: 2,
        tokenTotal: 6,
        durationMs: 1,
      };
    },
  };
  const deps = dependencies(createRuntime(observations), adapter);
  deps.projection = {
    async create(taskType, input) {
      projectedId = input.id;
      projectedNovelId = input.novelId;
      projectedChapterId = input.chapterId;
      return {
        id: input.id!,
        taskType,
        status: 'running',
        createdAt: '2026-07-29T00:00:00Z',
      };
    },
    async markSucceeded(_id, result) {
      projectedResultText = result.resultText;
      projectedTokens = {
        input: result.tokenInput,
        output: result.tokenOutput,
        total: result.tokenTotal,
      };
    },
    async markRunningForRetry() {
      projectedRunning += 1;
    },
    async markFailed() {},
    async markCancelled() {},
    registerActiveExecution() {
      return () => {
        released = true;
      };
    },
  };

  const result = await executeAiTask(executionInput(), deps);

  assert.equal(projectedId, result.taskId);
  assert.equal(projectedNovelId, undefined);
  assert.equal(projectedChapterId, undefined);
  assert.equal(projectedResultText, 'OK');
  assert.equal(projectedRunning, 1);
  assert.deepEqual(projectedTokens, { input: 4, output: 2, total: 6 });
  assert.equal(released, true);
});

test('task-center cancellation owner aborts the formal provider request and settles both facts', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let cancelOwner: (() => void) | undefined;
  let projectedCancelled = 0;
  let released = false;
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute(_request, options) {
      cancelOwner?.();
      assert.equal(options?.signal?.aborted, true);
      throw new AiRequestCancelledError();
    },
  };
  let cancelCalls = 0;
  const runtime = createRuntime(observations, {
    async cancel() {
      observations.cancellations += 1;
      cancelCalls += 1;
      return task(cancelCalls === 1 ? 'cancel_requested' : 'cancelled');
    },
  });
  const deps = dependencies(runtime, adapter);
  deps.projection = {
    async create(taskType, input) {
      return {
        id: input.id!,
        taskType,
        status: 'running',
        createdAt: '2026-07-29T00:00:00Z',
      };
    },
    async markSucceeded() {},
    async markFailed() {},
    async markCancelled() {
      projectedCancelled += 1;
    },
    registerActiveExecution(_id, cancel) {
      cancelOwner = cancel;
      return () => {
        released = true;
      };
    },
  };

  await assert.rejects(
    () => executeAiTask(executionInput(), deps),
    (error: unknown) => error instanceof AiExecutionError && error.code === 'AI_PROVIDER_CANCELLED',
  );
  assert.equal(observations.cancellations, 2);
  assert.equal(projectedCancelled, 1);
  assert.equal(released, true);
});

test('invalid artifacts fail the task-center projection without reporting a usable result', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let projectedSucceeded = 0;
  let projectedFailed = 0;
  const runtime = createRuntime(observations, {
    async createArtifact(input) {
      observations.artifact = input;
      return artifactBundle(input, 'invalid');
    },
  });
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      return {
        text: 'invalid-result',
        providerId: 'deepseek',
        modelId: 'test-model',
        durationMs: 1,
      };
    },
  };
  const deps = dependencies(runtime, adapter);
  deps.projection = {
    async create(taskType, input) {
      return {
        id: input.id!,
        taskType,
        status: 'running',
        createdAt: '2026-07-29T00:00:00Z',
      };
    },
    async markSucceeded() {
      projectedSucceeded += 1;
    },
    async markFailed() {
      projectedFailed += 1;
    },
    async markCancelled() {},
    registerActiveExecution() {
      return () => {};
    },
  };

  await assert.rejects(
    () => executeAiTask(executionInput(), deps),
    (error: unknown) =>
      error instanceof AiExecutionError && error.code === 'ARTIFACT_VALIDATION_FAILED',
  );
  assert.equal(projectedSucceeded, 0);
  assert.equal(projectedFailed, 1);
  assert.equal(observations.failures, 0);
  assert.equal(observations.cancellations, 0);
});

test('late provider responses settle an already-cancelled formal task and its projection', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let projectedCancelled = 0;
  const runtime = createRuntime(observations, {
    async markProviderSucceeded() {
      return attemptResult('cancelled', 'late_response_ignored');
    },
  });
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      return {
        text: 'late-result',
        providerId: 'deepseek',
        modelId: 'test-model',
        durationMs: 1,
      };
    },
  };
  const deps = dependencies(runtime, adapter);
  deps.projection = {
    async create(taskType, input) {
      return {
        id: input.id!,
        taskType,
        status: 'running',
        createdAt: '2026-07-29T00:00:00Z',
      };
    },
    async markSucceeded() {},
    async markFailed() {},
    async markCancelled() {
      projectedCancelled += 1;
    },
    registerActiveExecution() {
      return () => {};
    },
  };

  await assert.rejects(
    () => executeAiTask(executionInput(), deps),
    (error: unknown) => error instanceof AiExecutionError && error.code === 'AI_PROVIDER_CANCELLED',
  );
  assert.equal(projectedCancelled, 1);
  assert.equal(observations.cancellations, 0);
  assert.equal(observations.artifact, undefined);
});

test('governed pipeline forwards transient stream options to the provider adapter', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let receivedOptions: Parameters<ProviderAdapter['execute']>[1];
  const onStreamEvent = () => undefined;
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute(_request, options) {
      receivedOptions = options;
      return {
        text: 'OK',
        providerId: 'deepseek',
        modelId: 'test-model',
        durationMs: 1,
      };
    },
  };

  await executeAiTask(
    {
      ...executionInput(),
      stream: true,
      onStreamEvent,
    },
    dependencies(createRuntime(observations), adapter, false),
  );

  assert.equal(receivedOptions?.requestId, 'operation-1');
  assert.equal(receivedOptions?.stream, true);
  assert.equal(receivedOptions?.onStreamEvent, onStreamEvent);
});

for (const [label, usageCost] of [
  [
    'forged cost status',
    {
      currency: 'USD',
      source: 'user_configured',
      inputPricePerMillionTokens: 2,
      outputPricePerMillionTokens: 8,
      status: 'forged',
      estimatedCost: 0.000024,
    },
  ],
  [
    'negative frozen input rate',
    {
      currency: 'USD',
      source: 'user_configured',
      inputPricePerMillionTokens: -1,
      outputPricePerMillionTokens: 8,
      status: 'complete',
      estimatedCost: 0.000024,
    },
  ],
] as const) {
  test(`tracked pipeline rejects ${label} before response metadata persistence`, async () => {
    const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
    const adapter: ProviderAdapter = {
      providerId: 'deepseek',
      modelId: 'test-model',
      async execute() {
        return {
          text: 'OK',
          providerId: 'deepseek',
          modelId: 'test-model',
          usageCost: usageCost as unknown as NonNullable<ProviderAdapterResult['usageCost']>,
          durationMs: 1,
        };
      },
    };

    await assert.rejects(
      executeAiTask(executionInput(), dependencies(createRuntime(observations), adapter)),
      (error: unknown) =>
        error instanceof AiExecutionError &&
        error.code === 'AI_RESPONSE_METADATA_INVALID' &&
        error.retryable === false,
    );
    assert.equal(observations.metadata, undefined);
    assert.equal(observations.artifact, undefined);
    assert.equal(observations.failures, 1);
  });
}

test('pipeline rejects a compiled contract with changed task or provider identity before persistence', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let providerCalls = 0;
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      providerCalls += 1;
      return {
        text: 'OK',
        providerId: 'deepseek',
        modelId: 'test-model',
        durationMs: 1,
      };
    },
  };
  const injected = dependencies(createRuntime(observations), adapter);
  injected.compileContract = async () => ({
    ...(await compiledContract('other-provider', 'test-model')),
    taskType: 'setting_expand',
  });
  await assert.rejects(
    () => executeAiTask(executionInput(), injected),
    (error: unknown) =>
      error instanceof AiExecutionError && error.code === 'AI_COMPILATION_INPUT_INVALID',
  );
  assert.equal(providerCalls, 0);
  assert.equal(observations.created, undefined);
});

test('commit-unknown replay does not dispatch the provider twice', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let providerCalls = 0;
  let markCalls = 0;
  const runtime = createRuntime(observations, {
    async markProviderSucceeded(_taskId, _attemptId, metadata) {
      markCalls += 1;
      if (markCalls === 1) {
        throw {
          code: 'DATABASE_COMMIT_UNKNOWN',
          message: 'commit response lost',
          retryable: true,
        };
      }
      observations.metadata = metadata;
      return attemptResult('validating', 'succeeded');
    },
  });
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      providerCalls += 1;
      return {
        text: 'OK',
        providerId: 'deepseek',
        modelId: 'test-model',
        durationMs: 1,
      };
    },
  };

  await executeAiTask(executionInput(), dependencies(runtime, adapter));
  assert.equal(providerCalls, 1);
  assert.equal(markCalls, 2);
});

test('provider cancellation cancels the durable task without creating an artifact', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      throw new AiRequestCancelledError();
    },
  };

  await assert.rejects(
    executeAiTask(executionInput(), dependencies(createRuntime(observations), adapter)),
    (error: unknown) => error instanceof AiExecutionError && error.code === 'AI_PROVIDER_CANCELLED',
  );
  assert.equal(observations.cancellations, 1);
  assert.equal(observations.failures, 0);
  assert.equal(observations.artifact, undefined);
});

test('plain Tauri Provider errors retain safe details and stable non-retryable classification', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      throw 'AI 调用失败：API Key 无效或已过期（401 Unauthorized），请检查设置中心的 API Key。';
    },
  };

  await assert.rejects(
    executeAiTask(executionInput(), dependencies(createRuntime(observations), adapter)),
    (error: unknown) =>
      error instanceof AiExecutionError &&
      error.code === 'AI_PROVIDER_AUTHENTICATION_FAILED' &&
      error.retryable === false &&
      error.message.includes('401 Unauthorized'),
  );
  assert.equal(observations.failures, 1);
  assert.equal(observations.cancellations, 0);
  assert.equal(observations.artifact, undefined);
});

test('output-token truncation is persisted as a retryable malformed provider response', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      throw new Error(
        'AI 调用失败：模型在输出 Token 上限处停止，未返回最终内容；请提高最大输出 Token 后重试。',
      );
    },
  };

  await assert.rejects(
    executeAiTask(executionInput(), dependencies(createRuntime(observations), adapter)),
    (error: unknown) =>
      error instanceof AiExecutionError &&
      error.code === 'AI_PROVIDER_MALFORMED_RESPONSE' &&
      error.retryable === true,
  );
  assert.equal(observations.failures, 1);
  assert.equal(observations.failureCode, 'AI_PROVIDER_MALFORMED_RESPONSE');
  assert.equal(observations.failureRetryable, true);
});

test('browser fallback remains ephemeral and never fabricates Task or Artifact facts', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let providerCalls = 0;
  const adapter: ProviderAdapter = {
    providerId: 'mock',
    modelId: 'Mock',
    async execute() {
      providerCalls += 1;
      return {
        text: '{"settings":[]}',
        providerId: 'mock',
        modelId: 'Mock',
        durationMs: 0,
      };
    },
  };

  const result = await executeAiTask(
    {
      ...executionInput(),
      parseStructuredPayload: (text) => JSON.parse(text) as unknown,
    },
    dependencies(createRuntime(observations), adapter, false),
  );

  assert.equal(providerCalls, 1);
  assert.equal(result.persistence, 'ephemeral_browser');
  assert.equal(result.taskId, undefined);
  assert.equal(result.artifactBundle, undefined);
  assert.equal(observations.created, undefined);
  assert.match(result.providerRequestEvidence?.messagesSha256 ?? '', /^[0-9a-f]{64}$/);
});

test('invalid artifact replay remains failed and never dispatches the provider again', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  const replayInput: CreateResultArtifactInput = {
    taskId: 'task-1',
    attemptId: 'attempt-1',
    artifactType: 'generic_text',
    schemaVersion: 1,
    rawContent: 'invalid-result',
  };
  let providerCalls = 0;
  let projectedFailed = 0;
  const runtime = createRuntime(observations, {
    async create(input) {
      observations.created = input;
      return task('failed', 'artifact-1');
    },
    async get() {
      return {
        task: task('failed', 'artifact-1'),
        attempts: [attempt('succeeded')],
        inputSnapshot: {} as AiTaskDetail['inputSnapshot'],
        contextSnapshot: {} as AiTaskDetail['contextSnapshot'],
        constraintSnapshot: {} as AiTaskDetail['constraintSnapshot'],
      };
    },
    async getArtifact() {
      return artifactBundle(replayInput, 'invalid');
    },
  });
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      providerCalls += 1;
      throw new Error('provider must not run during invalid replay');
    },
  };
  const deps = dependencies(runtime, adapter);
  deps.projection = {
    async create(taskType, input) {
      return {
        id: input.id!,
        taskType,
        status: 'running',
        createdAt: '2026-07-29T00:00:00Z',
      };
    },
    async markSucceeded() {},
    async markFailed() {
      projectedFailed += 1;
    },
    async markCancelled() {},
    registerActiveExecution() {
      return () => {};
    },
  };

  await assert.rejects(
    () => executeAiTask(executionInput(), deps),
    (error: unknown) =>
      error instanceof AiExecutionError && error.code === 'ARTIFACT_VALIDATION_FAILED',
  );
  assert.equal(providerCalls, 0);
  assert.equal(projectedFailed, 1);
  assert.equal(observations.failures, 0);
  assert.equal(observations.cancellations, 0);
});

test('completed operation replay reads the persisted Artifact without another API call', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  const replayInput: CreateResultArtifactInput = {
    taskId: 'task-1',
    attemptId: 'attempt-1',
    artifactType: 'generic_text',
    schemaVersion: 1,
    rawContent: 'OK',
  };
  const replayBundle = artifactBundle(replayInput);
  let providerCalls = 0;
  const runtime = createRuntime(observations, {
    async create(input) {
      observations.created = input;
      return task('completed', 'artifact-1');
    },
    async get() {
      return {
        task: task('completed', 'artifact-1'),
        attempts: [
          attempt('succeeded', {
            provider: 'deepseek',
            model: 'test-model',
            responseHash: 'b'.repeat(64),
            responseLength: 2,
            durationMs: 5,
            costStatus: 'complete',
            costCurrency: 'USD',
            pricingSource: 'user_configured',
            costEstimate: 0.000024,
            inputPricePerMillionTokens: 2,
            outputPricePerMillionTokens: 8,
          }),
        ],
        inputSnapshot: {} as AiTaskDetail['inputSnapshot'],
        contextSnapshot: {} as AiTaskDetail['contextSnapshot'],
        constraintSnapshot: {} as AiTaskDetail['constraintSnapshot'],
      };
    },
    async getArtifact() {
      return replayBundle;
    },
  });
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      providerCalls += 1;
      throw new Error('provider must not run during replay');
    },
  };

  const result = await executeAiTask(executionInput(), dependencies(runtime, adapter));
  assert.equal(result.text, 'OK');
  assert.equal(result.artifactBundle?.artifact.artifactId, 'artifact-1');
  assert.deepEqual(result.provider.usageCost, {
    status: 'complete',
    currency: 'USD',
    source: 'user_configured',
    estimatedCost: 0.000024,
    inputPricePerMillionTokens: 2,
    outputPricePerMillionTokens: 8,
  });
  assert.equal(providerCalls, 0);
});

test('completed replay rejects tampered cost facts while preserving the verified Artifact', async () => {
  const replayInput: CreateResultArtifactInput = {
    taskId: 'task-1',
    attemptId: 'attempt-1',
    artifactType: 'generic_text',
    schemaVersion: 1,
    rawContent: 'OK',
  };
  const validCostMetadata = {
    provider: 'deepseek',
    model: 'test-model',
    responseHash: 'b'.repeat(64),
    responseLength: 2,
    durationMs: 5,
    costStatus: 'complete',
    costCurrency: 'USD',
    pricingSource: 'user_configured',
    costEstimate: 0.000024,
    inputPricePerMillionTokens: 2,
    outputPricePerMillionTokens: 8,
  };
  const tamperedVariants: Record<string, unknown>[] = [
    { ...validCostMetadata, costStatus: 'forged' },
    { ...validCostMetadata, inputPricePerMillionTokens: -1 },
    { ...validCostMetadata, outputPricePerMillionTokens: 1_000_001 },
    {
      ...validCostMetadata,
      costStatus: 'mock',
      pricingSource: 'mock',
      costEstimate: 0,
    },
    {
      ...validCostMetadata,
      costStatus: 'usage_missing',
    },
  ];

  for (const responseMetadataJson of tamperedVariants) {
    const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
    const runtime = createRuntime(observations, {
      async create(input) {
        observations.created = input;
        return task('completed', 'artifact-1');
      },
      async get() {
        return {
          task: task('completed', 'artifact-1'),
          attempts: [attempt('succeeded', responseMetadataJson)],
          inputSnapshot: {} as AiTaskDetail['inputSnapshot'],
          contextSnapshot: {} as AiTaskDetail['contextSnapshot'],
          constraintSnapshot: {} as AiTaskDetail['constraintSnapshot'],
        };
      },
      async getArtifact() {
        return artifactBundle(replayInput);
      },
    });
    const adapter: ProviderAdapter = {
      providerId: 'deepseek',
      modelId: 'test-model',
      async execute() {
        throw new Error('provider must not run during replay');
      },
    };

    const result = await executeAiTask(executionInput(), dependencies(runtime, adapter));
    assert.equal(result.text, 'OK');
    assert.equal(result.provider.usageCost, undefined);
  }
});

test('default Provider Adapter executes the existing Mock client through the same contract', async () => {
  const mockSettings: AiSettings = {
    ...settings,
    runtimeMode: 'mock',
    provider: 'mock',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    mockMode: true,
  };
  const adapter = createProviderAdapter(mockSettings);
  const result = await adapter.execute({
    taskType: 'connection_test',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 8,
  });

  assert.equal(adapter.providerId, 'mock');
  assert.equal(adapter.modelId, 'Mock');
  assert.equal(result.text.trim(), 'OK');
});

test('local chapter adapter keeps real API and unpriced provenance separate from global Mock mode', () => {
  const adapter = createProviderAdapter(
    {
      ...settings,
      runtimeMode: 'mock',
      provider: 'mock',
      mockMode: true,
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
      },
    },
    'chapter_scene_generate',
    {
      selected: {
        endpointId: 'local.local_llama_cpp.qwen35-9b-novel-v3',
        providerId: 'local_llama_cpp',
        modelId: 'qwen35-9b-novel-v3',
        kind: 'local',
      },
    },
  );

  assert.equal(adapter.runtimeMode, 'api');
  assert.equal(adapter.pricingSnapshot?.source, 'unconfigured');
  assert.equal(adapter.providerId, 'local_llama_cpp');
  assert.equal(adapter.modelId, 'qwen35-9b-novel-v3');
});

test('writer route can select the cloud beat endpoint without using the local model', () => {
  const adapter = createProviderAdapter(
    {
      ...settings,
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'secret',
      modelName: 'deepseek-v4-flash',
      mockMode: false,
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
      },
    },
    'chapter_scene_generate',
    {
      selected: {
        endpointId: 'cloud.deepseek.deepseek-v4-flash',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        kind: 'cloud',
      },
    },
  );

  assert.equal(adapter.providerId, 'deepseek');
  assert.equal(adapter.modelId, 'deepseek-v4-flash');
  assert.equal(adapter.runtimeMode, 'api');
});

test('cloud-only settings execute the Beat contract without any local model configuration', () => {
  const cloudSettings: AiSettings = {
    ...settings,
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://cloud-writer.example/v1',
    apiKey: 'cloud-secret',
    modelName: 'temporary-cloud-writer',
    mockMode: false,
  };
  const adapter = createProviderAdapter(cloudSettings, 'chapter_scene_generate', {
    selected: {
      endpointId: 'cloud.openai_compatible.temporary-cloud-writer',
      providerId: 'openai_compatible',
      modelId: 'temporary-cloud-writer',
      kind: 'cloud',
    },
  });

  assert.equal(adapter.providerId, 'openai_compatible');
  assert.equal(adapter.modelId, 'temporary-cloud-writer');
  assert.equal(adapter.runtimeMode, 'api');
  assert.throws(
    () => createProviderAdapter(cloudSettings, 'chapter_scene_generate'),
    /必须携带冻结的 Model Router 决策/,
  );
  assert.throws(
    () =>
      createProviderAdapter(cloudSettings, 'chapter_scene_generate', {
        selected: {
          endpointId: 'local.local_llama_cpp.untrained-model',
          providerId: 'local_llama_cpp',
          modelId: 'untrained-model',
          kind: 'local',
        },
      }),
    /未启用的专用本地正文模型/,
  );
});

test('local chapter adapter rejects a non-loopback endpoint before provider dispatch', () => {
  assert.throws(
    () =>
      createProviderAdapter(
        {
          ...settings,
          runtimeMode: 'mock',
          provider: 'mock',
          mockMode: true,
          localChapterModel: {
            enabled: true,
            providerId: 'local_llama_cpp',
            baseUrl: 'https://provider.example/v1',
            apiKey: 'must-not-leave-device',
            modelName: 'qwen35-9b-novel-v3',
            timeoutSeconds: 120,
            contextTokens: 4096,
            maxTokens: 1024,
            temperature: 0.7,
            topP: 0.8,
            topK: 20,
            repeatPenalty: 1.08,
          },
        },
        'chapter_scene_generate',
        {
          selected: {
            endpointId: 'local.local_llama_cpp.qwen35-9b-novel-v3',
            providerId: 'local_llama_cpp',
            modelId: 'qwen35-9b-novel-v3',
            kind: 'local',
          },
        },
      ),
    /只允许 localhost、127\.0\.0\.0\/8 或 \[::1\]/,
  );
});
