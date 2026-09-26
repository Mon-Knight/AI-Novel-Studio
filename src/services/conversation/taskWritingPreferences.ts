import type { TaskRuntimeInput } from './taskRuntimeAdapter';
import { taskConversationService } from './taskConversationService';
import {
  composeWorkbenchInstruction,
  deriveTaskConstraintBrief,
  summarizeTaskConstraintBrief,
} from './taskConstraintBrief';
import { resolveTaskWordTarget } from './taskWordTarget';

export async function prepareTaskWritingPreferences(input: TaskRuntimeInput) {
  const bundle = await taskConversationService.get(input.conversationId, {
    hydrateArtifacts: false,
  });
  if (!bundle || bundle.conversation.novelId !== input.novelId) {
    throw new Error('写章任务对话不存在或不属于当前作品。');
  }
  const brief = deriveTaskConstraintBrief(bundle.turns, input.turnId);
  return {
    writerInstruction: composeWorkbenchInstruction(input.goal, brief.constraints),
    taskConstraints: brief.entries.length > 0 ? summarizeTaskConstraintBrief(brief) : undefined,
    targetWordCount: resolveTaskWordTarget(input.goal, bundle.turns, input.turnId),
  };
}
