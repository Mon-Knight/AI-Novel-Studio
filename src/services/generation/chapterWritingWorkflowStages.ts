import { canonicalHash } from '../ai/compilation/canonical';
import { ChapterWritingWorkflowError } from './chapterWritingState';
import { workflowFailure } from './chapterWritingWorkflowValidation';
import type {
  ChapterWritingWorkflowSession,
  WritingStageAddress,
} from './chapterWritingWorkflowPorts';
import type { ChapterWritingWorkflowCheckpoint } from '../../types/chapterWritingWorkflow';

/** Persist a logical stage attempt before dispatch. Provider transport budgets remain separately governed. */
export async function executeWorkflowStage<T>(
  session: ChapterWritingWorkflowSession,
  address: WritingStageAddress,
  stageInput: unknown,
  execute: () => Promise<T>,
  accept: (next: ChapterWritingWorkflowCheckpoint, result: T) => void,
  usesModel = true,
): Promise<T> {
  await session.assertActive();
  if (usesModel && session.checkpoint.callsUsed >= session.input.budget.maxCalls) {
    workflowFailure('CHAPTER_WORKFLOW_CALL_BUDGET_EXCEEDED', '本次尝试的逻辑阶段调用预算已耗尽。');
  }
  const stageId = `stage_${await canonicalHash(address)}`;
  if (
    session.checkpoint.stages.some(
      (stage) => stage.stageId === stageId && stage.status === 'succeeded',
    )
  ) {
    workflowFailure(
      'CHAPTER_WORKFLOW_STAGE_ALREADY_SUCCEEDED',
      '已完成阶段只能复验复用，不能再次调用。',
    );
  }
  const attempt = 1 + session.checkpoint.stages.filter((stage) => stage.stageId === stageId).length;
  const inputHash = await canonicalHash(stageInput);
  await session.commit((next) => {
    next.stages.push({ ...address, stageId, inputHash, status: 'running', attempt });
    if (usesModel) next.callsUsed += 1;
  });
  try {
    const result = await execute();
    await session.assertActive();
    const resultHash = await canonicalHash(result);
    await session.commit((next) => {
      const stage = next.stages.find(
        (item) => item.stageId === stageId && item.attempt === attempt,
      );
      if (!stage || stage.status !== 'running') {
        workflowFailure('CHAPTER_WORKFLOW_STAGE_CONFLICT', '阶段状态已变化，拒绝迟到结果。');
      }
      accept(next, result);
      stage.status = 'succeeded';
      stage.resultHash = resultHash;
    });
    return result;
  } catch (error) {
    const status = session.input.signal?.aborted ? 'cancelled' : 'failed';
    const errorCode =
      error instanceof ChapterWritingWorkflowError ? error.code : 'CHAPTER_WORKFLOW_STAGE_FAILED';
    await session.commit((next) => {
      const stage = next.stages.find(
        (item) => item.stageId === stageId && item.attempt === attempt,
      );
      if (stage?.status === 'running') {
        stage.status = status;
        stage.errorCode = errorCode;
      }
    });
    throw error;
  }
}
