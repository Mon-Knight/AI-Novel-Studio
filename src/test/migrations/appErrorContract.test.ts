import { describe, expect, it } from 'vitest';

import { normalizeAppError } from '../../types/appError';

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
});
