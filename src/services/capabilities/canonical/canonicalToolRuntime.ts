import { validateToolJsonSchema } from '../../agent-tools/toolRegistry';
import { failure } from '../domain/domainResult';
import type { DomainResult } from '../domain/domainTypes';
import { getCanonicalToolBinding } from './canonicalToolAdapters';
import { getCanonicalToolDescriptor, getCanonicalToolManifest } from './canonicalToolProjection';
import type {
  CanonicalToolCall,
  CanonicalToolExecutionContext,
  CanonicalToolManifest,
} from './canonicalToolTypes';

let verifiedManifestPromise: Promise<CanonicalToolManifest> | undefined;

function verifiedManifest(): Promise<CanonicalToolManifest> {
  verifiedManifestPromise ??= getCanonicalToolManifest();
  return verifiedManifestPromise;
}

function assertPortableJson(
  value: unknown,
  allowUndefinedObjectValues: boolean,
  path = '$',
  ancestors = new WeakSet<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new Error(`${path} 包含不可移植数值。`);
    }
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} 包含非 JSON 值。`);
  if (ancestors.has(value)) throw new Error(`${path} 包含循环引用。`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`${path}[${index}] 是稀疏数组项。`);
      assertPortableJson(value[index], false, `${path}[${index}]`, ancestors);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} 不是普通 JSON 对象。`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined && allowUndefinedObjectValues) continue;
      assertPortableJson(child, allowUndefinedObjectValues, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function jsonClone(value: unknown, allowUndefinedObjectValues = false): unknown {
  assertPortableJson(value, allowUndefinedObjectValues);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('值不是可持久化 JSON。');
  return JSON.parse(serialized) as unknown;
}

function invalidCall(message: string): DomainResult<never> {
  return failure('INVALID_ARGUMENT', message);
}

function integrityFailure(message: string): DomainResult<never> {
  return failure('INTEGRITY_ERROR', message);
}

function permissionFailure(message: string): DomainResult<never> {
  return failure('PERMISSION_DENIED', message);
}

/**
 * Shared implementation for projected Canonical Tool execution.
 *
 * Validation order is deliberate: manifest identity, exact version,
 * fixed audience exposure, per-run allowlist, permissions, schemas, then the fixed
 * adapter (which independently rechecks host scope and permissions).
 */
async function executeCanonicalToolWithAudience(
  call: CanonicalToolCall,
  context: CanonicalToolExecutionContext,
  audience: 'host_validation' | 'agent',
): Promise<DomainResult<unknown>> {
  let manifest: CanonicalToolManifest;
  try {
    manifest = await verifiedManifest();
  } catch (error) {
    return integrityFailure(
      error instanceof Error
        ? `Canonical Tool manifest 校验失败：${error.message}`
        : 'Canonical Tool manifest 校验失败。',
    );
  }

  if (!call || typeof call !== 'object') {
    return invalidCall('Canonical Tool 调用必须是对象。');
  }
  if (!context || typeof context !== 'object') {
    return invalidCall('Canonical Tool 执行上下文必须是对象。');
  }
  if (
    typeof call.expectedProjectionHash !== 'string' ||
    call.expectedProjectionHash !== manifest.projectionHash
  ) {
    return integrityFailure('Canonical Tool 调用绑定的 projection hash 已漂移。');
  }
  if (typeof call.name !== 'string' || !call.name || typeof call.version !== 'string') {
    return invalidCall('Canonical Tool 调用需要明确的 name 和 version。');
  }

  const descriptor = manifest.tools.find((tool) => tool.id === call.name);
  if (!descriptor) {
    return failure('NOT_FOUND', `Canonical Tool ${call.name} 不在共享 manifest 中。`);
  }
  if (descriptor.version !== call.version) {
    return failure('NOT_FOUND', `Canonical Tool ${call.name} 不支持版本 ${call.version}。`);
  }
  const identity = `${descriptor.id}@${descriptor.version}`;
  if (descriptor.sideEffect !== 'none' || descriptor.confirmationPolicy !== 'never') {
    return failure(
      'CONFIRMATION_REQUIRED',
      `Canonical Tool ${identity} 不是本阶段允许的只读能力。`,
    );
  }
  if (
    typeof context.invocationId !== 'string' ||
    !context.invocationId.trim() ||
    Array.from(context.invocationId).length > 200
  ) {
    return invalidCall('Canonical Tool 调用需要有效的 invocationId。');
  }
  if (audience === 'agent' && !manifest.modelVisibleToolIdentities.includes(identity)) {
    return permissionFailure(`Canonical Tool ${identity} 尚未向 Main Agent 放行。`);
  }
  if (
    !Array.isArray(context.allowedTools) ||
    context.allowedTools.some((value) => typeof value !== 'string') ||
    !context.allowedTools.includes(identity)
  ) {
    return permissionFailure(`Canonical Tool ${identity} 不在本次宿主 allowlist 中。`);
  }

  const granted = new Set(
    Array.isArray(context.grantedPermissions)
      ? context.grantedPermissions.filter((value) => typeof value === 'string')
      : [],
  );
  const missingPermissions = descriptor.permissions.filter(
    (permission) => !granted.has(permission),
  );
  if (missingPermissions.length > 0) {
    return permissionFailure(
      `Canonical Tool ${identity} 缺少宿主权限：${missingPermissions.join(', ')}。`,
    );
  }

  let argumentsJson: unknown;
  try {
    argumentsJson = jsonClone(call.argumentsJson);
  } catch {
    return invalidCall(`Canonical Tool ${identity} 参数不是可持久化 JSON。`);
  }
  const argumentErrors = validateToolJsonSchema(argumentsJson, descriptor.inputSchema);
  if (
    argumentErrors.length > 0 ||
    argumentsJson === null ||
    typeof argumentsJson !== 'object' ||
    Array.isArray(argumentsJson)
  ) {
    return invalidCall(
      `Canonical Tool ${identity} 参数不符合 schema：${argumentErrors.slice(0, 10).join('；')}`,
    );
  }

  const dynamicDescriptor = getCanonicalToolDescriptor(descriptor.id);
  const binding = getCanonicalToolBinding(descriptor.id);
  if (
    !dynamicDescriptor ||
    !binding ||
    binding.timeoutMs !== descriptor.timeoutMs ||
    binding.expectedFacade !== dynamicDescriptor.facade
  ) {
    return integrityFailure(`Canonical Tool ${identity} 的固定执行绑定已漂移。`);
  }
  if (context.signal?.aborted) {
    return failure('UPSTREAM_FAILURE', `Canonical Tool ${identity} 执行已取消。`);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    const timeout = new Promise<DomainResult<unknown>>((resolve) => {
      timeoutId = setTimeout(
        () => resolve(failure('UPSTREAM_FAILURE', `Canonical Tool ${identity} 执行超过超时上限。`)),
        descriptor.timeoutMs,
      );
    });
    const outcomes: Array<Promise<DomainResult<unknown>>> = [
      binding.execute(argumentsJson, context),
      timeout,
    ];
    if (context.signal) {
      outcomes.push(
        new Promise<DomainResult<unknown>>((resolve) => {
          abortHandler = () =>
            resolve(failure('UPSTREAM_FAILURE', `Canonical Tool ${identity} 执行已取消。`));
          context.signal!.addEventListener('abort', abortHandler, { once: true });
        }),
      );
    }
    const result = await Promise.race(outcomes);

    let portableResult: unknown;
    try {
      portableResult = jsonClone(result, true);
    } catch {
      return integrityFailure(`Canonical Tool ${identity} 输出不是可持久化 JSON。`);
    }
    const outputErrors = validateToolJsonSchema(portableResult, descriptor.outputSchema);
    if (outputErrors.length > 0) {
      return integrityFailure(
        `Canonical Tool ${identity} 输出不符合 manifest schema：${outputErrors
          .slice(0, 10)
          .join('；')}`,
      );
    }
    return portableResult as DomainResult<unknown>;
  } catch (error) {
    return failure(
      'UPSTREAM_FAILURE',
      error instanceof Error ? error.message : `Canonical Tool ${identity} 执行失败。`,
    );
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortHandler && context.signal) {
      context.signal.removeEventListener('abort', abortHandler);
    }
  }
}

/** Public Agent execution path.  The caller cannot opt into host validation. */
export function executeCanonicalTool(
  call: CanonicalToolCall,
  context: CanonicalToolExecutionContext,
): Promise<DomainResult<unknown>> {
  return executeCanonicalToolWithAudience(call, context, 'agent');
}

/**
 * Test/E2E-only proof path for catalog-only adapters.  Deliberately omitted
 * from the canonical package index so production consumers do not discover it
 * as an Agent execution API.
 */
export function executeCanonicalToolForHostValidation(
  call: CanonicalToolCall,
  context: CanonicalToolExecutionContext,
): Promise<DomainResult<unknown>> {
  return executeCanonicalToolWithAudience(call, context, 'host_validation');
}

export const canonicalToolRuntime = {
  execute: executeCanonicalTool,
};
