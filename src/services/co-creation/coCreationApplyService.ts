import type {
  CoCreationApplyPreparationV1,
  PrepareCoCreationApplyInput,
  PrepareCoCreationUndoInput,
} from '../../types/coCreationApply';
import type { ApplyExecutionResult, ApplyPlan } from '../../types/placement';
import { dbCall } from '../database/db';

function desktopOnly(): never {
  throw Object.assign(new Error('正式 Canon 事务采用仅在 Tauri/SQLite 桌面环境中可用'), {
    code: 'DATABASE_TRANSACTION_FAILED',
    retryable: false,
  });
}

function executeInput(plan: ApplyPlan) {
  return { planId: plan.planId, operationId: plan.operationId, requestHash: plan.requestHash };
}

export const coCreationApplyService = {
  async prepare(input: PrepareCoCreationApplyInput): Promise<CoCreationApplyPreparationV1> {
    return dbCall<CoCreationApplyPreparationV1>('prepare_co_creation_apply', {
      input,
    }, desktopOnly);
  },

  async execute(preparation: CoCreationApplyPreparationV1): Promise<ApplyExecutionResult> {
    return dbCall<ApplyExecutionResult>('execute_apply_plan', {
      input: executeInput(preparation.plan),
    }, desktopOnly);
  },

  async prepareUndo(input: PrepareCoCreationUndoInput): Promise<CoCreationApplyPreparationV1> {
    return dbCall<CoCreationApplyPreparationV1>('prepare_co_creation_undo', {
      input,
    }, desktopOnly);
  },
};
