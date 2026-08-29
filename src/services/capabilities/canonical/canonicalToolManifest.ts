import rawCanonicalToolManifest from '../../../../contracts/agent/canonical-tool-manifest.v1.json';
import {
  canonicalHash,
  compareCanonicalText,
  isPlainRecord,
  stableCanonicalJson,
} from '../../ai/compilation/canonical';
import {
  getCapability,
  type CapabilityDefinition,
  type CapabilityExposure,
  type CapabilityHealth,
} from '../capabilityCatalog';
import { CANONICAL_TOOL_BINDINGS, getCanonicalToolBinding } from './canonicalToolAdapters';
import {
  CANONICAL_TOOL_IDS,
  type CanonicalPortableToolDescriptor,
  type CanonicalProjectionState,
  type CanonicalToolDescriptor,
  type CanonicalToolId,
  type CanonicalToolManifest,
} from './canonicalToolTypes';
import type { ToolJsonSchema, ToolJsonSchemaType } from '../../../types/toolRegistry';

export const CANONICAL_TOOL_MANIFEST_CANONICALIZATION = 'ans_canonical_json_v1' as const;

const MANIFEST_KEYS = [
  'contractVersion',
  'projectionVersion',
  'canonicalization',
  'projectionHash',
  'modelVisibleToolIdentities',
  'tools',
] as const;

const PORTABLE_TOOL_KEYS = [
  'id',
  'name',
  'version',
  'description',
  'inputSchema',
  'outputSchema',
  'scope',
  'permissions',
  'sideEffect',
  'confirmationPolicy',
  'timeoutMs',
  'exposure',
  'projectionState',
  'health',
] as const;

const JSON_SCHEMA_KEYS = [
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
] as const;

const JSON_SCHEMA_TYPES: readonly ToolJsonSchemaType[] = [
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
];

const CAPABILITY_SCOPES = ['novel', 'chapter', 'draft', 'project', 'runtime'] as const;
const CAPABILITY_SIDE_EFFECTS = ['none', 'proposal', 'write'] as const;
const CAPABILITY_CONFIRMATIONS = ['never', 'user_required'] as const;
const CAPABILITY_EXPOSURES = ['catalog_only', 'candidate', 'stable', 'internal'] as const;
const CAPABILITY_HEALTH = ['working', 'partial', 'broken', 'legacy', 'unknown'] as const;
const PROJECTION_STATES = ['catalog_only', 'candidate', 'stable', 'blocked'] as const;

function invalid(message: string): never {
  throw new Error(`Canonical Tool manifest 无效：${message}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) invalid(`${path}.${unknown} 是未知字段。`);
  const missing = allowed.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing} 缺失。`);
}

function assertSafeInteger(
  value: unknown,
  path: string,
  minimum?: number,
  maximum?: number,
): asserts value is number {
  if (!Number.isSafeInteger(value)) invalid(`${path} 必须是安全整数。`);
  const integer = value as number;
  if (minimum !== undefined && integer < minimum) invalid(`${path} 小于 ${minimum}。`);
  if (maximum !== undefined && integer > maximum) invalid(`${path} 大于 ${maximum}。`);
}

function assertStringArray(value: unknown, path: string, maxItems = 128): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid(`${path} 必须是最多 ${maxItems} 项的字符串数组。`);
  }
  const result = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) invalid(`${path}[${index}] 必须是非空字符串。`);
    return item as string;
  });
  if (new Set(result).size !== result.length) invalid(`${path} 不允许重复项。`);
  return result;
}

