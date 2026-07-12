import { describe, expect, it } from 'vitest';

import { normalizeAppError } from '../../types/appError';
import { describeUnknownError } from '../../utils/errorMessage';

describe('structured AppError contract', () => {
  it('preserves the serialized Tauri error code and trace identities', () => {
    const error = normalizeAppError({
      code: 'DATABASE_TRANSACTION_FAILED',
      message: 'transaction failed',
      retryable: true,
      traceId: 'trace-1',
      operationId: 'operation-1',
      details: { stage: 'commit' },
    });

    expect(error).toEqual({
      code: 'DATABASE_TRANSACTION_FAILED',
      message: 'transaction failed',
      retryable: true,
      traceId: 'trace-1',
      operationId: 'operation-1',
      details: { stage: 'commit' },
    });
  });

  it('renders structured unknown errors without falling back to object stringification', () => {
    expect(describeUnknownError({
      code: 'AI_PROVIDER_SERVER_ERROR',
      message: 'AI Provider 调用失败',
      retryable: false,
    })).toBe('AI Provider 调用失败');
  });
});
