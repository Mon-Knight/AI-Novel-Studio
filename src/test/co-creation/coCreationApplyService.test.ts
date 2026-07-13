import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoCreationApplyPreparationV1 } from '../../types/coCreationApply';

const mocks = vi.hoisted(() => ({ dbCall: vi.fn() }));

vi.mock('../../services/database/db', () => ({ dbCall: mocks.dbCall }));

import { coCreationApplyService } from '../../services/co-creation/coCreationApplyService';

function preparation(): CoCreationApplyPreparationV1 {
  return {
    proposal: {
      proposalId: 'proposal-a', artifactId: 'artifact-a', schemaVersion: 1,
      targets: [], confidence: 1, reasons: [], warnings: [], unresolvedItems: [],
      projectRevisionHash: 'revision-hash', createdAt: 'now',
    },
    plan: {
      planId: 'plan-a', proposalId: 'proposal-a', artifactId: 'artifact-a', schemaVersion: 1,
      operations: [], dependencies: [], expectedVersions: {}, expectedHashes: {}, conflicts: [],
      operationId: 'execute-a', requestHash: 'request-hash', status: 'ready', createdAt: 'now',
    },
    affectedTargets: [],
    impactWarnings: [],
  };
}

describe('co-creation formal apply service', () => {
  beforeEach(() => mocks.dbCall.mockReset());

  it('passes the immutable draft identity into formal proposal preparation', async () => {
    const prepared = preparation();
    mocks.dbCall.mockResolvedValue(prepared);
    const input = {
      operationId: 'prepare-a', novelId: 'novel-a', sessionId: 'session-a',
      draftRevisionId: 'draft-a', expectedDraftContentHash: 'draft-hash',
      suggestionIds: ['suggestion-a'],
    };
    await expect(coCreationApplyService.prepare(input)).resolves.toBe(prepared);
    expect(mocks.dbCall).toHaveBeenCalledWith(
      'prepare_co_creation_apply', { input }, expect.any(Function),
    );
  });

  it('executes and undoes through the existing ApplyPlan command contract', async () => {
    const prepared = preparation();
    mocks.dbCall.mockResolvedValueOnce({ planId: 'plan-a', status: 'completed', targetLinks: [] });
    await coCreationApplyService.execute(prepared);
    expect(mocks.dbCall).toHaveBeenLastCalledWith('execute_apply_plan', {
      input: { planId: 'plan-a', operationId: 'execute-a', requestHash: 'request-hash' },
    }, expect.any(Function));

    mocks.dbCall.mockResolvedValueOnce(prepared);
    const undo = { operationId: 'undo-a', novelId: 'novel-a', completedPlanId: 'plan-a' };
    await coCreationApplyService.prepareUndo(undo);
    expect(mocks.dbCall).toHaveBeenLastCalledWith(
      'prepare_co_creation_undo', { input: undo }, expect.any(Function),
    );
  });
});
