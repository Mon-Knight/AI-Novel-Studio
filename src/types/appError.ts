export const APP_ERROR_CODES = [
  'DOCUMENT_VERSION_CONFLICT',
  'DOCUMENT_HASH_MISMATCH',
  'TARGET_NOVEL_NOT_FOUND',
  'TARGET_CHAPTER_NOT_FOUND',
  'TARGET_CHAPTER_DELETED',
  'TARGET_DRAFT_NOT_FOUND',
  'DRAFT_UPDATE_ZERO_ROWS',
  'LARGE_TEXT_HASH_MISMATCH',
  'LARGE_TEXT_CHUNK_MISSING',
  'LARGE_TEXT_CONTENT_UNAVAILABLE',
  'LARGE_TEXT_REFERENCE_INVALID',
  'RECOVERY_SNAPSHOT_NOT_FOUND',
  'RECOVERY_BASE_CONFLICT',
  'RECOVERY_CONTENT_INVALID',
  'DATABASE_BUSY',
  'DATABASE_TRANSACTION_FAILED',
  'DATABASE_COMMIT_UNKNOWN',
  'OPERATION_ALREADY_COMPLETED',
  'OPERATION_IN_PROGRESS',
  'OPERATION_PAYLOAD_CONFLICT',
  'OPERATION_REPLAY_TARGET_INVALID',
  'AI_TASK_INPUT_INVALID',
  'AI_TASK_SECRET_DETECTED',
  'AI_TASK_TYPE_UNSUPPORTED',
  'AI_TASK_ILLEGAL_TRANSITION',
  'AI_TASK_TERMINAL_STATE',
  'AI_TASK_RETRY_NOT_ALLOWED',
  'AI_TASK_CONCURRENT_UPDATE',
  'AI_TASK_NOT_FOUND',
  'AI_ATTEMPT_NOT_FOUND',
  'AI_RESPONSE_METADATA_INVALID',
  'AI_PROVIDER_TIMEOUT',
  'AI_PROVIDER_CANCELLED',
  'AI_PROVIDER_AUTHENTICATION_FAILED',
  'AI_PROVIDER_REQUEST_REJECTED',
  'AI_PROVIDER_RATE_LIMITED',
  'AI_PROVIDER_SERVER_ERROR',
  'AI_PROVIDER_NETWORK_ERROR',
  'AI_PROVIDER_MALFORMED_RESPONSE',
  'AI_CONTEXT_BUILD_FAILED',
  'AI_COMPILATION_INPUT_INVALID',
  'AI_CONTEXT_SOURCE_REQUIRED',
  'AI_CONTEXT_BUDGET_EXCEEDED',
  'AI_CONTEXT_SOURCE_DRIFT',
  'AI_CONSTRAINT_POLICY_INVALID',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_TYPE_UNSUPPORTED',
  'ARTIFACT_SOURCE_MISMATCH',
  'ARTIFACT_PARSE_FAILED',
  'ARTIFACT_VALIDATION_FAILED',
  'ARTIFACT_IMMUTABLE',
  'PLACEMENT_NOT_SUPPORTED',
  'PLACEMENT_PROPOSAL_INVALID',
  'PLACEMENT_PLAN_INVALID',
  'PLACEMENT_TARGET_CONFLICT',
  'PLACEMENT_TARGET_CHANGED',
  'WORKSPACE_LEAVE_CANCELLED',
  'WORKSPACE_SAVE_FAILED',
  'WINDOW_CLOSE_BLOCKED',
] as const;

export type AppErrorCode = typeof APP_ERROR_CODES[number] | 'UNKNOWN_ERROR';

