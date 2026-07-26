import type { ApplyPlacementResult, PlacementBundle } from '../../types/placement';
import { normalizeAppError } from '../../types/appError';
import { tauriInvoke } from '../tauri/runtime';

async function withCommitReplay<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (normalizeAppError(error).code !== 'DATABASE_COMMIT_UNKNOWN') throw error;
    return operation();
  }
}

export const placementRuntimeService = {
  prepare(input: {
    artifactId: string;
    candidateIndex: number;
    expectedArtifactHash: string;
  }): Promise<PlacementBundle> {
    return withCommitReplay(() => tauriInvoke<PlacementBundle>(
      'prepare_placement_proposal',
      { input },
    ));
  },

  get(proposalId: string): Promise<PlacementBundle> {
    return tauriInvoke<PlacementBundle>('get_placement_proposal', {
      input: { proposalId },
    });
  },

  apply(input: {
    planId: string;
    operationId: string;
    expectedPlanHash: string;
  }): Promise<ApplyPlacementResult> {
    return withCommitReplay(() => tauriInvoke<ApplyPlacementResult>(
      'apply_placement_plan',
      { input },
    ));
  },
};

export const placementRuntimeServicePrivate = { withCommitReplay };
