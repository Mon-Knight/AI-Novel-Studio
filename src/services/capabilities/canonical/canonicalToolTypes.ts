import type {
  CapabilityConfirmation,
  CapabilityExposure,
  CapabilityHealth,
  CapabilityScope,
  CapabilitySideEffect,
} from '../capabilityCatalog';
import type { DomainResult } from '../domain/domainTypes';
import type { ToolJsonSchema } from '../../../types/toolRegistry';

/**
 * Canonical names are deliberately narrower than the legacy production
 * registry names.  Keep this union explicit: adding a name requires an
 * adapter, a catalog entry and a contract test.
 */
export const CANONICAL_TOOL_IDS = [
  'novel.read',
  'structure.read',
  'context.read',
  'memory.search',
] as const;

export type CanonicalToolId = (typeof CANONICAL_TOOL_IDS)[number];

export type CanonicalProjectionState = 'catalog_only' | 'candidate' | 'stable' | 'blocked';

export interface CanonicalToolEvidence {
  capabilityId: CanonicalToolId;
  health: CapabilityHealth;
  dynamicTests: readonly string[];
  references: readonly string[];
  blockers: readonly string[];
}

/**
 * Internal projection descriptor.  It is intentionally richer than a model
 * tool schema so build and audit code can explain why an action is (or is not)
 * eligible.  `evidence` and `projectionState` must be stripped before a
 * future model-facing projection is introduced.
 */
export interface CanonicalToolDescriptor {
  id: CanonicalToolId;
  version: '1';
  name: CanonicalToolId;
  description: string;
  inputSchema: ToolJsonSchema;
  outputSchema: ToolJsonSchema;
  scope: CapabilityScope;
  permissions: readonly string[];
  sideEffect: CapabilitySideEffect;
  confirmationPolicy: CapabilityConfirmation;
  timeoutMs: number;
  executor: 'domain_facade';
  facade: string;
  exposure: CapabilityExposure;
  projectionState: CanonicalProjectionState;
  evidence: CanonicalToolEvidence;
}

/** Public shape reserved for a future model-facing manifest. */
export type CanonicalModelToolDescriptor = Omit<
  CanonicalToolDescriptor,
  'projectionState' | 'evidence' | 'exposure' | 'executor' | 'facade'
>;

/**
 * Scope supplied by the host.  Tool arguments still carry the same IDs so the
 * adapter can compare them and fail closed on cross-project calls.
 */
export interface CanonicalToolInvocationContext {
  novelId?: string;
  chapterId?: string;
  grantedPermissions?: readonly string[];
  signal?: AbortSignal;
}

export interface CanonicalToolBinding {
  readonly id: CanonicalToolId;
  readonly expectedFacade: string;
  readonly requiredPermissions: readonly string[];
  readonly timeoutMs: number;
  readonly execute: (
    argumentsJson: unknown,
    context: CanonicalToolInvocationContext,
  ) => Promise<DomainResult<unknown>>;
}

export interface CanonicalToolManifest {
  contractVersion: 'canonical_tool_manifest_v1';
  projectionVersion: '1';
  projectionHash: string;
  tools: readonly CanonicalToolDescriptor[];
}

export interface CanonicalModelToolManifest {
  contractVersion: 'canonical_tool_manifest_v1';
  projectionVersion: '1';
  projectionHash: string;
  tools: readonly CanonicalModelToolDescriptor[];
}

export interface CanonicalProjectionDiagnostic {
  id: CanonicalToolId;
  included: boolean;
  reasons: readonly string[];
}
