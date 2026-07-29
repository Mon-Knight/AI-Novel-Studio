export type AiCompilationErrorCode =
  | 'AI_COMPILATION_INPUT_INVALID'
  | 'AI_CONTEXT_SOURCE_REQUIRED'
  | 'AI_CONTEXT_BUDGET_EXCEEDED'
  | 'AI_CONTEXT_SOURCE_DRIFT'
  | 'AI_CONSTRAINT_POLICY_INVALID';

export class AiCompilationError extends Error {
  readonly code: AiCompilationErrorCode;
  readonly retryable = false;
  readonly details?: Record<string, unknown>;

  constructor(code: AiCompilationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AiCompilationError';
    this.code = code;
    this.details = details;
  }
}
