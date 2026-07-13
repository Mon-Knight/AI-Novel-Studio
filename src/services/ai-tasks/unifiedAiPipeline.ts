import type { AiClient, AiGenerateRequest, AiGenerateResponse } from '../../types/ai';
import type {
  AiTaskConstraintSnapshotInput,
  AiTaskContextSnapshotInput,
  AiTaskSnapshotInput,
  AiTaskAttemptStart,
  UnifiedAiTask,
} from '../../types/ai-task';
import type { ResultArtifact, ResultArtifactType } from '../../types/result-artifact';
import type { AppError } from '../../types/appError';
import { normalizeAppError } from '../../types/appError';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { dbCall, lsSet, nowISO } from '../database/db';
import { aiTaskStore } from '../../store/aiTaskStore';
import { providerAdapter, normalizeProviderError } from './providerAdapter';

export interface UnifiedAiPipelineInput {
  taskType: string;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType: string;
  targetHintJson?: unknown;
  inputSnapshot: AiTaskSnapshotInput;
  contextSnapshot: AiTaskContextSnapshotInput;
  constraintSnapshot: AiTaskConstraintSnapshotInput;
  artifactType: ResultArtifactType;
  artifactSchemaVersion?: number;
  expectedOk?: boolean;
  providerId?: string;
  timeoutMs: number;
  client: AiClient;
  request: AiGenerateRequest;
  parseStructuredPayload?: (text: string) => unknown;
  onTaskCreated?: (task: UnifiedAiTask) => void;
}

export interface UnifiedAiPipelineResult {
  task: UnifiedAiTask;
  attemptId: string;
  artifact: ResultArtifact;
  response: AiGenerateResponse;
}

const browserTasks = new Map<string, UnifiedAiTask>();
const taskAttempts = new Map<string, string>();
const activeRuns = new Map<string, Promise<UnifiedAiPipelineResult>>();

function createId(): string {
  return crypto.randomUUID();
}

function browserCreate(input: Record<string, any>): UnifiedAiTask {
  const existing = Array.from(browserTasks.values()).find((task) => task.operationId === input.operationId);
  if (existing) return existing;
  const task: UnifiedAiTask = {
    taskId: createId(),
    taskType: input.taskType,
    novelId: input.novelId,
    chapterId: input.chapterId,
    draftId: input.draftId,
    scopeType: input.scopeType,
    status: 'ready',
    inputSnapshotId: createId(),
    contextSnapshotId: createId(),
    constraintSnapshotId: createId(),
    traceId: input.traceId,
    operationId: input.operationId,
    requestHash: input.requestHash || '',
    createdAt: nowISO(),
  };
  browserTasks.set(task.taskId, task);
  return task;
}

function browserStart(taskId: string): AiTaskAttemptStart {
  const task = browserTasks.get(taskId);
  if (!task || (task.status !== 'ready' && task.status !== 'failed')) {
    throw { code: 'AI_TASK_ILLEGAL_TRANSITION', message: 'Task 当前不能创建 Attempt', retryable: false };
  }
  const attemptId = createId();
  const started = { ...task, status: 'running' as const, currentAttemptId: attemptId, startedAt: nowISO() };
  browserTasks.set(taskId, started);
  taskAttempts.set(taskId, attemptId);
  return { task: started, attemptId, attemptNumber: 1 };
}

function browserSetStatus(taskId: string, status: UnifiedAiTask['status'], error?: AppError): UnifiedAiTask {
  const task = browserTasks.get(taskId);
  if (!task) throw { code: 'AI_TASK_NOT_FOUND', message: 'AI Task 不存在', retryable: false };
  const updated = { ...task, status, error, completedAt: status === 'completed' ? nowISO() : task.completedAt };
  browserTasks.set(taskId, updated);
  return updated;
}

