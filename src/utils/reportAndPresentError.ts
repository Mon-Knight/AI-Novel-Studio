import { appLogger } from '../services/observability/appLogger';
import { getAppErrorUserMessage, normalizeAppError, type AppError } from '../types/appError';
import { showError } from './nativeDialog';

export interface ReportAppErrorOptions {
  event: string;
  error: unknown;
  fallbackMessage: string;
  context?: Record<string, unknown>;
}

export interface PresentAppErrorOptions extends ReportAppErrorOptions {
  title?: string;
  testId?: string;
}

/** Normalizes one business failure, records a redacted diagnostic, and returns safe UI text. */
export function reportAppError(options: ReportAppErrorOptions): AppError {
  const normalized = normalizeAppError(options.error, options.fallbackMessage);
  const safeError =
    normalized.code === 'UNKNOWN_ERROR'
      ? { ...normalized, message: options.fallbackMessage }
      : normalized;
  appLogger.captureError(options.event, safeError, options.context);
  return safeError;
}

/** Uses the same normalized fact for diagnostics and the user-visible desktop error dialog. */
export async function reportAndPresentError(options: PresentAppErrorOptions): Promise<AppError> {
  const error = reportAppError(options);
  await showError({
    title: options.title,
    message: getAppErrorUserMessage(error),
    testId: options.testId,
  });
  return error;
}