function assertJsonSchema(
  value: unknown,
  path: string,
  depth = 0,
): asserts value is ToolJsonSchema {
  if (depth > 32) invalid(`${path} 嵌套超过 32 层。`);
  if (!isPlainRecord(value)) invalid(`${path} 必须是 JSON Schema 对象。`);
  const allowed = new Set<string>(JSON_SCHEMA_KEYS);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) invalid(`${path}.${unknown} 不是允许的 schema 字段。`);

  if (
    value.type !== undefined &&
    (typeof value.type !== 'string' ||
      !JSON_SCHEMA_TYPES.includes(value.type as ToolJsonSchemaType))
  ) {
    invalid(`${path}.type 无效。`);
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    invalid(`${path}.description 必须是字符串。`);
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') {
    invalid(`${path}.additionalProperties 必须是布尔值。`);
  }
  if (value.properties !== undefined) {
    if (!isPlainRecord(value.properties)) invalid(`${path}.properties 必须是对象。`);
    for (const [key, child] of Object.entries(value.properties)) {
      if (!key) invalid(`${path}.properties 不允许空字段名。`);
      assertJsonSchema(child, `${path}.properties.${key}`, depth + 1);
    }
  }
  if (value.required !== undefined) {
    const required = assertStringArray(value.required, `${path}.required`);
    const properties = value.properties;
    if (!isPlainRecord(properties)) invalid(`${path}.required 需要 properties。`);
    const missingProperty = required.find((key) => !(key in properties));
    if (missingProperty) invalid(`${path}.required 引用了未声明字段 ${missingProperty}。`);
  }
  if (value.items !== undefined) assertJsonSchema(value.items, `${path}.items`, depth + 1);
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.length > 128) {
      invalid(`${path}.enum 必须是 1 到 128 项的数组。`);
    }
    for (const [index, item] of value.enum.entries()) {
      if (!['string', 'number', 'boolean'].includes(typeof item) && item !== null) {
        invalid(`${path}.enum[${index}] 必须是 JSON 标量。`);
      }
      if (typeof item === 'number' && !Number.isSafeInteger(item)) {
        invalid(`${path}.enum[${index}] 必须是安全整数。`);
      }
    }
    if (new Set(value.enum.map((item) => stableCanonicalJson(item))).size !== value.enum.length) {
      invalid(`${path}.enum 不允许重复项。`);
    }
  }

  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (value[key] !== undefined) assertSafeInteger(value[key], `${path}.${key}`, 0);
  }
  for (const key of ['minimum', 'maximum'] as const) {
    if (value[key] !== undefined) assertSafeInteger(value[key], `${path}.${key}`);
  }
  if (
    typeof value.minLength === 'number' &&
    typeof value.maxLength === 'number' &&
    value.minLength > value.maxLength
  ) {
    invalid(`${path} 的 minLength 大于 maxLength。`);
  }
  if (
    typeof value.minimum === 'number' &&
    typeof value.maximum === 'number' &&
    value.minimum > value.maximum
  ) {
    invalid(`${path} 的 minimum 大于 maximum。`);
  }
  if (
    typeof value.minItems === 'number' &&
    typeof value.maxItems === 'number' &&
    value.minItems > value.maxItems
  ) {
    invalid(`${path} 的 minItems 大于 maxItems。`);
  }
}

function expectedProjectionState(
  exposure: CapabilityExposure,
  health: CapabilityHealth,
): CanonicalProjectionState {
  if (exposure === 'stable' && health === 'working') return 'stable';
  if (exposure === 'candidate') return 'candidate';
  if (['broken', 'legacy', 'unknown'].includes(health)) return 'blocked';
  return 'catalog_only';
}

function modelVisibleIdentity(tool: CanonicalPortableToolDescriptor): string | undefined {
  return tool.exposure === 'stable' &&
    tool.projectionState === 'stable' &&
    tool.health === 'working' &&
    tool.sideEffect === 'none' &&
    tool.confirmationPolicy === 'never'
    ? `${tool.id}@${tool.version}`
    : undefined;
}