function browserCancel(taskId: string): UnifiedAiTask {
  const task = browserTasks.get(taskId);
  if (!task) throw { code: 'AI_TASK_NOT_FOUND', message: 'AI Task 不存在', retryable: false };
  if (task.status === 'cancel_requested') return browserSetStatus(taskId, 'cancelled');
  if (task.status === 'created' || task.status === 'ready' || task.status === 'queued') {
    return browserSetStatus(taskId, 'cancelled');
  }
  if (task.status === 'preparing_context' || task.status === 'running' || task.status === 'validating') {
    return browserSetStatus(taskId, 'cancel_requested');
  }
  throw { code: 'AI_TASK_TERMINAL_STATE', message: 'Task 当前不能取消', retryable: false };
}

async function createTask(input: UnifiedAiPipelineInput, operationId: string, requestHash: string): Promise<UnifiedAiTask> {
  const traceId = createId();
  return dbCall<UnifiedAiTask>('create_ai_task', {
    input: {
      operationId,
      requestHash: undefined,
      traceId,
      taskType: input.taskType,
      novelId: input.novelId,
      chapterId: input.chapterId,
      draftId: input.draftId,
      scopeType: input.scopeType,
      targetHintJson: input.targetHintJson,
      inputSnapshot: input.inputSnapshot,
      contextSnapshot: input.contextSnapshot,
      constraintSnapshot: input.constraintSnapshot,
    },
  }, () => browserCreate({
    operationId, requestHash, traceId,
    taskType: input.taskType, novelId: input.novelId, chapterId: input.chapterId,
    draftId: input.draftId, scopeType: input.scopeType,
  }));
}

async function getTask(taskId: string): Promise<UnifiedAiTask | null> {
  return dbCall<UnifiedAiTask | null>('get_ai_task', { taskId }, () => browserTasks.get(taskId) || null);
}

async function startAttempt(taskId: string, providerId?: string): Promise<AiTaskAttemptStart> {
  return dbCall<AiTaskAttemptStart>('start_ai_task_attempt', {
    input: { taskId, providerId },
  }, () => browserStart(taskId));
}

async function markSucceeded(taskId: string, attemptId: string, metadata: unknown): Promise<UnifiedAiTask> {
  return dbCall<UnifiedAiTask>('mark_ai_task_attempt_succeeded', {
    input: { taskId, attemptId, responseMetadataJson: metadata },
  }, () => browserSetStatus(taskId, 'validating'));
}

async function failAttempt(taskId: string, attemptId: string, error: AppError): Promise<void> {
  await dbCall<UnifiedAiTask>('fail_ai_task_attempt', {
    input: { taskId, attemptId, error },
  }, () => browserSetStatus(taskId, 'failed', error));
}