/** Serializable error contract shared with Tauri commands. */
export interface AppError {
  code: AppErrorCode | string;
  message: string;
  retryable: boolean;
  traceId?: string;
  operationId?: string;
  details?: Record<string, unknown>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function unwrapError(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === 'string') return unwrapError(tryParseJson(value), depth + 1);
  if (!isRecord(value)) return value;
  if (typeof value.code === 'string') return value;
  for (const key of ['rawError', 'error', 'cause']) {
    if (value[key] !== undefined) {
      const nested = unwrapError(value[key], depth + 1);
      if (isRecord(nested) && typeof nested.code === 'string') return nested;
    }
  }
  return value;
}

export function isAppError(value: unknown): value is AppError {
  const unwrapped = unwrapError(value);
  return isRecord(unwrapped)
    && typeof unwrapped.code === 'string'
    && typeof unwrapped.message === 'string'
    && typeof unwrapped.retryable === 'boolean';
}

export function normalizeAppError(
  value: unknown,
  fallbackMessage = '操作失败，请稍后重试。',
  context: Partial<Pick<AppError, 'traceId' | 'operationId'>> = {},
): AppError {
  const unwrapped = unwrapError(value);
  if (isRecord(unwrapped) && typeof unwrapped.code === 'string') {
    const details = isRecord(unwrapped.details) ? unwrapped.details : undefined;
    return {
      code: unwrapped.code,
      message: typeof unwrapped.message === 'string' && unwrapped.message.trim()
        ? unwrapped.message
        : fallbackMessage,
      retryable: unwrapped.retryable === true,
      traceId: typeof unwrapped.traceId === 'string'
        ? unwrapped.traceId
        : typeof unwrapped.trace_id === 'string'
          ? unwrapped.trace_id
          : context.traceId,
      operationId: typeof unwrapped.operationId === 'string'
        ? unwrapped.operationId
        : typeof unwrapped.operation_id === 'string'
          ? unwrapped.operation_id
          : context.operationId,
      details,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: value instanceof Error && value.message.trim() ? value.message : fallbackMessage,
    retryable: false,
    ...context,
  };
}

const USER_MESSAGES: Partial<Record<AppErrorCode, string>> = {
  DOCUMENT_VERSION_CONFLICT: '正文版本已变化，请重新读取后再保存。',
  DOCUMENT_HASH_MISMATCH: '正文内容校验失败，已阻止覆盖。',
  TARGET_NOVEL_NOT_FOUND: '目标作品不存在。',
  TARGET_CHAPTER_NOT_FOUND: '目标章节不存在。',
  TARGET_CHAPTER_DELETED: '目标章节已经删除。',
  TARGET_DRAFT_NOT_FOUND: '目标草稿不存在。',
  DRAFT_UPDATE_ZERO_ROWS: '草稿未能更新，请重新读取后重试。',
  LARGE_TEXT_HASH_MISMATCH: '长正文完整性校验失败。',
  LARGE_TEXT_CHUNK_MISSING: '长正文分片不完整。',
  LARGE_TEXT_CONTENT_UNAVAILABLE: '完整正文暂时无法读取。',
  LARGE_TEXT_REFERENCE_INVALID: '正文存储引用无效。',
  RECOVERY_SNAPSHOT_NOT_FOUND: '未找到恢复快照。',
  RECOVERY_BASE_CONFLICT: '恢复内容基于旧版正文，不能直接覆盖。',
  RECOVERY_CONTENT_INVALID: '恢复内容校验失败。',
  DATABASE_BUSY: '数据库正忙，请稍后重试。',
  DATABASE_TRANSACTION_FAILED: '数据库事务失败，修改未保存。',
  DATABASE_COMMIT_UNKNOWN: '无法确认保存结果，请先重新读取，避免重复提交。',
  OPERATION_ALREADY_COMPLETED: '该操作已经成功完成。',
  OPERATION_IN_PROGRESS: '该操作正在执行，请稍候。',
  OPERATION_PAYLOAD_CONFLICT: '重复操作的内容不一致，已阻止提交。',
  OPERATION_REPLAY_TARGET_INVALID: '原保存结果已不存在或发生变化，已阻止陈旧重放。',
  AI_TASK_INPUT_INVALID: 'AI 任务输入无效，未创建执行记录。',
  AI_TASK_SECRET_DETECTED: 'AI 任务数据包含疑似凭据，已拒绝持久化。',
  AI_TASK_TYPE_UNSUPPORTED: '当前版本不支持该 AI 任务类型。',
  AI_TASK_ILLEGAL_TRANSITION: 'AI 任务当前状态不允许该操作。',
  AI_TASK_TERMINAL_STATE: 'AI 任务已经结束，不能继续修改。',
  AI_TASK_RETRY_NOT_ALLOWED: '该失败不能直接重试，请重新发起任务。',
  AI_TASK_CONCURRENT_UPDATE: 'AI 任务正在由另一执行流程处理。',
  AI_TASK_NOT_FOUND: 'AI 任务不存在。',
  AI_ATTEMPT_NOT_FOUND: 'AI 执行记录不存在。',
  AI_RESPONSE_METADATA_INVALID: 'AI 响应身份信息无效，原始结果未采用。',
  AI_PROVIDER_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
  AI_PROVIDER_CANCELLED: 'AI 请求已取消。',
  AI_PROVIDER_AUTHENTICATION_FAILED: 'AI 服务身份验证或模型权限校验失败。',
  AI_PROVIDER_REQUEST_REJECTED: 'AI 服务拒绝了当前请求参数。',
  AI_PROVIDER_RATE_LIMITED: 'AI 服务请求过于频繁，请稍后重试。',
  AI_PROVIDER_SERVER_ERROR: 'AI 服务暂时不可用。',
  AI_PROVIDER_NETWORK_ERROR: 'AI 服务网络连接失败。',
  AI_PROVIDER_MALFORMED_RESPONSE: 'AI 服务返回格式无效。',
  AI_CONTEXT_BUILD_FAILED: 'AI 上下文构建失败。',
  AI_COMPILATION_INPUT_INVALID: 'AI 编译契约无效，任务未执行。',
  AI_CONTEXT_SOURCE_REQUIRED: '缺少任务必需的上下文来源。',
  AI_CONTEXT_BUDGET_EXCEEDED: '上下文超过当前任务预算。',
  AI_CONTEXT_SOURCE_DRIFT: '上下文来源已经变化，请重新编译任务。',
  AI_CONSTRAINT_POLICY_INVALID: 'AI 约束或工具策略无效。',
  ARTIFACT_NOT_FOUND: 'AI 结果不存在。',
  ARTIFACT_TYPE_UNSUPPORTED: '当前版本不支持该 AI 结果类型。',
  ARTIFACT_SOURCE_MISMATCH: 'AI 结果与任务来源不一致，已拒绝保存。',
  ARTIFACT_PARSE_FAILED: 'AI 结果解析失败，原始结果已保留。',
  ARTIFACT_VALIDATION_FAILED: 'AI 结果未通过校验。',
  ARTIFACT_IMMUTABLE: 'AI 结果不可原地修改。',
  PLACEMENT_NOT_SUPPORTED: '当前 AI 结果不支持安全应用。',
  PLACEMENT_PROPOSAL_INVALID: 'AI 结果的应用提案无效。',
  PLACEMENT_PLAN_INVALID: 'AI 结果的应用计划无效。',
  PLACEMENT_TARGET_CONFLICT: '目标已经存在或发生变化，已阻止覆盖。',
  PLACEMENT_TARGET_CHANGED: '已应用目标发生变化，不能重放旧结果。',
  WORKSPACE_LEAVE_CANCELLED: '已取消离开工作区。',
  WORKSPACE_SAVE_FAILED: '正文保存失败，已留在当前工作区。',
  WINDOW_CLOSE_BLOCKED: '窗口关闭已取消。',
};

export function getAppErrorUserMessage(error: AppError): string {
  return USER_MESSAGES[error.code as AppErrorCode] ?? error.message ?? '操作失败，请稍后重试。';
}
