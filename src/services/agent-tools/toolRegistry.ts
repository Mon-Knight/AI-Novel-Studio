import type {
  ToolDescriptorV1,
  ToolInvocationContext,
  ToolJsonSchema,
  ToolRegistryErrorCode,
  ToolRegistryManifestV1,
  ToolResult,
} from '../../types/toolRegistry';
import { canonicalHash, compareCanonicalText } from '../ai/compilation/canonical';

export interface ToolDefinition {
  descriptor: ToolDescriptorV1;
  handler: (
    argumentsJson: Record<string, unknown>,
    context: ToolInvocationContext,
  ) => Promise<ToolResult>;
  verifyConfirmation?: (
    argumentsJson: Record<string, unknown>,
    context: ToolInvocationContext,
  ) => Promise<boolean>;
}

export class ToolRegistryError extends Error {
  readonly code: ToolRegistryErrorCode;
  readonly retryable = false;
  readonly details?: Record<string, unknown>;

  constructor(code: ToolRegistryErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ToolRegistryError';
    this.code = code;
    this.details = details;
  }
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateSchema(value: unknown, schema: ToolJsonSchema, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path} 不在允许的枚举值中`);
    return errors;
  }
  if (schema.type) {
    const actual = valueType(value);
    const matches =
      schema.type === 'number'
        ? actual === 'number' || actual === 'integer'
        : actual === schema.type;
    if (!matches) {
      errors.push(`${path} 应为 ${schema.type}，实际为 ${actual}`);
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && Array.from(value).length < schema.minLength) {
      errors.push(`${path} 少于 ${schema.minLength} 字符`);
    }
    if (schema.maxLength !== undefined && Array.from(value).length > schema.maxLength) {
      errors.push(`${path} 超过 ${schema.maxLength} 字符`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} 小于 ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} 大于 ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} 少于 ${schema.minItems} 项`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} 超过 ${schema.maxItems} 项`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(item, schema.items!, `${path}[${index}]`));
      });
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in record)) errors.push(`${path}.${required} 为必填字段`);
    }
    for (const [key, child] of Object.entries(record)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} 是未知字段`);
        continue;
      }
      errors.push(...validateSchema(child, childSchema, `${path}.${key}`));
    }
  }
  return errors;
}

function descriptorIdentity(descriptor: Pick<ToolDescriptorV1, 'name' | 'version'>): string {
  return `${descriptor.name}@${descriptor.version}`;
}

function validateDescriptor(descriptor: ToolDescriptorV1): ToolDescriptorV1 {
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(descriptor.name)) {
    throw new Error(`Invalid tool name: ${descriptor.name}`);
  }
  if (!/^[1-9][0-9]{0,5}$/.test(descriptor.version)) {
    throw new Error(`Invalid tool version: ${descriptor.version}`);
  }
  if (!descriptor.description.trim() || descriptor.description.length > 500) {
    throw new Error(`Invalid tool description: ${descriptor.name}`);
  }
  if (
    !Number.isInteger(descriptor.timeoutMs) ||
    descriptor.timeoutMs < 100 ||
    descriptor.timeoutMs > 300_000
  ) {
    throw new Error(`Invalid tool timeout: ${descriptor.name}`);
  }
  if (!['system', 'novel', 'chapter', 'draft'].includes(descriptor.scope)) {
    throw new Error(`Invalid tool scope: ${descriptor.name}`);
  }
  if (descriptor.sideEffect === 'none' && descriptor.confirmationPolicy !== 'never') {
    throw new Error(`Read-only tool cannot require confirmation: ${descriptor.name}`);
  }
  if (descriptor.sideEffect !== 'none' && descriptor.confirmationPolicy !== 'user_confirmation') {
    throw new Error(`Side-effect tool must require user confirmation: ${descriptor.name}`);
  }
  return {
    ...descriptor,
    description: descriptor.description.trim(),
    permissions: [...new Set(descriptor.permissions)].sort(),
  };
}

function publicDescriptor(descriptor: ToolDescriptorV1): ToolDescriptorV1 {
  return JSON.parse(JSON.stringify(descriptor)) as ToolDescriptorV1;
}

function publicManifest(manifest: ToolRegistryManifestV1): ToolRegistryManifestV1 {
  return JSON.parse(JSON.stringify(manifest)) as ToolRegistryManifestV1;
}

export class ToolRegistry {
  private readonly definitions: Map<string, ToolDefinition>;
  private manifestPromise?: Promise<ToolRegistryManifestV1>;

  constructor(definitions: ToolDefinition[]) {
    this.definitions = new Map();
    for (const definition of definitions) {
      const descriptor = validateDescriptor(definition.descriptor);
      const identity = descriptorIdentity(descriptor);
      if (this.definitions.has(identity)) throw new Error(`Duplicate tool identity: ${identity}`);
      if (descriptor.sideEffect !== 'none' && !definition.verifyConfirmation) {
        throw new Error(`Side-effect tool lacks confirmation verifier: ${identity}`);
      }
      this.definitions.set(identity, { ...definition, descriptor });
    }
  }

  async getManifest(): Promise<ToolRegistryManifestV1> {
    if (!this.manifestPromise) {
      this.manifestPromise = (async () => {
        const tools = [...this.definitions.values()]
          .map((definition) => publicDescriptor(definition.descriptor))
          .sort((left, right) =>
            compareCanonicalText(descriptorIdentity(left), descriptorIdentity(right)),
          );
        const registryHash = await canonicalHash({
          contractVersion: 'tool_registry_manifest_v1',
          registryVersion: 'tool_registry_v1',
          tools,
        });
        return {
          contractVersion: 'tool_registry_manifest_v1',
          registryVersion: 'tool_registry_v1',
          registryHash,
          tools,
        };
      })();
    }
    return publicManifest(await this.manifestPromise);
  }

