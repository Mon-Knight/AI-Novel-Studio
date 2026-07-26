import type { AiSettings } from '../../types/ai';
import type {
  AiExecutionCompilationInput,
  CompiledAiExecutionContractV1,
} from '../../types/aiCompilation';
import type {
  AiTask,
  AiTaskAttempt,
  AiTaskDetail,
  AiTaskType,
  CreateAiTaskInput,
} from '../../types/ai-task';
import type {
  CreateResultArtifactInput,
  ResultArtifactBundle,
} from '../../types/result-artifact';
import {
  normalizeAppError,
  type AppError,
} from '../../types/appError';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { isTauri } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from './aiCancellation';
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderAdapterResult,
} from './providerAdapter';

export type AiExecutionPersistence = 'sqlite' | 'ephemeral_browser';

export interface ExecuteAiTaskInput {
  operationId?: string;
  traceId?: string;
  taskType: AiTaskType;
  scopeType: CreateAiTaskInput['scopeType'];
  novelId: string;
  chapterId?: string;
  draftId?: string;
  targetHintJson?: unknown;
  settings: AiSettings;
  compilation: AiExecutionCompilationInput;
  parseStructuredPayload?: (text: string) => unknown | undefined;
  signal?: AbortSignal;
}

export interface AiExecutionResult {
  persistence: AiExecutionPersistence;
  text: string;
  structuredPayloadJson?: unknown;
  provider: ProviderAdapterResult;
  taskId?: string;
  attemptId?: string;
  artifactBundle?: ResultArtifactBundle;
}

interface RuntimePort {
  create: typeof aiTaskRuntimeService.create;
  get: typeof aiTaskRuntimeService.get;
  queueAttempt: typeof aiTaskRuntimeService.queueAttempt;
  claimAttempt: typeof aiTaskRuntimeService.claimAttempt;
  markProviderSucceeded: typeof aiTaskRuntimeService.markProviderSucceeded;
  failAttempt: typeof aiTaskRuntimeService.failAttempt;
  cancel: typeof aiTaskRuntimeService.cancel;
  createArtifact: typeof aiTaskRuntimeService.createArtifact;
  getArtifact: typeof aiTaskRuntimeService.getArtifact;
}

export interface AiExecutionDependencies {
  runtime: RuntimePort;
  createAdapter: (settings: AiSettings) => ProviderAdapter;
  compileContract: (input: {
    taskType: AiTaskType;
    scope: {
      scopeType: CreateAiTaskInput['scopeType'];
      novelId: string;
      chapterId?: string;
      draftId?: string;
    };
    compilation: AiExecutionCompilationInput;
    settings: AiSettings;
    providerId: string;
    modelId: string;
  }) => Promise<CompiledAiExecutionContractV1>;
  isTauriRuntime: () => boolean;
  createId: () => string;
}

const defaultDependencies: AiExecutionDependencies = {
  runtime: aiTaskRuntimeService,
  createAdapter: createProviderAdapter,
  compileContract: async (input) => {
    const { compileProductionAiExecution } = await import(
      './compilation/productionCompilationRegistry'
    );
    return compileProductionAiExecution(input);
  },
  isTauriRuntime: isTauri,
  createId: () => globalThis.crypto?.randomUUID?.()
    ?? `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`,
};

export class AiExecutionError extends Error implements AppError {
  readonly code: string;
  readonly retryable: boolean;
  readonly traceId?: string;
  readonly operationId?: string;
  readonly details?: Record<string, unknown>;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'AiExecutionError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.traceId = error.traceId;
    this.operationId = error.operationId;
    this.details = error.details;
  }
}

function toExecutionError(error: AppError): AiExecutionError {
  return error instanceof AiExecutionError ? error : new AiExecutionError(error);
}

