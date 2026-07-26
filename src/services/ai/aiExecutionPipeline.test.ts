import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import type {
  AiTask,
  AiTaskAttempt,
  AiTaskAttemptResult,
  AiTaskDetail,
  CreateAiTaskInput,
} from '../../types/ai-task';
import type {
  CreateResultArtifactInput,
  ResultArtifactBundle,
} from '../../types/result-artifact';
import { AiRequestCancelledError } from './aiCancellation';
import {
  AiExecutionError,
  executeAiTask,
  type AiExecutionDependencies,
  type ExecuteAiTaskInput,
} from './aiExecutionPipeline';
import { createProviderAdapter, type ProviderAdapter } from './providerAdapter';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'never-persist-this-secret-key',
  modelName: 'test-model',
  temperature: 0.1,
  maxTokens: 8,
  timeoutSeconds: 5,
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

function attempt(status: AiTaskAttempt['status']): AiTaskAttempt {
  return {
    attemptId: 'attempt-1',
    taskId: 'task-1',
    attemptNumber: 1,
    providerId: status === 'queued' ? undefined : 'deepseek',
    modelId: status === 'queued' ? undefined : 'test-model',
    providerRequestId: status === 'queued' ? undefined : 'attempt-1',
    status,
    stateRevision: 1,
    responseMetadataJson: status === 'succeeded'
      ? {
          provider: 'deepseek',
          model: 'test-model',
          responseHash: 'b'.repeat(64),
          responseLength: 2,
          durationMs: 5,
        }
      : undefined,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:00:00Z',
  };
}

function attemptResult(taskStatus: AiTask['status'], attemptStatus: AiTaskAttempt['status']): AiTaskAttemptResult {
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
    async failAttempt() {
      observations.failures += 1;
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
    expectedArtifactType: 'generic_text',
    request: {
      taskType: 'connection_test',
      messages: [
        { role: 'system', content: 'Reply OK only.' },
        { role: 'user', content: 'hi' },
      ],
      temperature: 0.1,
      maxTokens: 8,
    },
    settings,
    inputType: 'connection_test_messages_v1',
    inputPayloadJson: { purpose: 'test' },
    sourceManifestJson: { sources: [] },
    compiledContext: 'Reply OK only.',
    promptTemplateId: 'system/connection_test',
    promptTemplateVersion: '1',
    promptTemplateBody: 'Reply OK only.',
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
    isTauriRuntime: () => isTauriRuntime,
    createId: () => 'operation-1',
  };
}

test('tracked pipeline persists safe snapshots, response identity and one artifact', async () => {
  const observations: RuntimeObservations = { cancellations: 0, failures: 0 };
  let providerCalls = 0;
  const adapter: ProviderAdapter = {
    providerId: 'deepseek',
    modelId: 'test-model',
    async execute() {
      providerCalls += 1;
      return {
        text: 'OK😀',
        providerId: 'deepseek',
        modelId: 'test-model',
        tokenInput: 4,
        tokenOutput: 2,
        tokenTotal: 6,
        finishReason: 'stop',
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
  assert.equal(observations.metadata?.responseLength, 3);
  assert.match(String(observations.metadata?.responseHash), /^[0-9a-f]{64}$/);
  assert.equal(observations.artifact?.rawContent, 'OK😀');
  const persistedTask = JSON.stringify(observations.created);
  assert.equal(persistedTask.includes(settings.apiKey), false);
  assert.equal(persistedTask.includes(settings.baseUrl), false);
  assert.equal(observations.created?.constraintSnapshot.providerOptionsJson.providerId, 'deepseek');
  assert.equal(observations.created?.constraintSnapshot.providerOptionsJson.maxTokens, 8);
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
    executeAiTask(
      executionInput(),
      dependencies(createRuntime(observations), adapter),
    ),
    (error: unknown) => error instanceof AiExecutionError
      && error.code === 'AI_PROVIDER_CANCELLED',
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
    executeAiTask(
      executionInput(),
      dependencies(createRuntime(observations), adapter),
    ),
    (error: unknown) => error instanceof AiExecutionError
      && error.code === 'AI_PROVIDER_AUTHENTICATION_FAILED'
      && error.retryable === false
      && error.message.includes('401 Unauthorized'),
  );
  assert.equal(observations.failures, 1);
  assert.equal(observations.cancellations, 0);
  assert.equal(observations.artifact, undefined);
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
        attempts: [attempt('succeeded')],
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
  assert.equal(providerCalls, 0);
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
