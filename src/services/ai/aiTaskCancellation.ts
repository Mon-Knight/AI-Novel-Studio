import { isAiRequestCancelled } from './aiCancellation';
import { aiTaskService } from './aiTaskService';
import type { AiGenerateOptions } from '../../types/ai';

export function bindAiTaskCancellation(
  taskId: string | undefined,
  options: AiGenerateOptions,
): () => void {
  if (!taskId || !options.cancel) return () => {};
  return aiTaskService.registerActiveExecution(taskId, options.cancel);
}

export async function settleAiTaskError(input: {
  taskId?: string;
  error: unknown;
  signal?: AbortSignal;
  fallbackMessage: string;
}): Promise<void> {
  if (!input.taskId) return;
  if (input.signal?.aborted || isAiRequestCancelled(input.error)) {
    await aiTaskService.markCancelled(input.taskId);
    return;
  }
  const message = input.error instanceof Error ? input.error.message : input.fallbackMessage;
  await aiTaskService.markFailed(input.taskId, message);
}
