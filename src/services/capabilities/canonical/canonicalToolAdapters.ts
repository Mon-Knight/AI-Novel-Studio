import { contextCapability } from '../domain/contextCapability';
import { projectCapability } from '../domain/projectCapability';
import { failure } from '../domain/domainResult';
import type { DomainRequest, DomainResult } from '../domain/domainTypes';
import type {
  CanonicalToolBinding,
  CanonicalToolId,
  CanonicalToolInvocationContext,
} from './canonicalToolTypes';

const MAX_ID_LENGTH = 160;
const MAX_QUERY_LENGTH = 1000;
const READ_PROJECT_TIMEOUT_MS = 20_000;
const READ_STRUCTURE_TIMEOUT_MS = 15_000;
const READ_CONTEXT_TIMEOUT_MS = 30_000;
const SEARCH_MEMORY_TIMEOUT_MS = 20_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function invalid(message: string): DomainResult<never> {
  return failure('INVALID_ARGUMENT', message);
}

function invalidScope(message: string): DomainResult<never> {
  return failure('INVALID_SCOPE', message);
}

function scopeMismatch(message: string): DomainResult<never> {
  return failure('SCOPE_MISMATCH', message);
}

function permissionDenied(message: string): DomainResult<never> {
  return failure('PERMISSION_DENIED', message);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): DomainResult<never> | undefined {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  return unknown ? invalid(`Canonical Tool 参数包含未知字段：${unknown}。`) : undefined;
}

function requiredText(
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
  scopeField = false,
): DomainResult<never> | string {
  const raw = value[key];
  if (typeof raw !== 'string' || !raw.trim()) {
    return scopeField
      ? invalidScope(`Canonical Tool 参数需要明确的 ${key}。`)
      : invalid(`Canonical Tool 参数 ${key} 不能为空。`);
  }
  if (Array.from(raw).length > maxLength) {
    return invalid(`Canonical Tool 参数 ${key} 超过 ${maxLength} 字符。`);
  }
  return raw.trim();
}

function optionalText(
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
): DomainResult<never> | string | undefined {
  if (value[key] === undefined) return undefined;
  const raw = value[key];
  if (typeof raw !== 'string' || !raw.trim()) {
    return invalid(`Canonical Tool 参数 ${key} 不能为空。`);
  }
  if (Array.from(raw).length > maxLength) {
    return invalid(`Canonical Tool 参数 ${key} 超过 ${maxLength} 字符。`);
  }
  return raw.trim();
}

function hostScope(
  request: DomainRequest,
  context: CanonicalToolInvocationContext,
  chapterRequired: boolean,
): DomainResult<never> | undefined {
  if (!context.novelId?.trim()) {
    return invalidScope('Canonical Tool 执行需要宿主提供当前 novelId。');
  }
  if (request.novelId !== context.novelId) {
    return scopeMismatch('Canonical Tool 不能越过当前作品 scope。');
  }
  if (!chapterRequired) return undefined;
  if (!context.chapterId?.trim()) {
    return invalidScope('Canonical Tool 执行需要宿主提供当前 chapterId。');
  }
  if (request.chapterId !== context.chapterId) {
    return scopeMismatch('Canonical Tool 不能越过当前章节 scope。');
  }
  return undefined;
}

function hostPermissions(
  context: CanonicalToolInvocationContext,
  required: readonly string[],
): DomainResult<never> | undefined {
  const granted = new Set(context.grantedPermissions ?? []);
  const missing = required.filter((permission) => !granted.has(permission));
  return missing.length > 0
    ? permissionDenied(`Canonical Tool 缺少宿主权限：${missing.join(', ')}。`)
    : undefined;
}

function parseNovelRequest(
  argumentsJson: unknown,
  context: CanonicalToolInvocationContext,
): DomainResult<never> | DomainRequest {
  const value = record(argumentsJson);
  if (!value) return invalid('Canonical Tool 参数必须是 JSON 对象。');
  const unknown = assertKeys(value, ['novelId']);
  if (unknown) return unknown;
  const novelId = requiredText(value, 'novelId', MAX_ID_LENGTH, true);
  if (typeof novelId !== 'string') return novelId;
  const request: DomainRequest = { novelId, signal: context.signal };
  return hostScope(request, context, false) ?? hostPermissions(context, ['novel.read']) ?? request;
}