async function createArtifact(
  input: UnifiedAiPipelineInput,
  taskId: string,
  attemptId: string,
  response: AiGenerateResponse,
  structuredPayloadJson: unknown,
): Promise<ResultArtifact> {
  const rawContent = response.raw === undefined
    ? response.text
    : JSON.stringify(response.raw);
  const browserContentHash = await computeContentSha256(rawContent);
  return dbCall<ResultArtifact>('create_result_artifact', {
    input: {
      taskId,
      attemptId,
      artifactType: input.artifactType,
      schemaVersion: input.artifactSchemaVersion ?? 1,
      rawContent,
      parseContent: response.text,
      displayContent: response.text,
      structuredPayloadJson,
      source: {
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: input.inputSnapshot.sourceDraftId,
        draftVersion: input.inputSnapshot.sourceDraftVersion,
        baseContentHash: input.inputSnapshot.baseContentHash,
      },
      expectedOk: input.expectedOk,
    },
  }, () => {
    const issues: ResultArtifact['issues'] = [];
    const jsonTypes: ResultArtifactType[] = [
      'quality_report', 'generic_json', 'character_candidates', 'event_candidates',
      'setting_candidates', 'style_analysis', 'chapter_summary', 'volume_summary',
    ];
    let browserStructuredPayload = structuredPayloadJson;
    if (!response.text.trim()) {
      issues.push({ severity: 'error', code: 'ARTIFACT_EMPTY', message: 'Provider 返回为空' });
    }
    if (jsonTypes.includes(input.artifactType) && browserStructuredPayload === undefined) {
      try {
        const parsed = JSON.parse(response.text);
        if (parsed === null || typeof parsed !== 'object') throw new Error('not structured');
        browserStructuredPayload = parsed;
      } catch {
        issues.push({ severity: 'error', code: 'ARTIFACT_PARSE_FAILED', message: 'Provider 返回不是预期 JSON' });
      }
    }
    if ((input.artifactType === 'chapter_text' || input.artifactType === 'quality_report')
      && (!input.inputSnapshot.sourceDraftId
        || input.inputSnapshot.sourceDraftVersion === undefined
        || !input.inputSnapshot.baseContentHash)) {
      issues.push({ severity: 'error', code: 'ARTIFACT_SOURCE_INCOMPLETE', message: '正文类 Artifact 缺少来源基线' });
    }
    if (input.expectedOk && response.text.trim() !== 'OK') {
      issues.push({
        severity: 'error', code: 'CONNECTION_TEST_UNEXPECTED_RESPONSE', message: '连接测试未返回预期 OK',
      });
    }
    if (browserStructuredPayload && typeof browserStructuredPayload === 'object' && !Array.isArray(browserStructuredPayload)) {
      const payload = browserStructuredPayload as Record<string, unknown>;
      if ((typeof payload.chapterId === 'string' && payload.chapterId !== input.chapterId)
        || Object.prototype.hasOwnProperty.call(payload, 'targetId')) {
        issues.push({
          severity: 'warning', code: 'ARTIFACT_PROVIDER_TARGET_IGNORED', message: 'Provider 返回的目标身份已忽略',
        });
      }
    }
    const processingStatus: ResultArtifact['processingStatus'] = issues.some((issue) => issue.severity === 'error')
      ? 'invalid'
      : issues.some((issue) => issue.severity === 'warning') ? 'valid_with_warnings' : 'valid';
    const artifact: ResultArtifact = {
      artifactId: createId(),
      taskId,
      attemptId,
      artifactType: input.artifactType,
      schemaVersion: input.artifactSchemaVersion ?? 1,
      rawContentRefId: `browser:${taskId}:raw`,
      contentHash: browserContentHash,
      contentLength: Array.from(rawContent).length,
      processingStatus,
      issues,
      createdAt: nowISO(),
    };
    const task = browserTasks.get(taskId);
    lsSet(`ai_novel_studio_result_artifact_${artifact.artifactId}`, {
      ...artifact,
      rawContent,
      displayContent: response.text,
      structuredPayloadJson: browserStructuredPayload,
      source: {
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: input.inputSnapshot.sourceDraftId,
        draftVersion: input.inputSnapshot.sourceDraftVersion,
        baseContentHash: input.inputSnapshot.baseContentHash,
      },
      taskCreatedAt: task?.createdAt,
      requiresChapterConstraintValidation: input.taskType === 'chapter_generate',
    });
    if (task) browserTasks.set(taskId, {
      ...task,
      status: artifact.processingStatus === 'invalid' ? 'failed' : 'completed',
      resultArtifactId: artifact.artifactId,
      completedAt: artifact.processingStatus === 'invalid' ? undefined : nowISO(),
    });
    return artifact;
  });
}

