import { canonicalHash, compareCanonicalText } from '../../ai/compilation/canonical';
import { getCapability, type CapabilityDefinition } from '../capabilityCatalog';
import { failure } from '../domain/domainResult';
import type { DomainResult } from '../domain/domainTypes';
import { CANONICAL_TOOL_BINDINGS, getCanonicalToolBinding } from './canonicalToolAdapters';
import type {
  CanonicalModelToolDescriptor,
  CanonicalModelToolManifest,
  CanonicalProjectionDiagnostic,
  CanonicalToolDescriptor,
  CanonicalToolId,
  CanonicalToolInvocationContext,
  CanonicalToolManifest,
} from './canonicalToolTypes';

export const CANONICAL_TOOL_PROJECTION_VERSION = 'canonical_tool_projection_v1';

const domainErrorSchema = {
  type: 'object' as const,
  required: ['code', 'message', 'retryable'],
  additionalProperties: false,
  properties: {
    code: {
      type: 'string' as const,
      enum: [
        'INVALID_SCOPE',
        'INVALID_ARGUMENT',
        'PERMISSION_DENIED',
        'SCOPE_MISMATCH',
        'NOT_FOUND',
        'INTEGRITY_ERROR',
        'CONFIRMATION_REQUIRED',
        'MODEL_SNAPSHOT_REQUIRED',
        'CANDIDATE_ONLY',
        'UPSTREAM_FAILURE',
        'CONFLICT',
      ],
    },
    message: { type: 'string' as const, minLength: 1, maxLength: 2000 },
    retryable: { type: 'boolean' as const },
  },
};