function mapProviderError(
  error: unknown,
  context: Pick<AppError, 'traceId' | 'operationId'>,
): AiExecutionError {
  if (isAiRequestCancelled(error)) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_CANCELLED',
      message: 'AI 请求已取消。',
      retryable: false,
      ...context,
    });
  }
  const normalized = normalizeAppError(error, 'AI Provider 执行失败。', context);
  if (normalized.code !== 'UNKNOWN_ERROR') return toExecutionError(normalized);
  // Tauri 1.x commands may reject with a plain string instead of an Error.
  // Preserve that already-sanitized backend message so HTTP/config failures do
  // not collapse into the generic network bucket.
  const message = typeof error === 'string' && error.trim()
    ? error.trim()
    : normalized.message;
  const lower = message.toLowerCase();
  if (lower.includes('cancel') || message.includes('取消')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_CANCELLED',
      message: 'AI 请求已取消。',
      retryable: false,
      ...context,
    });
  }
  if (lower.includes('timeout') || message.includes('超时')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_TIMEOUT',
      message,
      retryable: true,
      ...context,
    });
  }
  if (lower.includes('429') || message.includes('频繁') || message.includes('额度')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_RATE_LIMITED',
      message,
      retryable: true,
      ...context,
    });
  }
  if (/\b(?:401|403)\b/.test(lower)
    || lower.includes('unauthorized')
    || lower.includes('forbidden')
    || message.includes('API Key 无效')
    || message.includes('无权访问模型')
    || message.includes('服务拒绝访问')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_AUTHENTICATION_FAILED',
      message,
      retryable: false,
      ...context,
    });
  }
  if (/\b400\b/.test(lower) || message.includes('请求参数不合法')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_REQUEST_REJECTED',
      message,
      retryable: false,
      ...context,
    });
  }
  if (/\b5\d\d\b/.test(lower) || message.includes('过载') || message.includes('服务错误')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_SERVER_ERROR',
      message,
      retryable: true,
      ...context,
    });
  }
  if (message.includes('解析') || message.includes('格式') || message.includes('空内容')) {
    return new AiExecutionError({
      code: 'AI_PROVIDER_MALFORMED_RESPONSE',
      message,
      retryable: false,
      ...context,
    });
  }
  return new AiExecutionError({
    code: 'AI_PROVIDER_NETWORK_ERROR',
    message,
    retryable: true,
    ...context,
  });
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function safeStructuredPayload(
  parser: ExecuteAiTaskInput['parseStructuredPayload'],
  text: string,
): unknown | undefined {
  if (!parser) return undefined;
  try {
    return parser(text);
  } catch {
    return undefined;
  }
}

async function withCommitReplay<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const normalized = normalizeAppError(error);
    if (normalized.code !== 'DATABASE_COMMIT_UNKNOWN') throw error;
    return await operation();
  }
}

async function requireSha256(value: string): Promise<string> {
  const hash = await computeContentSha256(value);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new AiExecutionError({
      code: 'AI_CONTEXT_BUILD_FAILED',
      message: '当前环境不能生成可靠的 SHA-256。',
      retryable: false,
    });
  }
  return hash;
}

function providerMetadata(
  provider: ProviderAdapterResult,
  responseHash: string,
  responseLength: number,
  providerRequestId: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    provider: provider.providerId,
    model: provider.modelId,
    providerRequestId,
    responseHash,
    responseLength,
    durationMs: provider.durationMs,
  };
  if (provider.tokenInput !== undefined) metadata.tokenInput = provider.tokenInput;
  if (provider.tokenOutput !== undefined) metadata.tokenOutput = provider.tokenOutput;
  if (provider.tokenTotal !== undefined) metadata.tokenTotal = provider.tokenTotal;
  if (provider.finishReason !== undefined) metadata.finishReason = provider.finishReason;
  return metadata;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function providerFromReplay(
  attempt: AiTaskAttempt | undefined,
  bundle: ResultArtifactBundle,
): ProviderAdapterResult {
  const metadata = attempt?.responseMetadataJson ?? {};
  return {
    text: bundle.rawContent,
    providerId: optionalString(metadata.provider) ?? attempt?.providerId ?? 'unknown',
    modelId: optionalString(metadata.model) ?? attempt?.modelId ?? 'unknown',
    tokenInput: optionalNumber(metadata.tokenInput),
    tokenOutput: optionalNumber(metadata.tokenOutput),
    tokenTotal: optionalNumber(metadata.tokenTotal),
    finishReason: optionalString(metadata.finishReason),
    durationMs: optionalNumber(metadata.durationMs) ?? 0,
  };
}

