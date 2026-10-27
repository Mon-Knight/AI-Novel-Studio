import type { TaskModelSnapshot } from '../../types/conversation';
import type { TaskRuntimeInput } from '../conversation/taskRuntimeAdapter';
import type { DshTurnContract, CreativeWorkflowAction } from '../conversation/taskGoalRouting';
import { tauriInvoke } from '../tauri/runtime';
import { isTauri } from '../database/db';

export interface RetryExecutionContract extends DshTurnContract {
  goal: string;
  chapterWordRange?: { minimum: number; target: number; maximum: number };
}

export interface DshRetryResolution {
  sourceRunId: string;
  turnId: string;
  chapterId?: string;
  modelSnapshot: TaskModelSnapshot;
  execution?: RetryExecutionContract;
}

const WORKFLOW: Partial<Record<DshTurnContract['taskKind'], CreativeWorkflowAction>> = {
  chapter_write: 'generate_chapter',
  chapter_polish: 'polish_chapter',
  story_plan_generate: 'generate_outline',
  outline_generate: 'generate_outline',
  setting_expand: 'prepare_settings',
  character_generate: 'prepare_characters',
  chapter_summary: 'summarize_chapter',
  quality_check: 'check_quality',
  event_suggest: 'suggest_events',
};

export const taskRetryRecovery = {
  resolve(
    conversationId: string,
    novelId: string,
    sourceRunId: string,
  ): Promise<DshRetryResolution> {
    return tauriInvoke('dsh_resolve_task_retry', { conversationId, novelId, sourceRunId });
  },
};

export function restoreDesktopRetry(input: TaskRuntimeInput): Promise<TaskRuntimeInput> {
  return isTauri() ? restoreDshRetry(input) : Promise.resolve(input);
}

/** Reads the original host contract; current input/model selectors cannot change the retry. */
export async function restoreDshRetry(input: TaskRuntimeInput): Promise<TaskRuntimeInput> {
  if (!input.retrySourceRunId) return input;
  const resolved = await taskRetryRecovery.resolve(
    input.conversationId,
    input.novelId,
    input.retrySourceRunId,
  );
  if (
    resolved.sourceRunId !== input.retrySourceRunId ||
    resolved.turnId !== input.turnId ||
    (resolved.chapterId ?? undefined) !== (input.chapterId ?? undefined)
  ) {
    throw new Error('原运行目标已变化，无法恢复失败阶段。');
  }
  const execution = resolved.execution;
  if (!execution) {
    throw new Error(
      'DSH_RETRY_SOURCE_INVALID: 原失败阶段缺少可恢复的执行契约，请明确目标后发送新任务。',
    );
  }
  return {
    ...input,
    modelSnapshot: resolved.modelSnapshot,
    goal: execution.goal,
    retryExecution: execution,
    workflowAction: WORKFLOW[execution.taskKind],
  };
}
