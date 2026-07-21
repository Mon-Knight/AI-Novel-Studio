export const AI_REQUEST_CANCELLED = 'AI_REQUEST_CANCELLED';

export class AiRequestCancelledError extends Error {
  readonly code = AI_REQUEST_CANCELLED;

  constructor(message = 'AI 请求已取消') {
    super(message);
    this.name = 'AiRequestCancelledError';
  }
}

function cancellationMarker(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const candidate = value as { code?: unknown; name?: unknown; message?: unknown };
  return [candidate.code, candidate.name, candidate.message]
    .filter((item): item is string => typeof item === 'string')
    .join(' ');
}

export function isAiRequestCancelled(error: unknown): boolean {
  return error instanceof AiRequestCancelledError
    || cancellationMarker(error).includes(AI_REQUEST_CANCELLED);
}

export function throwIfAiRequestCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AiRequestCancelledError();
}