async function replayCompletedTask(
  runtime: RuntimePort,
  task: AiTask,
): Promise<AiExecutionResult | undefined> {
  if (!task.resultArtifactId) return undefined;
  const [detail, artifactBundle]: [AiTaskDetail, ResultArtifactBundle] = await Promise.all([
    runtime.get(task.taskId, task.traceId),
    runtime.getArtifact(task.resultArtifactId),
  ]);
  const attempt = detail.attempts.find(
    (candidate) => candidate.attemptId === artifactBundle.artifact.attemptId,
  );
  return {
    persistence: 'sqlite',
    text: artifactBundle.rawContent,
    structuredPayloadJson: artifactBundle.structuredPayloadJson,
    provider: providerFromReplay(attempt, artifactBundle),
    taskId: task.taskId,
    attemptId: artifactBundle.artifact.attemptId,
    artifactBundle,
  };
}

async function buildTaskInput(
  input: ExecuteAiTaskInput,
  contract: CompiledAiExecutionContractV1,
  adapter: ProviderAdapter,
  operationId: string,
): Promise<CreateAiTaskInput> {
  if (contract.contractVersion !== 'compiled_ai_execution_v1'
    || contract.taskType !== input.taskType
    || contract.constraintSnapshot.providerOptionsJson.providerId !== adapter.providerId
    || contract.constraintSnapshot.providerOptionsJson.model !== adapter.modelId) {
    throw new AiExecutionError({
      code: 'AI_COMPILATION_INPUT_INVALID',
      message: '编译契约与 Task 或 Provider identity 不一致。',
      retryable: false,
    });
  }
  const serializedMessages = JSON.stringify({ messages: contract.request.messages });
  const requestBodyHash = await requireSha256(serializedMessages);
  const promptTemplateHash = await requireSha256(
    contract.constraintSnapshot.promptTemplateBody,
  );
  const compiledContextHash = await requireSha256(contract.contextSnapshot.compiledContext);
  if (requestBodyHash !== contract.inputPayloadJson.requestBodyHash
    || promptTemplateHash !== contract.constraintSnapshot.promptTemplateHash
    || compiledContextHash !== contract.contextSnapshot.sourceManifestJson.compiledContextHash) {
    throw new AiExecutionError({
      code: 'AI_COMPILATION_INPUT_INVALID',
      message: '编译契约 hash 校验失败。',
      retryable: false,
    });
  }

  return {
    operationId,
    traceId: input.traceId,
    taskType: input.taskType,
    novelId: input.novelId,
    chapterId: input.chapterId,
    draftId: input.draftId,
    scopeType: input.scopeType,
    expectedArtifactType: contract.expectedArtifactType,
    expectedArtifactSchemaVersion: contract.expectedArtifactSchemaVersion,
    targetHintJson: input.targetHintJson,
    inputSnapshot: {
      schemaVersion: 2,
      inputType: contract.inputType,
      payloadJson: contract.inputPayloadJson,
      body: serializedMessages,
    },
    contextSnapshot: {
      schemaVersion: contract.contextSnapshot.schemaVersion,
      sourceManifestJson: contract.contextSnapshot.sourceManifestJson,
      compiledContext: contract.contextSnapshot.compiledContext,
      budgetJson: contract.contextSnapshot.budgetJson,
      compilerVersion: contract.contextSnapshot.compilerVersion,
    },
    constraintSnapshot: {
      schemaVersion: contract.constraintSnapshot.schemaVersion,
      payloadJson: contract.constraintSnapshot.payloadJson,
      promptTemplateId: contract.constraintSnapshot.promptTemplateId,
      promptTemplateVersion: contract.constraintSnapshot.promptTemplateVersion,
      promptTemplateHash,
      promptTemplateBody: contract.constraintSnapshot.promptTemplateBody,
      providerOptionsJson: contract.constraintSnapshot.providerOptionsJson,
    },
  };
}

async function cleanupFailedExecution(
  runtime: RuntimePort,
  task: AiTask | undefined,
  attemptId: string | undefined,
  error: AiExecutionError,
): Promise<void> {
  if (!task) return;
  if (error.code === 'AI_PROVIDER_CANCELLED' || !attemptId) {
    await withCommitReplay(() => runtime.cancel(task.taskId, task.traceId));
    return;
  }
  await withCommitReplay(() => runtime.failAttempt(
    task.taskId,
    attemptId,
    {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      traceId: task.traceId,
      operationId: task.operationId,
    },
    task.traceId,
  ));
}