function parseChapterRequest(
  argumentsJson: unknown,
  context: CanonicalToolInvocationContext,
  allowQuery: boolean,
): DomainResult<never> | DomainRequest {
  const value = record(argumentsJson);
  if (!value) return invalid('Canonical Tool 参数必须是 JSON 对象。');
  const unknown = assertKeys(
    value,
    allowQuery ? ['novelId', 'chapterId', 'query'] : ['novelId', 'chapterId'],
  );
  if (unknown) return unknown;
  const novelId = requiredText(value, 'novelId', MAX_ID_LENGTH, true);
  if (typeof novelId !== 'string') return novelId;
  const chapterId = requiredText(value, 'chapterId', MAX_ID_LENGTH, true);
  if (typeof chapterId !== 'string') return chapterId;
  const query = allowQuery ? optionalText(value, 'query', MAX_QUERY_LENGTH) : undefined;
  if (query && typeof query !== 'string') return query;
  const request: DomainRequest = {
    novelId,
    chapterId,
    ...(typeof query === 'string' ? { query } : {}),
    signal: context.signal,
  };
  return (
    hostScope(request, context, true) ??
    hostPermissions(context, ['novel.read', 'chapter.read']) ??
    request
  );
}

function parseMemoryRequest(
  argumentsJson: unknown,
  context: CanonicalToolInvocationContext,
): DomainResult<never> | DomainRequest {
  const value = record(argumentsJson);
  if (!value) return invalid('Canonical Tool 参数必须是 JSON 对象。');
  const unknown = assertKeys(value, ['novelId', 'query']);
  if (unknown) return unknown;
  const novelId = requiredText(value, 'novelId', MAX_ID_LENGTH, true);
  if (typeof novelId !== 'string') return novelId;
  const query = requiredText(value, 'query', MAX_QUERY_LENGTH);
  if (typeof query !== 'string') return query;
  const request: DomainRequest = { novelId, query, signal: context.signal };
  return hostScope(request, context, false) ?? hostPermissions(context, ['novel.read']) ?? request;
}

function isFailure(value: DomainResult<never> | DomainRequest): value is DomainResult<never> {
  return 'ok' in value;
}

const novelRead: CanonicalToolBinding = {
  id: 'novel.read',
  expectedFacade: 'projectCapability.readCurrentProject',
  requiredPermissions: ['novel.read'],
  timeoutMs: READ_PROJECT_TIMEOUT_MS,
  async execute(argumentsJson, context) {
    const parsed = parseNovelRequest(argumentsJson, context);
    if (isFailure(parsed)) return parsed;
    return projectCapability.readCurrentProject(parsed);
  },
};

const structureRead: CanonicalToolBinding = {
  id: 'structure.read',
  expectedFacade: 'projectCapability.readChapterPosition',
  requiredPermissions: ['novel.read', 'chapter.read'],
  timeoutMs: READ_STRUCTURE_TIMEOUT_MS,
  async execute(argumentsJson, context) {
    const parsed = parseChapterRequest(argumentsJson, context, false);
    if (isFailure(parsed)) return parsed;
    return projectCapability.readChapterPosition(parsed);
  },
};

const contextRead: CanonicalToolBinding = {
  id: 'context.read',
  expectedFacade: 'contextCapability.readCurrentStoryContext',
  requiredPermissions: ['novel.read', 'chapter.read'],
  timeoutMs: READ_CONTEXT_TIMEOUT_MS,
  async execute(argumentsJson, context) {
    const parsed = parseChapterRequest(argumentsJson, context, true);
    if (isFailure(parsed)) return parsed;
    return contextCapability.readCurrentStoryContext(parsed);
  },
};

const memorySearch: CanonicalToolBinding = {
  id: 'memory.search',
  expectedFacade: 'contextCapability.searchMemory',
  requiredPermissions: ['novel.read'],
  timeoutMs: SEARCH_MEMORY_TIMEOUT_MS,
  async execute(argumentsJson, context) {
    const parsed = parseMemoryRequest(argumentsJson, context);
    if (isFailure(parsed)) return parsed;
    return contextCapability.searchMemory(parsed);
  },
};

/**
 * Fixed bindings are the only bridge from canonical names to domain code.
 * There is intentionally no service/method reflection or user-provided
 * executor name.
 */
export const CANONICAL_TOOL_BINDINGS: readonly CanonicalToolBinding[] = [
  novelRead,
  structureRead,
  contextRead,
  memorySearch,
];

export function getCanonicalToolBinding(id: string): CanonicalToolBinding | undefined {
  switch (id) {
    case 'novel.read':
      return novelRead;
    case 'structure.read':
      return structureRead;
    case 'context.read':
      return contextRead;
    case 'memory.search':
      return memorySearch;
    default:
      return undefined;
  }
}

export function isCanonicalToolId(value: string): value is CanonicalToolId {
  return getCanonicalToolBinding(value) !== undefined;
}
