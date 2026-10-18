import type { TaskConversationBundle, TaskModelSnapshot } from '../../types/conversation';
import { decodeWorkbenchTurnContent } from '../../services/conversation/workbenchTurnOrigin';
import { assertRecoverableRun } from '../../services/conversation/workbenchRetryRecovery';
import { resolveRetryRunChapterTarget } from '../../services/conversation/workbenchRetryTarget';
import { restoreDesktopRetry } from '../../services/dsh/taskRetryRecovery';
import type { TaskRuntimeInput } from '../../services/conversation/taskRuntimeAdapter';

/** Resolve durable retry facts before changing selection, preparing assets or calling a model. */
export async function prepareWorkbenchRetry(bundle: TaskConversationBundle, sourceRunId: string) {
  const sourceRun = assertRecoverableRun(bundle, sourceRunId);
  const sourceTurn = bundle.turns.find((turn) => turn.turnId === sourceRun.turnId);
  const decodedSourceTurn = decodeWorkbenchTurnContent(sourceTurn?.content);
  const goal = sourceTurn?.role === 'user' ? decodedSourceTurn.content.trim() : '';
  if (!sourceTurn || !goal) throw new Error('原回合内容缺失，无法安全重试。');
  const target = await resolveRetryRunChapterTarget({ bundle, sourceRun, sourceGoal: goal });
  const restored = await restoreDesktopRetry({
    conversationId: bundle.conversation.conversationId,
    novelId: bundle.conversation.novelId,
    chapterId: target.chapterId,
    turnId: sourceTurn.turnId,
    goal,
    modelSnapshot: sourceRun.modelSnapshot,
    retrySourceRunId: sourceRun.runId,
    explicitChapterRetry: true,
    ...(sourceTurn.revisionSource ? { revisionSource: sourceTurn.revisionSource } : {}),
  });
  if (!restored.modelSnapshot) throw new Error('原运行没有可恢复的冻结模型。');
  return {
    sourceTurn,
    decodedSourceTurn,
    goal,
    retryRequest: restored as TaskRuntimeInput & { modelSnapshot: TaskModelSnapshot },
  };
}
