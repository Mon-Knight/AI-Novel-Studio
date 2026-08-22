import type { ModelHealth, ModelLifecycle } from '../../../types/modelRuntime';

const declared = new Map<string, ModelLifecycle>();
const lifecycleEvidence = new Map<string, string>();
const health = new Map<string, Exclude<ModelHealth, 'unknown'>>();

export const modelLifecycleManager = {
  reset(): void {
    declared.clear();
    lifecycleEvidence.clear();
    health.clear();
  },

  markLifecycle(endpointId: string, lifecycle: ModelLifecycle, evidence?: string): boolean {
    const changed =
      declared.get(endpointId) !== lifecycle ||
      (evidence !== undefined && lifecycleEvidence.get(endpointId) !== evidence);
    declared.set(endpointId, lifecycle);
    if (evidence !== undefined) lifecycleEvidence.set(endpointId, evidence);
    else lifecycleEvidence.delete(endpointId);
    return changed;
  },

  observeHealth(endpointId: string, status: Exclude<ModelHealth, 'unknown'>): void {
    health.set(endpointId, status);
  },

  getLifecycle(endpointId: string, enabled: boolean): ModelLifecycle {
    if (!enabled) return 'DISABLED';
    // A dedicated local writer receives production traffic only after the
    // benchmark sidecar explicitly authorizes AVAILABLE. Missing state is not
    // proof that an untrained model is ready.
    return declared.get(endpointId) ?? 'TESTING';
  },

  getHealth(endpointId: string): ModelHealth {
    return health.get(endpointId) ?? 'unknown';
  },
};
