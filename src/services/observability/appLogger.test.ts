import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appLogger, localErrorReportStorageKey, sanitizeDiagnosticValue } from './appLogger';

describe('appLogger', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  it('redacts nested credentials and user text while preserving safe identity metadata', () => {
    expect(
      sanitizeDiagnosticValue({
        apiKey: 'secret',
        prompt: 'private manuscript',
        nested: { authorization: 'Bearer abc', chapterId: 'chapter-1', tokensUsed: 42 },
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      prompt: '[REDACTED]',
      nested: { authorization: '[REDACTED]', chapterId: 'chapter-1', tokensUsed: 42 },
    });
  });

  it('normalizes and persists a bounded safe error report', () => {
    const error = appLogger.captureError('SAVE_FAILED', new Error('disk busy'), {
      traceId: 'trace-1',
      content: 'chapter manuscript',
    });
    expect(error.message).toBe('disk busy');
    const reports = appLogger.getLocalErrorReports();
    const latestReport = reports[reports.length - 1];
    expect(latestReport?.event).toBe('SAVE_FAILED');
    expect(latestReport?.details).toEqual([
      expect.objectContaining({ traceId: 'trace-1', content: '[REDACTED]' }),
    ]);
    expect(localStorage.getItem(localErrorReportStorageKey)).not.toContain('chapter manuscript');
  });
});