  async invoke(
    name: string,
    version: string,
    argumentsJson: unknown,
    context: ToolInvocationContext,
  ): Promise<ToolResult> {
    const identity = `${name}@${version}`;
    const exact = this.definitions.get(identity);
    if (!exact) {
      const versions = [...this.definitions.values()]
        .filter((definition) => definition.descriptor.name === name)
        .map((definition) => definition.descriptor.version);
      throw new ToolRegistryError(
        versions.length > 0 ? 'TOOL_VERSION_MISMATCH' : 'TOOL_NOT_FOUND',
        versions.length > 0 ? `工具 ${name} 不支持版本 ${version}。` : `工具 ${name} 不存在。`,
        versions.length > 0 ? { availableVersions: versions } : undefined,
      );
    }
    if (!context.allowedTools.includes(identity)) {
      throw new ToolRegistryError('TOOL_NOT_ALLOWED', `工具 ${identity} 不在本次执行白名单。`);
    }
    const granted = new Set(context.grantedPermissions);
    const missingPermissions = exact.descriptor.permissions.filter(
      (permission) => !granted.has(permission),
    );
    if (missingPermissions.length > 0) {
      throw new ToolRegistryError('TOOL_PERMISSION_DENIED', `工具 ${identity} 缺少权限。`, {
        missingPermissions,
      });
    }
    const argumentErrors = validateSchema(argumentsJson, exact.descriptor.inputSchema);
    if (
      argumentErrors.length > 0 ||
      argumentsJson === null ||
      typeof argumentsJson !== 'object' ||
      Array.isArray(argumentsJson)
    ) {
      throw new ToolRegistryError('TOOL_ARGUMENT_INVALID', `工具 ${identity} 参数不符合 schema。`, {
        errors: argumentErrors.slice(0, 20),
      });
    }
    const argumentsRecord = argumentsJson as Record<string, unknown>;
    const requiredScope = exact.descriptor.scope;
    if (
      (requiredScope === 'novel' && !context.novelId) ||
      (requiredScope === 'chapter' && (!context.novelId || !context.chapterId)) ||
      (requiredScope === 'draft' && (!context.novelId || !context.chapterId || !context.draftId))
    ) {
      throw new ToolRegistryError(
        'TOOL_SCOPE_MISMATCH',
        `工具 ${identity} 缺少权威 ${requiredScope} scope。`,
      );
    }
    for (const key of ['novelId', 'chapterId', 'draftId'] as const) {
      const requested = argumentsRecord[key];
      const scoped = context[key];
      if (typeof requested === 'string' && scoped && requested !== scoped) {
        throw new ToolRegistryError(
          'TOOL_SCOPE_MISMATCH',
          `工具 ${identity} 不能越过当前 ${key} scope。`,
        );
      }
    }
    if (exact.descriptor.sideEffect !== 'none') {
      const confirmation = context.confirmation;
      const evidenceShapeValid =
        confirmation?.confirmedBy === 'user' &&
        Boolean(confirmation.userConfirmedAt) &&
        Boolean(confirmation.planId) &&
        Boolean(confirmation.operationId) &&
        /^[0-9a-f]{64}$/.test(confirmation.planHash);
      let verified = false;
      if (evidenceShapeValid) {
        let verificationTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          verified = await Promise.race([
            exact.verifyConfirmation!(argumentsRecord, context),
            new Promise<boolean>((resolve) => {
              verificationTimeout = setTimeout(
                () => resolve(false),
                Math.min(exact.descriptor.timeoutMs, 5000),
              );
            }),
          ]);
        } catch {
          verified = false;
        } finally {
          if (verificationTimeout !== undefined) clearTimeout(verificationTimeout);
        }
      }
      if (!verified) {
        throw new ToolRegistryError(
          'TOOL_CONFIRMATION_REQUIRED',
          `工具 ${identity} 具有副作用，必须复验持久 ApplyPlan 确认证据。`,
        );
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(new ToolRegistryError('TOOL_EXECUTION_FAILED', `工具 ${identity} 执行超时。`)),
          exact.descriptor.timeoutMs,
        );
      });
      const result = await Promise.race([exact.handler(argumentsRecord, context), timeout]);
      let jsonResult: ToolResult;
      try {
        jsonResult = JSON.parse(JSON.stringify(result)) as ToolResult;
      } catch {
        throw new ToolRegistryError(
          'TOOL_OUTPUT_INVALID',
          `工具 ${identity} 输出不是可持久化 JSON。`,
        );
      }
      const outputErrors = validateSchema(jsonResult, exact.descriptor.outputSchema);
      if (outputErrors.length > 0) {
        throw new ToolRegistryError('TOOL_OUTPUT_INVALID', `工具 ${identity} 输出不符合 schema。`, {
          errors: outputErrors.slice(0, 20),
        });
      }
      return jsonResult;
    } catch (error) {
      if (context.signal?.aborted) {
        throw new DOMException('任务已取消', 'AbortError');
      }
      if (error instanceof ToolRegistryError) throw error;
      throw new ToolRegistryError('TOOL_EXECUTION_FAILED', `工具 ${identity} 执行失败。`);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}

export const toolRegistryPrivate = { validateSchema, descriptorIdentity };
