import type { AppError } from '../../types/appError';
import type {
  AiTask,
  AiTaskAttemptResult,
  AiTaskDetail,
  ClaimAiTaskAttemptInput,
  CreateAiTaskInput,
} from '../../types/ai-task';
import type { CreateResultArtifactInput, ResultArtifactBundle } from '../../types/result-artifact';
import { tauriInvoke } from '../tauri/runtime';

export const aiTaskRuntimeService = {
  create(input: CreateAiTaskInput): Promise<AiTask> {
    return tauriInvoke<AiTask>('create_ai_task', { input });
  },

  get(taskId: string, traceId?: string): Promise<AiTaskDetail> {
    return tauriInvoke<AiTaskDetail>('get_ai_task', { input: { taskId, traceId } });
  },

  list(novelId?: string, limit = 100): Promise<AiTask[]> {
    return tauriInvoke<AiTask[]>('list_ai_tasks', { input: { novelId, limit } });
  },

  queueAttempt(taskId: string, traceId?: string): Promise<AiTaskAttemptResult> {
    return tauriInvoke<AiTaskAttemptResult>('queue_ai_task_attempt', {
      input: { taskId, traceId },
    });
  },

  claimAttempt(input: ClaimAiTaskAttemptInput): Promise<AiTaskAttemptResult> {
    return tauriInvoke<AiTaskAttemptResult>('claim_ai_task_attempt', { input });
  },

  markProviderSucceeded(
    taskId: string,
    attemptId: string,
    responseMetadataJson: Record<string, unknown>,
    traceId?: string,
  ): Promise<AiTaskAttemptResult> {
    return tauriInvoke<AiTaskAttemptResult>('mark_ai_task_provider_succeeded', {
      input: { taskId, attemptId, responseMetadataJson, traceId },
    });
  },

  failAttempt(
    taskId: string,
    attemptId: string,
    error: AppError,
    traceId?: string,
  ): Promise<AiTaskAttemptResult> {
    return tauriInvoke<AiTaskAttemptResult>('fail_ai_task_attempt', {
      input: { taskId, attemptId, error, traceId },
    });
  },

  cancel(taskId: string, traceId?: string): Promise<AiTask> {
    return tauriInvoke<AiTask>('cancel_ai_task', { input: { taskId, traceId } });
  },

  createArtifact(input: CreateResultArtifactInput): Promise<ResultArtifactBundle> {
    return tauriInvoke<ResultArtifactBundle>('create_result_artifact', { input });
  },

  getArtifact(artifactId: string): Promise<ResultArtifactBundle> {
    return tauriInvoke<ResultArtifactBundle>('get_result_artifact', {
      input: { artifactId },
    });
  },

  listArtifacts(taskId: string): Promise<ResultArtifactBundle[]> {
    return tauriInvoke<ResultArtifactBundle[]>('list_result_artifacts_for_task', {
      input: { taskId },
    });
  },
};
