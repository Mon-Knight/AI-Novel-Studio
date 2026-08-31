const CLOSED_WORKBENCH_WINDOW_PATTERN =
  /no such window|target window already closed|web view not found/i;

const LIVE_CONDITION_DEADLINE_REACHED = Symbol('live-condition-deadline-reached');

const CLOSED_WEBDRIVER_SESSION_PATTERNS = [
  /invalid session(?: id)?/i,
  /(?:browser connection|connection to (?:the )?browser) (?:is |was |has been )?closed/i,
  /(?:browser|webdriver) session (?:is |was |has been )?(?:closed|deleted)/i,
  /session deleted because of page crash/i,
  /disconnected: not connected to devtools/i,
] as const;

export interface LiveConditionOptions {
  timeout: number;
  interval: number;
  timeoutMessage: string;
}

export async function readSequentialLiveConditionSnapshot<TFirst, TSecond>(
  readFirst: () => Promise<TFirst>,
  readSecond: () => Promise<TSecond>,
): Promise<readonly [TFirst, TSecond]> {
  const first = await readFirst();
  const second = await readSecond();
  return [first, second] as const;
}

export function isClosedWebDriverSessionError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CLOSED_WEBDRIVER_SESSION_PATTERNS.some((pattern) => pattern.test(message));
}

export async function waitForLiveCondition(
  condition: () => Promise<boolean>,
  options: LiveConditionOptions,
): Promise<void> {
  const deadline = Date.now() + options.timeout;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await runConditionBeforeDeadline(condition, remaining);
      if (result === LIVE_CONDITION_DEADLINE_REACHED) break;
      if (result) return;
      lastError = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isClosedWebDriverSessionError(error)) {
        throw new Error(`The WebDriver session closed during the real-model run: ${message}`, {
          cause: error,
        });
      }
      if (CLOSED_WORKBENCH_WINDOW_PATTERN.test(message)) {
        throw new Error(
          `The desktop workbench window closed during the real-model run: ${message}`,
          { cause: error },
        );
      }
      lastError = message;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.interval, remaining)));
  }
  throw new Error(
    lastError ? `${options.timeoutMessage} Last error: ${lastError}` : options.timeoutMessage,
  );
}

async function runConditionBeforeDeadline(
  condition: () => Promise<boolean>,
  remaining: number,
): Promise<boolean | typeof LIVE_CONDITION_DEADLINE_REACHED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      condition(),
      new Promise<typeof LIVE_CONDITION_DEADLINE_REACHED>((resolve) => {
        timer = setTimeout(() => resolve(LIVE_CONDITION_DEADLINE_REACHED), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
