import type { AppError } from './appError';

export type DraftContentState =
  | {
      status: 'ready';
      content: string;
      contentHash: string;
      contentLength: number;
    }
  | {
      status: 'unavailable';
      preview?: string;
      errorCode: string;
      retryable: boolean;
      expectedHash?: string;
      actualHash?: string;
      error?: AppError;
    };

export function isDraftContentReady(
  state: DraftContentState | null | undefined,
): state is Extract<DraftContentState, { status: 'ready' }> {
  return state?.status === 'ready';
}
