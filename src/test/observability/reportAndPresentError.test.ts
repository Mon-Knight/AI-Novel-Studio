import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appLogger } from '../../services/observability/appLogger';
import { reportAndPresentError, reportAppError } from '../../utils/reportAndPresentError';
import * as nativeDialog from '../../utils/nativeDialog';

describe('business error reporting and presentation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('records unknown failures without exposing their raw message to the UI', () => {
    const before = appLogger.getEntries().length;
    const error = reportAppError({
      event: 'TEST_OPERATION_FAILED',
      error: new Error('provider raw response and secret detail'),
      fallbackMessage: '操作失败，请重试。',
      context: { operationId: 'operation-1' },
    });

    expect(error).toEqual(
      expect.objectContaining({ code: 'UNKNOWN_ERROR', message: '操作失败，请重试。' }),
    );
    expect(appLogger.getEntries()).toHaveLength(before + 1);
    const entries = appLogger.getEntries();
    expect(JSON.stringify(entries[entries.length - 1])).not.toContain('secret detail');
  });

  it('presents the same normalized business error that enters diagnostics', async () => {
    const showError = vi.spyOn(nativeDialog, 'showError').mockResolvedValue();
    const error = await reportAndPresentError({
      event: 'TEST_DATABASE_BUSY',
      error: { code: 'DATABASE_BUSY', message: 'internal', retryable: true },
      fallbackMessage: '加载失败。',
      title: '加载失败',
      testId: 'load-error',
    });

    expect(error.code).toBe('DATABASE_BUSY');
    expect(showError).toHaveBeenCalledWith({
      title: '加载失败',
      message: '数据库正忙，请稍后重试。',
      testId: 'load-error',
    });
  });
});
