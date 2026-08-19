import type { AppError } from '../../types/appError';
import { normalizeAppError } from '../../types/appError';
import { createUniqueId } from '../../utils/uniqueId';
import { appLogger } from '../observability/appLogger';

export interface WorkspaceLogContext {
  traceId?: string;
  operationId?: string;
  novelId?: string;
  chapterId?: string;
  draftId?: string;
  draftVersion?: number;
  contentHash?: string;
  [key: string]: unknown;
}

export function createTraceId(prefix = 'trace'): string {
  return `${prefix}-${createUniqueId()}`;
}

export function createOperationId(): string {
  return createTraceId('operation');
}

function sanitizeContext(context: WorkspaceLogContext): WorkspaceLogContext {
  const safe: WorkspaceLogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (/content$|prompt|api.?key|token|secret/i.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

export function logWorkspaceError(
  event: string,
  value: unknown,
  context: WorkspaceLogContext = {},
): AppError {
  const error = normalizeAppError(value, '工作区操作失败。', {
    traceId: context.traceId,
    operationId: context.operationId,
  });
  appLogger.error(`[WorkspaceError] ${event}`, {
    ...sanitizeContext(context),
    code: error.code,
    retryable: error.retryable,
    traceId: error.traceId ?? context.traceId,
    operationId: error.operationId ?? context.operationId,
    details: error.details,
  });
  return error;
}

export function logWorkspaceWarning(event: string, context: WorkspaceLogContext = {}): void {
  appLogger.warn(`[WorkspaceWarning] ${event}`, sanitizeContext(context));
}