const domainResultSchema = {
  type: 'object' as const,
  required: ['ok', 'source', 'storageMode', 'warnings'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' as const },
    data: { type: 'object' as const, additionalProperties: true },
    error: domainErrorSchema,
    source: {
      type: 'string' as const,
      enum: ['sqlite', 'localstorage', 'runtime', 'artifact'],
    },
    storageMode: {
      type: 'string' as const,
      enum: ['sqlite', 'browser_fallback', 'runtime', 'artifact'],
    },
    warnings: {
      type: 'array' as const,
      maxItems: 100,
      items: { type: 'string' as const, maxLength: 1000 },
    },
    revision: {},
    contentHash: { type: 'string' as const, minLength: 64, maxLength: 64 },
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projectionState(capability: CapabilityDefinition) {
  if (capability.exposure === 'stable' && capability.evidence.health === 'working') {
    return 'stable' as const;
  }
  if (capability.exposure === 'candidate') return 'candidate' as const;
  if (['broken', 'legacy', 'unknown'].includes(capability.evidence.health)) {
    return 'blocked' as const;
  }
  return 'catalog_only' as const;
}

function descriptorFor(id: CanonicalToolId): {
  descriptor?: CanonicalToolDescriptor;
  reasons: string[];
} {
  const binding = getCanonicalToolBinding(id);
  const capability = getCapability(id);
  const reasons: string[] = [];
  if (!binding) reasons.push('没有固定 Domain Facade adapter。');
  if (!capability) reasons.push('Capability Catalog 中不存在该 canonical id。');
  if (!binding || !capability) return { reasons };
  if (capability.kind !== 'tool') reasons.push('只有确定性 tool 能进入本轮 projection。');
  if (capability.facade !== binding.expectedFacade) {
    reasons.push('Catalog facade 与固定 adapter 不一致。');
  }
  if (
    capability.permissions.length !== binding.requiredPermissions.length ||
    capability.permissions.some((permission) => !binding.requiredPermissions.includes(permission))
  ) {
    reasons.push('Catalog permissions 与固定 adapter 不一致。');
  }
  if (['broken', 'legacy', 'unknown'].includes(capability.evidence.health)) {
    reasons.push(`能力健康状态 ${capability.evidence.health} 未通过 projection gate。`);
  }
  if (reasons.length > 0) return { reasons };

  return {
    reasons,
    descriptor: {
      id,
      version: '1',
      name: id,
      description: capability.description,
      inputSchema: clone(capability.inputSchema),
      outputSchema: clone(domainResultSchema),
      scope: capability.scope,
      permissions: [...capability.permissions],
      sideEffect: capability.sideEffect,
      confirmationPolicy: capability.confirmationPolicy,
      timeoutMs: binding.timeoutMs,
      executor: 'domain_facade',
      facade: binding.expectedFacade,
      exposure: capability.exposure,
      projectionState: projectionState(capability),
      evidence: {
        capabilityId: id,
        health: capability.evidence.health,
        dynamicTests: [...capability.evidence.dynamicTests],
        references: [...capability.evidence.references],
        blockers: [...capability.evidence.blockers],
      },
    },
  };
}

export function listCanonicalToolDescriptors(): CanonicalToolDescriptor[] {
  return CANONICAL_TOOL_BINDINGS.flatMap((binding) => {
    const result = descriptorFor(binding.id);
    return result.descriptor ? [result.descriptor] : [];
  });
}

export function getCanonicalToolDescriptor(id: string): CanonicalToolDescriptor | undefined {
  if (!getCanonicalToolBinding(id)) return undefined;
  return descriptorFor(id as CanonicalToolId).descriptor;
}

export function getCanonicalProjectionDiagnostics(): CanonicalProjectionDiagnostic[] {
  return CANONICAL_TOOL_BINDINGS.map((binding) => {
    const result = descriptorFor(binding.id);
    return {
      id: binding.id,
      included: Boolean(result.descriptor),
      reasons: result.reasons,
    };
  });
}

/**
 * Internal manifest used for review and drift checks.  It is not the model
 * manifest: all current entries remain catalog-only because their evidence is
 * still partial and the catalog has not granted an exposure gate.
 */
export async function getCanonicalToolManifest(): Promise<CanonicalToolManifest> {
  const tools = listCanonicalToolDescriptors().sort((left, right) =>
    compareCanonicalText(left.id, right.id),
  );
  const manifestWithoutHash = {
    contractVersion: 'canonical_tool_manifest_v1' as const,
    projectionVersion: '1' as const,
    tools,
  };
  return {
    ...manifestWithoutHash,
    projectionHash: await canonicalHash(manifestWithoutHash),
  };
}

/**
 * The model-facing gate is intentionally empty in Phase 1A-C.  A later phase
 * may opt in only descriptors that are both `stable` and backed by working
 * evidence; candidates and catalog-only entries never leak into prompts.
 */
export function listCanonicalToolsForAgent(): CanonicalModelToolDescriptor[] {
  return listCanonicalToolDescriptors()
    .filter(
      (descriptor) =>
        descriptor.projectionState === 'stable' &&
        descriptor.exposure === 'stable' &&
        descriptor.evidence.health === 'working',
    )
    .map(toModelDescriptor);
}

function toModelDescriptor(descriptor: CanonicalToolDescriptor): CanonicalModelToolDescriptor {
  const {
    projectionState: _projectionState,
    evidence: _evidence,
    exposure: _exposure,
    executor: _executor,
    facade: _facade,
    ...publicDescriptor
  } = descriptor;
  return clone(publicDescriptor);
}

export async function getCanonicalAgentManifest(): Promise<CanonicalModelToolManifest> {
  const tools = listCanonicalToolsForAgent();
  const manifestWithoutHash = {
    contractVersion: 'canonical_tool_manifest_v1' as const,
    projectionVersion: '1' as const,
    tools,
  };
  return {
    ...manifestWithoutHash,
    projectionHash: await canonicalHash(manifestWithoutHash),
  };
}

/**
 * Resolve and execute only a projected canonical action.  The fixed binding
 * lookup and the catalog gate together prevent legacy or technical handler
 * names from becoming an implicit execution path.
 */
export async function invokeCanonicalTool(
  id: string,
  argumentsJson: unknown,
  context: CanonicalToolInvocationContext,
): Promise<DomainResult<unknown>> {
  const descriptor = getCanonicalToolDescriptor(id);
  const binding = getCanonicalToolBinding(id);
  if (!descriptor || !binding) {
    return failure('NOT_FOUND', `Canonical Tool ${id} 未通过 projection gate。`);
  }
  return binding.execute(argumentsJson, context);
}

export const canonicalToolProjection = {
  list: listCanonicalToolDescriptors,
  get: getCanonicalToolDescriptor,
  diagnostics: getCanonicalProjectionDiagnostics,
  manifest: getCanonicalToolManifest,
  agentList: listCanonicalToolsForAgent,
  agentManifest: getCanonicalAgentManifest,
  invoke: invokeCanonicalTool,
};