export async function executeAiTask(
  input: ExecuteAiTaskInput,
  dependencies: AiExecutionDependencies = defaultDependencies,
): Promise<AiExecutionResult> {
  throwIfAiRequestCancelled(input.signal);
  const adapter = dependencies.createAdapter(input.settings);
  const operationId = input.operationId ?? dependencies.createId();
  const traceId = input.traceId ?? operationId;
  let contract: CompiledAiExecutionContractV1;
  try {
    contract = await dependencies.compileContract({
      taskType: input.taskType,
      scope: {
        scopeType: input.scopeType,
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: input.draftId,
      },
      compilation: input.compilation,
      settings: input.settings,
      providerId: adapter.providerId,
      modelId: adapter.modelId,
    });
    if (contract.contractVersion !== 'compiled_ai_execution_v1'
      || contract.taskType !== input.taskType
      || contract.constraintSnapshot.providerOptionsJson.providerId !== adapter.providerId
      || contract.constraintSnapshot.providerOptionsJson.model !== adapter.modelId) {
      throw new AiExecutionError({
        code: 'AI_COMPILATION_INPUT_INVALID',
        message: '编译契约与 Task 或 Provider identity 不一致。',
        retryable: false,
      });
    }
  } catch (error) {
    throw mapProviderError(error, { traceId, operationId });
  }

  if (!dependencies.isTauriRuntime()) {
    try {
      const provider = await adapter.execute(contract.request, { signal: input.signal });
      throwIfAiRequestCancelled(input.signal);
      return {
        persistence: 'ephemeral_browser',
        text: provider.text,
        structuredPayloadJson: safeStructuredPayload(input.parseStructuredPayload, provider.text),
        provider,
      };
    } catch (error) {
      throw mapProviderError(error, { traceId, operationId });
    }
  }

  let task: AiTask | undefined;
  let attemptId: string | undefined;
  let providerCompleted = false;
  try {
    const taskInput = await buildTaskInput({ ...input, traceId }, contract, adapter, operationId);
    task = await withCommitReplay(() => dependencies.runtime.create(taskInput));
    const completedReplay = await replayCompletedTask(dependencies.runtime, task);
    if (completedReplay) return completedReplay;
    const queued = await withCommitReplay(() => dependencies.runtime.queueAttempt(task!.taskId, traceId));
    attemptId = queued.attempt.attemptId;
    const providerRequestId = attemptId;
    await withCommitReplay(() => dependencies.runtime.claimAttempt({
      taskId: task!.taskId,
      attemptId: providerRequestId,
      providerId: adapter.providerId,
      modelId: adapter.modelId,
      providerRequestId,
    }));

    const provider = await adapter.execute(contract.request, {
      signal: input.signal,
      requestId: providerRequestId,
    });
    throwIfAiRequestCancelled(input.signal);
    const responseHash = await requireSha256(provider.text);
    const responseLength = unicodeLength(provider.text);
    const succeeded = await withCommitReplay(() => dependencies.runtime.markProviderSucceeded(
      task!.taskId,
      providerRequestId,
      providerMetadata(provider, responseHash, responseLength, providerRequestId),
      traceId,
    ));
    providerCompleted = true;
    if (succeeded.task.status !== 'validating') {
      throw new AiExecutionError({
        code: 'AI_PROVIDER_CANCELLED',
        message: 'AI 响应到达时任务已经取消。',
        retryable: false,
        traceId,
        operationId,
      });
    }

    const structuredPayloadJson = safeStructuredPayload(
      input.parseStructuredPayload,
      provider.text,
    );
    const artifactInput: CreateResultArtifactInput = {
      taskId: task.taskId,
      attemptId: providerRequestId,
      artifactType: contract.expectedArtifactType,
      schemaVersion: contract.expectedArtifactSchemaVersion,
      rawContent: provider.text,
      structuredPayloadJson,
    };
    const artifactBundle = await withCommitReplay(
      () => dependencies.runtime.createArtifact(artifactInput),
    );
    return {
      persistence: 'sqlite',
      text: provider.text,
      structuredPayloadJson,
      provider,
      taskId: task.taskId,
      attemptId: providerRequestId,
      artifactBundle,
    };
  } catch (error) {
    const mapped = mapProviderError(error, { traceId, operationId });
    if (!providerCompleted) {
      try {
        await cleanupFailedExecution(dependencies.runtime, task, attemptId, mapped);
      } catch (cleanupError) {
        throw toExecutionError(normalizeAppError(
          cleanupError,
          mapped.message,
          { traceId, operationId },
        ));
      }
    }
    throw mapped;
  }
}