function assertPortableTool(
  value: unknown,
  index: number,
): asserts value is CanonicalPortableToolDescriptor {
  const path = `$.tools[${index}]`;
  if (!isPlainRecord(value)) invalid(`${path} 必须是对象。`);
  assertExactKeys(value, PORTABLE_TOOL_KEYS, path);
  if (typeof value.id !== 'string' || !CANONICAL_TOOL_IDS.includes(value.id as CanonicalToolId)) {
    invalid(`${path}.id 不是已声明的 canonical id。`);
  }
  if (value.name !== value.id) invalid(`${path}.name 必须与 id 相同。`);
  if (value.version !== '1') invalid(`${path}.version 必须为 1。`);
  if (
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    value.description !== value.description.trim() ||
    Array.from(value.description).length > 500
  ) {
    invalid(`${path}.description 无效。`);
  }
  assertJsonSchema(value.inputSchema, `${path}.inputSchema`);
  assertJsonSchema(value.outputSchema, `${path}.outputSchema`);
  if (!CAPABILITY_SCOPES.includes(value.scope as (typeof CAPABILITY_SCOPES)[number])) {
    invalid(`${path}.scope 无效。`);
  }
  const permissions = assertStringArray(value.permissions, `${path}.permissions`, 32);
  if (permissions.some((permission) => !/^[a-z][a-z0-9_.-]{1,95}$/.test(permission))) {
    invalid(`${path}.permissions 含无效权限。`);
  }
  if (!CAPABILITY_SIDE_EFFECTS.includes(value.sideEffect as never)) {
    invalid(`${path}.sideEffect 无效。`);
  }
  if (!CAPABILITY_CONFIRMATIONS.includes(value.confirmationPolicy as never)) {
    invalid(`${path}.confirmationPolicy 无效。`);
  }
  if (value.sideEffect === 'none' && value.confirmationPolicy !== 'never') {
    invalid(`${path} 的只读动作不能要求确认。`);
  }
  if (value.sideEffect === 'write' && value.confirmationPolicy !== 'user_required') {
    invalid(`${path} 的写动作必须要求用户确认。`);
  }
  assertSafeInteger(value.timeoutMs, `${path}.timeoutMs`, 100, 300_000);
  if (!CAPABILITY_EXPOSURES.includes(value.exposure as never)) invalid(`${path}.exposure 无效。`);
  if (!PROJECTION_STATES.includes(value.projectionState as never)) {
    invalid(`${path}.projectionState 无效。`);
  }
  if (!CAPABILITY_HEALTH.includes(value.health as never)) invalid(`${path}.health 无效。`);
  if (
    value.projectionState !==
    expectedProjectionState(value.exposure as CapabilityExposure, value.health as CapabilityHealth)
  ) {
    invalid(`${path}.projectionState 与 exposure/health 不一致。`);
  }
}

function assertManifestShape(value: unknown): asserts value is CanonicalToolManifest {
  if (!isPlainRecord(value)) invalid('根节点必须是对象。');
  assertExactKeys(value, MANIFEST_KEYS, '$');
  if (value.contractVersion !== 'canonical_tool_manifest_v1') {
    invalid('contractVersion 不受支持。');
  }
  if (value.projectionVersion !== '1') invalid('projectionVersion 不受支持。');
  if (value.canonicalization !== CANONICAL_TOOL_MANIFEST_CANONICALIZATION) {
    invalid('canonicalization 不受支持。');
  }
  if (typeof value.projectionHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.projectionHash)) {
    invalid('projectionHash 必须是小写 SHA-256。');
  }
  if (!Array.isArray(value.tools) || value.tools.length === 0 || value.tools.length > 128) {
    invalid('tools 必须是 1 到 128 项的数组。');
  }
  value.tools.forEach(assertPortableTool);
  const identities = value.tools.map((tool) => `${tool.id}@${tool.version}`);
  if (new Set(identities).size !== identities.length) invalid('tools identity 不允许重复。');
  const ids = value.tools.map((tool) => tool.id);
  const sortedIds = [...ids].sort(compareCanonicalText);
  if (ids.some((id, index) => id !== sortedIds[index])) invalid('tools 必须按 id ordinal 排序。');

  const visible = assertStringArray(
    value.modelVisibleToolIdentities,
    '$.modelVisibleToolIdentities',
  );
  const sortedVisible = [...visible].sort(compareCanonicalText);
  if (visible.some((identity, index) => identity !== sortedVisible[index])) {
    invalid('modelVisibleToolIdentities 必须按 identity ordinal 排序。');
  }
  const expectedVisible = value.tools
    .map(modelVisibleIdentity)
    .filter((identity): identity is string => Boolean(identity));
  if (stableCanonicalJson(visible) !== stableCanonicalJson(expectedVisible)) {
    invalid('modelVisibleToolIdentities 与 stable/stable/working 只读派生集合不一致。');
  }
}

function portableDescriptor(descriptor: CanonicalToolDescriptor): CanonicalPortableToolDescriptor {
  return {
    id: descriptor.id,
    name: descriptor.name,
    version: descriptor.version,
    description: descriptor.description,
    inputSchema: clone(descriptor.inputSchema),
    outputSchema: clone(descriptor.outputSchema),
    scope: descriptor.scope,
    permissions: [...descriptor.permissions],
    sideEffect: descriptor.sideEffect,
    confirmationPolicy: descriptor.confirmationPolicy,
    timeoutMs: descriptor.timeoutMs,
    exposure: descriptor.exposure,
    projectionState: descriptor.projectionState,
    health: descriptor.evidence.health,
  };
}