async function executePipeline(input: UnifiedAiPipelineInput, intentHash: string): Promise<UnifiedAiPipelineResult> {
  const operationId = createId();
  const task = await createTask(input, operationId, intentHash);
  input.onTaskCreated?.(task);
  aiTaskStore.upsert({
    taskId: task.taskId,
    taskType: input.taskType,
    novelId: input.novelId,
    chapterId: input.chapterId,
    status: task.status,
    progress: '准备中',
    createdAt: task.createdAt,
  });
  const attempt = await startAttempt(task.taskId, input.providerId);
  taskAttempts.set(task.taskId, attempt.attemptId);
  aiTaskStore.upsert({ taskId: task.taskId, taskType: input.taskType, status: 'running', progress: 'AI 正在处理' });
  try {
    const providerResult = await providerAdapter.execute(
      attempt.attemptId,
      input.client,
      input.request,
      input.timeoutMs,
    );
    const current = await getTask(task.taskId);
    if (current?.status === 'cancel_requested' || current?.status === 'cancelled') {
      await dbCall<UnifiedAiTask>('record_ai_task_late_response', {
        input: {
          taskId: task.taskId,
          attemptId: attempt.attemptId,
          responseMetadataJson: providerResult.metadata,
        },
      }, () => browserSetStatus(task.taskId, 'cancelled'));
      throw { code: 'AI_PROVIDER_CANCELLED', message: '取消后的迟到响应已忽略', retryable: false };
    }
    const marked = await markSucceeded(task.taskId, attempt.attemptId, providerResult.metadata);
    if (marked.status === 'cancel_requested' || marked.status === 'cancelled') {
      throw { code: 'AI_PROVIDER_CANCELLED', message: '取消后的迟到响应已忽略', retryable: false };
    }
    aiTaskStore.upsert({ taskId: task.taskId, taskType: input.taskType, status: 'validating', progress: '正在检查结果' });
    let structuredPayload: unknown;
    try {
      structuredPayload = input.parseStructuredPayload?.(providerResult.response.text);
    } catch {
      structuredPayload = undefined;
    }
    const artifact = await createArtifact(
      input,
      task.taskId,
      attempt.attemptId,
      providerResult.response,
      structuredPayload,
    );
    const completed = await getTask(task.taskId) || { ...task, status: 'completed' as const };
    aiTaskStore.upsert({
      taskId: task.taskId,
      taskType: input.taskType,
      status: completed.status,
      artifactId: artifact.artifactId,
      errorSummary: artifact.processingStatus === 'invalid' ? 'Artifact 校验失败' : undefined,
    });
    if (artifact.processingStatus === 'invalid') {
      throw { code: 'ARTIFACT_VALIDATION_FAILED', message: 'AI 返回结果未通过校验', retryable: false };
    }
    return { task: completed, attemptId: attempt.attemptId, artifact, response: providerResult.response };
  } catch (value) {
    const error = normalizeAppError(value, 'AI 任务执行失败');
    const current = await getTask(task.taskId).catch(() => null);
    if (error.code === 'AI_PROVIDER_CANCELLED' && current?.status === 'cancel_requested') {
      const cancelled = await dbCall<UnifiedAiTask>(
        'cancel_ai_task',
        { taskId: task.taskId },
        () => browserCancel(task.taskId),
      ).catch(() => current);
      aiTaskStore.upsert({
        taskId: task.taskId,
        status: cancelled.status,
        progress: cancelled.status === 'cancelled' ? 'cancelled' : 'cancelling',
      });
      throw error;
    }
    if (current?.status === 'running') {
      await failAttempt(task.taskId, attempt.attemptId, error).catch(() => undefined);
    }
    aiTaskStore.upsert({ taskId: task.taskId, status: 'failed', errorSummary: error.message });
    throw error;
  }
}

export const unifiedAiPipeline = {
  async run(input: UnifiedAiPipelineInput): Promise<UnifiedAiPipelineResult> {
    const intentHash = await computeContentSha256(JSON.stringify({
      taskType: input.taskType,
      novelId: input.novelId,
      chapterId: input.chapterId,
      draftId: input.draftId,
      input: input.inputSnapshot,
      context: input.contextSnapshot,
      constraint: input.constraintSnapshot,
      artifactType: input.artifactType,
    }));
    const existing = activeRuns.get(intentHash);
    if (existing) return existing;
    const run = executePipeline(input, intentHash);
    activeRuns.set(intentHash, run);
    try {
      return await run;
    } finally {
      activeRuns.delete(intentHash);
    }
  },

  async cancel(taskId: string): Promise<void> {
    const attemptId = taskAttempts.get(taskId);
    const task = await dbCall<UnifiedAiTask>('cancel_ai_task', { taskId }, () => browserCancel(taskId));
    if (attemptId) providerAdapter.cancel(attemptId);
    aiTaskStore.upsert({
      taskId,
      status: task.status,
      progress: task.status === 'cancelled' ? 'cancelled' : 'cancelling',
    });
  },
};

export { normalizeProviderError };
