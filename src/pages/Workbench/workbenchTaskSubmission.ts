import type { MutableRefObject } from 'react';
import { isConversationalGoal } from '../../services/conversation/taskGoalRouting';
import { isModelLedCreativeTurn } from '../../services/dsh/taskSessionAdapter';
import { WorkbenchModelUnavailableError } from '../../services/conversation/workbenchModelAvailability';
import type { Chapter } from '../../types/chapter';
import type { TaskModelSnapshot } from '../../types/conversation';

export interface WorkbenchTaskSubmissionInput {
  goal: string;
  requestedChapterId: string;
  taskModel: TaskModelSnapshot;
  selectedNovelId: string;
  chapters: Chapter[];
  creatingTask: boolean;
  contextPending: boolean;
  contextFailed: boolean;
  submissionRef: MutableRefObject<boolean>;
  validateModelForSend: (
    model: TaskModelSnapshot,
    options: { allowLocalFallback: boolean },
  ) => Promise<TaskModelSnapshot>;
  selectChapter: (chapterId: string) => Promise<void>;
  createTask: (
    goal: string,
    model: TaskModelSnapshot,
  ) => Promise<{
    conversation: { conversationId: string; novelId: string };
    turn: { turnId: string };
  } | null>;
  startInitializedTask: (input: {
    conversationId: string;
    novelId: string;
    chapterId?: string;
    turnId: string;
    goal: string;
    modelSnapshot: TaskModelSnapshot;
  }) => Promise<void>;
  onError: (message: string) => void;
  onCreated: () => void;
}

/**
 * Creates the conversation and its first turn atomically. Context migration and chapter
 * ownership remain gates; real API model failures belong to the actual conversation run.
 */
export async function submitWorkbenchTask(input: WorkbenchTaskSubmissionInput): Promise<void> {
  const goal = input.goal.trim();
  if (!goal || input.creatingTask || !input.selectedNovelId || input.submissionRef.current) return;
  const conversationalGoal = isConversationalGoal(goal);
  const modelLed = isModelLedCreativeTurn({ goal, modelSnapshot: input.taskModel });
  if (input.contextPending && (modelLed || !conversationalGoal)) {
    input.onError('正在整理已有章节上下文；创作目标已保留，完成后即可创建任务。');
    return;
  }
  if (input.contextFailed && (modelLed || !conversationalGoal)) {
    input.onError('旧版上下文未能安全整理；创作目标已保留，请重新启动应用后重试。');
    return;
  }
  const requestedChapterId = input.requestedChapterId.trim();
  const scopedChapter = requestedChapterId
    ? input.chapters.find(
        (chapter) => chapter.id === requestedChapterId && chapter.novelId === input.selectedNovelId,
      )
    : undefined;
  if (requestedChapterId && !scopedChapter) {
    input.onError('所选章节不属于当前小说项目，请重新选择。');
    return;
  }
  const scopedChapterId = scopedChapter?.id;
  input.submissionRef.current = true;
  input.onError('');
  let taskModel = input.taskModel;
  try {
    if (!conversationalGoal && !modelLed) {
      try {
        taskModel = await input.validateModelForSend(taskModel, { allowLocalFallback: true });
      } catch (error) {
        input.onError(
          error instanceof WorkbenchModelUnavailableError
            ? error.message
            : 'Runtime 模型目录刷新失败，创作目标已保留，请稍后重试。',
        );
        return;
      }
    }
    await input.selectChapter(scopedChapterId ?? '');
    const initialized = await input.createTask(goal, taskModel);
    if (!initialized) return;
    input.onCreated();
    await input.startInitializedTask({
      conversationId: initialized.conversation.conversationId,
      novelId: initialized.conversation.novelId,
      chapterId: scopedChapterId,
      turnId: initialized.turn.turnId,
      goal,
      modelSnapshot: taskModel,
    });
  } catch (error) {
    input.onError(error instanceof Error ? error.message : '新建创作任务失败，请重试。');
  } finally {
    input.submissionRef.current = false;
  }
}