function assertCatalogAndBinding(tool: CanonicalPortableToolDescriptor): void {
  const capability: CapabilityDefinition | undefined = getCapability(tool.id);
  if (!capability || capability.kind !== 'tool') {
    invalid(`${tool.id} 没有确定性 Tool Catalog 条目。`);
  }
  const binding = getCanonicalToolBinding(tool.id);
  if (!binding) invalid(`${tool.id} 没有固定 adapter binding。`);
  if (capability.facade !== binding.expectedFacade) {
    invalid(`${tool.id} 的 Catalog facade 与固定 binding 漂移。`);
  }
  if (binding.timeoutMs !== tool.timeoutMs) invalid(`${tool.id} 的 timeout 漂移。`);
  if (
    stableCanonicalJson(capability.permissions) !== stableCanonicalJson(binding.requiredPermissions)
  ) {
    invalid(`${tool.id} 的 Catalog permissions 与固定 binding 漂移。`);
  }
  const catalogContract = {
    id: capability.id,
    name: capability.id,
    version: capability.version,
    description: capability.description,
    inputSchema: capability.inputSchema,
    scope: capability.scope,
    permissions: capability.permissions,
    sideEffect: capability.sideEffect,
    confirmationPolicy: capability.confirmationPolicy,
    exposure: capability.exposure,
    projectionState: expectedProjectionState(capability.exposure, capability.evidence.health),
    health: capability.evidence.health,
  };
  const artifactContract = {
    id: tool.id,
    name: tool.name,
    version: tool.version,
    description: tool.description,
    inputSchema: tool.inputSchema,
    scope: tool.scope,
    permissions: tool.permissions,
    sideEffect: tool.sideEffect,
    confirmationPolicy: tool.confirmationPolicy,
    exposure: tool.exposure,
    projectionState: tool.projectionState,
    health: tool.health,
  };
  if (stableCanonicalJson(catalogContract) !== stableCanonicalJson(artifactContract)) {
    invalid(`${tool.id} 与 Capability Catalog 漂移。`);
  }
}

function assertProjectionDrift(
  manifest: CanonicalToolManifest,
  descriptors: readonly CanonicalToolDescriptor[],
): void {
  const projected = descriptors
    .map(portableDescriptor)
    .sort((left, right) => compareCanonicalText(left.id, right.id));
  if (stableCanonicalJson(manifest.tools) !== stableCanonicalJson(projected)) {
    invalid('共享 artifact 与 TypeScript dynamic projection 漂移。');
  }
  const bindingIds = CANONICAL_TOOL_BINDINGS.map((binding) => binding.id).sort(
    compareCanonicalText,
  );
  const declaredIds = [...CANONICAL_TOOL_IDS].sort(compareCanonicalText);
  const artifactIds = manifest.tools.map((tool) => tool.id);
  if (
    stableCanonicalJson(bindingIds) !== stableCanonicalJson(declaredIds) ||
    stableCanonicalJson(artifactIds) !== stableCanonicalJson(declaredIds)
  ) {
    invalid('CANONICAL_TOOL_IDS、固定 bindings 与 artifact 集合漂移。');
  }
  manifest.tools.forEach(assertCatalogAndBinding);
}

export async function validateCanonicalToolManifestArtifact(
  value: unknown,
  descriptors: readonly CanonicalToolDescriptor[],
): Promise<CanonicalToolManifest> {
  assertManifestShape(value);
  const { projectionHash, ...withoutHash } = value;
  const computedHash = await canonicalHash(withoutHash);
  if (computedHash !== projectionHash) invalid('projectionHash 与 artifact 内容不一致。');
  assertProjectionDrift(value, descriptors);
  return clone(value);
}

export async function loadCanonicalToolManifest(
  descriptors: readonly CanonicalToolDescriptor[],
): Promise<CanonicalToolManifest> {
  return validateCanonicalToolManifestArtifact(rawCanonicalToolManifest, descriptors);
}
