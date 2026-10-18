import type { TaskConversation, TaskModelSnapshot, TaskRun } from '../../types/conversation';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import type { TaskRuntimeInput } from '../../services/conversation/taskRuntimeAdapter';
import { resolveWorkbenchChapterTarget } from '../../services/conversation/workbenchChapterTarget';
import { creativeWorkflowGoal } from '../../services/dsh/taskSessionAdapter';

type CreativeTurnRequest = TaskRuntimeInput & { modelSnapshot: TaskModelSnapshot };

export interface CreativeDialogueDependencies {
  clearSubmittedDraft: () => void;
  execute: (request: CreativeTurnRequest) => Promise<unknown>;
  isSelected: () => boolean;
  selectChapter: (chapterId: string) => Promise<void>;
  completeMessage: string;
  ensureAssetReadiness: (request: {
    conversationId: string;
    novelId: string;
    chapterId?: string;
    goal: string;
    sourceTurnId?: string;
    modelSnapshot: TaskModelSnapshot;
  }) => Promise<boolean>;
}

/** Persist the dialogue first; target and asset gates run only for a model tool request. */
export async function sendCreativeDialogueTurn(
  request: Omit<CreativeTurnRequest, 'turnId'>,
  dependencies: CreativeDialogueDependencies,
): Promise<void> {
  const { conversationId, goal } = request;
  const turn = await taskConversationService.appendTurn(conversationId, 'user', goal);
  dependencies.clearSubmittedDraft();
  await executeCreativeDialogueTurn({ ...request, turnId: turn.turnId }, dependencies);
}

/** First messages already have an atomically persisted turn; do not append a duplicate. */
export async function executeCreativeDialogueTurn(
  request: CreativeTurnRequest,
  dependencies: Omit<CreativeDialogueDependencies, 'clearSubmittedDraft'>,
): Promise<void> {
  const { conversationId, novelId, chapterId, goal, modelSnapshot, turnId } = request;
  await dependencies.execute({
    ...request,
    conversationId,
    novelId,
    chapterId,
    goal,
    modelSnapshot,
    turnId,
    preparePlannedAction: async (action) => {
      const workflowGoal = creativeWorkflowGoal(action);
      const chapterAction = [
        'generate_chapter',
        'polish_chapter',
        'summarize_chapter',
        'check_quality',
        'suggest_events',
      ].includes(action.action);
      let targetChapterId = action.chapterId;
      if (chapterAction && !targetChapterId) {
        const target = await resolveWorkbenchChapterTarget({
          novelId,
          currentChapterId: chapterId,
          goal: workflowGoal,
        });
        if (target.status === 'complete') throw new Error(dependencies.completeMessage);
        targetChapterId = target.chapterId;
      }
      if (targetChapterId && targetChapterId !== chapterId && dependencies.isSelected()) {
        await dependencies.selectChapter(targetChapterId);
      }
      if (['generate_chapter', 'polish_chapter'].includes(action.action)) {
        const ready = await dependencies.ensureAssetReadiness({
          conversationId,
          novelId,
          chapterId: targetChapterId,
          goal: workflowGoal,
          sourceTurnId: turnId,
          modelSnapshot,
        });
        if (!ready) return null;
      }
      return { chapterId: targetChapterId };
    },
  });
}

export function projectCreativeRuntimeRun(
  conversations: TaskConversation[],
  conversationId: string,
  run: TaskRun,
): TaskConversation[] {
  return conversations.map((conversation) =>
    conversation.conversationId === conversationId
      ? {
          ...conversation,
          status: ['queued', 'running', 'cancel_requested'].includes(run.status)
            ? 'running'
            : conversation.status,
          updatedAt: run.updatedAt,
        }
      : conversation,
  );
}
