import type { ToolResult } from '../../../types/toolRegistry';
import { computeContentSha256 } from '../../../utils/contentIntegrity';
import type { DomainError, DomainRequest, DomainResult, DomainStorageMode } from './domainTypes';

function sourceFrom(value: unknown): {
  source: DomainResult<unknown>['source'];
  storageMode: DomainStorageMode;
} {
  if (value === 'localstorage') return { source: 'localstorage', storageMode: 'browser_fallback' };
  if (value === 'database' || value === 'sqlite')
    return { source: 'sqlite', storageMode: 'sqlite' };
  if (value === 'artifact') return { source: 'artifact', storageMode: 'artifact' };
  return { source: 'runtime', storageMode: 'runtime' };
}

function classifyMessage(message: string): DomainError['code'] {
  if (/缺少|必须提供|不能为空|需要作品|需要章节|scope|范围/i.test(message)) {
    return 'INVALID_SCOPE';
  }
  if (/不属于|不匹配|跨作品|归属/i.test(message)) return 'SCOPE_MISMATCH';
  if (/不存在|未找到|not found/i.test(message)) return 'NOT_FOUND';
  if (/授权|确认/i.test(message)) return 'CONFIRMATION_REQUIRED';
  if (/冲突|版本|CAS|漂移/i.test(message)) return 'CONFLICT';
  return 'UPSTREAM_FAILURE';
}

export function failure<T = never>(
  code: DomainError['code'],
  message: string,
  source: DomainResult<unknown>['source'] = 'runtime',
  storageMode: DomainStorageMode = source === 'sqlite'
    ? 'sqlite'
    : source === 'localstorage'
      ? 'browser_fallback'
      : source === 'artifact'
        ? 'artifact'
        : 'runtime',
  warnings: string[] = [],
): DomainResult<T> {
  return {
    ok: false,
    error: { code, message, retryable: code === 'UPSTREAM_FAILURE' || code === 'CONFLICT' },
    source,
    storageMode,
    warnings,
  };
}

export function success<T>(
  data: T,
  options: {
    source: DomainResult<unknown>['source'];
    storageMode: DomainStorageMode;
    warnings?: string[];
    revision?: string | null;
    contentHash?: string;
  },
): DomainResult<T> {
  return {
    ok: true,
    data,
    source: options.source,
    storageMode: options.storageMode,
    warnings: options.warnings ?? [],
    revision: options.revision,
    contentHash: options.contentHash,
  };
}

export function validateNovelId(request: Partial<DomainRequest>): DomainResult<never> | undefined {
  if (typeof request.novelId !== 'string' || !request.novelId.trim()) {
    return failure('INVALID_SCOPE', '领域能力需要明确的 novelId。');
  }
  return undefined;
}

export function validateChapterScope(
  request: Partial<DomainRequest>,
): DomainResult<never> | undefined {
  const novelError = validateNovelId(request);
  if (novelError) return novelError;
  if (typeof request.chapterId !== 'string' || !request.chapterId.trim()) {
    return failure('INVALID_SCOPE', '该领域能力需要明确的 chapterId。');
  }
  return undefined;
}

export function validateConversationScope(
  request: Partial<DomainRequest>,
): DomainResult<never> | undefined {
  const novelError = validateNovelId(request);
  if (novelError) return novelError;
  if (typeof request.conversationId !== 'string' || !request.conversationId.trim()) {
    return failure('INVALID_SCOPE', '该领域能力需要明确的 conversationId。');
  }
  return undefined;
}

export function validateNonEmpty(value: unknown, field: string): DomainResult<never> | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return failure('INVALID_ARGUMENT', `${field} 不能为空。`);
  }
  return undefined;
}

export function fromToolResult<T>(result: ToolResult, map: (data: unknown) => T): DomainResult<T> {
  const sourceInfo = sourceFrom(result.source);
  if (!result.ok) {
    const message = result.error || '生产能力执行失败。';
    return failure(
      classifyMessage(message),
      message,
      sourceInfo.source,
      sourceInfo.storageMode,
      result.warnings ?? [],
    );
  }
  try {
    const data = map(result.data);
    return success(data, {
      ...sourceInfo,
      warnings: result.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure('INTEGRITY_ERROR', message, sourceInfo.source, sourceInfo.storageMode);
  }
}

export async function hashPublicValue(value: unknown): Promise<string> {
  return computeContentSha256(JSON.stringify(value));
}

export function mapUnknownError(
  error: unknown,
  source: DomainResult<unknown>['source'] = 'runtime',
) {
  const message = error instanceof Error ? error.message : String(error);
  return failure(classifyMessage(message), message, source);
}
