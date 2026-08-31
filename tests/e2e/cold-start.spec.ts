import fs from 'node:fs';
import path from 'node:path';
import { browser, expect } from '@wdio/globals';
import { assertCleanDiagnostics, waitForTestId } from './helpers';

interface WindowTiming {
  schemaVersion: number;
  processId?: number;
  watcherStartedEpochMs?: number;
  processCreatedEpochMs?: number;
  processObservedEpochMs?: number;
  windowVisibleEpochMs?: number;
  processToWindowVisibleMs?: number;
  pollIntervalMs: number;
  timeoutMs: number;
  error?: string;
}

interface NativeTiming {
  databaseReadyMs: number;
  tauriSetupReadyMs: number;
  stages: Array<{
    scope: string;
    stage: string;
    phaseMs: number;
    totalMs: number;
  }>;
}

const PROCESS_TO_WORKBENCH_BUDGET_MS = 8_000;
const HTML_TO_REACT_SHELL_BUDGET_MS = 2_500;
const SHELL_TO_WORKBENCH_BUDGET_MS = 1_500;
const WORKBENCH_CONTENT_BUDGET_MS = 4_000;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the cold-start fixture`);
  return value;
}

function parseNativeTiming(log: string): NativeTiming {
  const requiredElapsed = (label: string): number => {
    const match = log.match(new RegExp(`startup: ${label} elapsed_ms=(\\d+)`));
    if (!match) throw new Error(`Native startup log is missing ${label}`);
    return Number(match[1]);
  };
  const stages = Array.from(
    log.matchAll(/startup-timing: scope=([^ ]+) stage=([^ ]+) phase_ms=(\d+) total_ms=(\d+)/g),
    (match) => ({
      scope: match[1],
      stage: match[2],
      phaseMs: Number(match[3]),
      totalMs: Number(match[4]),
    }),
  );
  return {
    databaseReadyMs: requiredElapsed('database initialized'),
    tauriSetupReadyMs: requiredElapsed('tauri setup ready'),
    stages,
  };
}

describe('desktop cold start', () => {
  it('shows a stable shell before the real workbench becomes ready', async () => {
    const dataDirectory = requiredEnvironment('AI_NOVEL_STUDIO_E2E_DATA_DIR');
    const artifactDirectory = requiredEnvironment('AI_NOVEL_STUDIO_E2E_ARTIFACTS');
    const windowTimingPath = path.join(dataDirectory, 'startup-window-timing.json');
    const nativeLogPath = path.join(dataDirectory, 'e2e-rust.log');

    await waitForTestId('workbench-no-projects');
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const requiredMarks = [
            'app-html-start',
            'app-script-start',
            'react-shell-ready',
            'startup-splash-removed',
            'creative-workbench-visible',
            'workbench-content-ready',
          ];
          return (
            requiredMarks.every((name) => performance.getEntriesByName(name).length > 0) &&
            !document.getElementById('startup-splash') &&
            Boolean(
              document.querySelector('[data-testid="creative-workbench"]:not([aria-busy="true"])'),
            )
          );
        }),
      { timeout: 30_000, timeoutMsg: 'The real workbench startup milestones were incomplete' },
    );
    await browser.waitUntil(
      async () =>
        fs.existsSync(windowTimingPath) &&
        fs.existsSync(nativeLogPath) &&
        fs.readFileSync(nativeLogPath, 'utf8').includes('startup: tauri setup ready elapsed_ms='),
      { timeout: 30_000, timeoutMsg: 'Native startup timing evidence was incomplete' },
    );

    const frontend = await browser.execute(() => {
      const latestMark = (name: string): number | null => {
        const entries = performance.getEntriesByName(name);
        return entries.length > 0 ? entries[entries.length - 1].startTime : null;
      };
      const navigation = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      const firstContentfulPaint = performance
        .getEntriesByType('paint')
        .find((entry) => entry.name === 'first-contentful-paint');
      return {
        timeOriginEpochMs: performance.timeOrigin,
        htmlStartMs: latestMark('app-html-start'),
        scriptStartMs: latestMark('app-script-start'),
        reactShellReadyMs: latestMark('react-shell-ready'),
        splashHideRequestedMs: latestMark('startup-splash-hide-requested'),
        splashRemovedMs: latestMark('startup-splash-removed'),
        fallbackVisibleMs: latestMark('workbench-route-fallback-visible'),
        workbenchVisibleMs: latestMark('creative-workbench-visible'),
        workbenchContentReadyMs: latestMark('workbench-content-ready'),
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
        loadEventEndMs: navigation?.loadEventEnd ?? null,
        firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
        observedAtMs: performance.now(),
        splashPresent: Boolean(document.getElementById('startup-splash')),
        realWorkbenchPresent: Boolean(
          document.querySelector('[data-testid="creative-workbench"]:not([aria-busy="true"])'),
        ),
      };
    });
    const windowTiming = JSON.parse(fs.readFileSync(windowTimingPath, 'utf8')) as WindowTiming;
    const native = parseNativeTiming(fs.readFileSync(nativeLogPath, 'utf8'));

    expect(windowTiming.error).toBeUndefined();
    expect(windowTiming.processToWindowVisibleMs).toBeGreaterThanOrEqual(0);
    expect(windowTiming.processToWindowVisibleMs).toBeLessThan(PROCESS_TO_WORKBENCH_BUDGET_MS);
    expect(native.databaseReadyMs).toBeGreaterThanOrEqual(0);
    expect(native.tauriSetupReadyMs).toBeGreaterThanOrEqual(native.databaseReadyMs);
    expect(native.tauriSetupReadyMs).toBeLessThan(PROCESS_TO_WORKBENCH_BUDGET_MS);
    expect(native.stages.length).toBeGreaterThanOrEqual(10);

    const requiredFrontendValues = [
      frontend.htmlStartMs,
      frontend.scriptStartMs,
      frontend.reactShellReadyMs,
      frontend.splashHideRequestedMs,
      frontend.splashRemovedMs,
      frontend.workbenchVisibleMs,
      frontend.workbenchContentReadyMs,
    ];
    expect(requiredFrontendValues.every((value) => typeof value === 'number')).toBe(true);
    const htmlStartMs = frontend.htmlStartMs as number;
    const scriptStartMs = frontend.scriptStartMs as number;
    const reactShellReadyMs = frontend.reactShellReadyMs as number;
    const splashRemovedMs = frontend.splashRemovedMs as number;
    const workbenchVisibleMs = frontend.workbenchVisibleMs as number;
    const workbenchContentReadyMs = frontend.workbenchContentReadyMs as number;
    expect(scriptStartMs).toBeGreaterThanOrEqual(htmlStartMs);
    expect(reactShellReadyMs).toBeGreaterThanOrEqual(scriptStartMs);
    expect(splashRemovedMs).toBeGreaterThanOrEqual(reactShellReadyMs);
    expect(workbenchVisibleMs).toBeGreaterThanOrEqual(reactShellReadyMs);
    expect(workbenchContentReadyMs).toBeGreaterThanOrEqual(workbenchVisibleMs);
    expect(workbenchContentReadyMs - htmlStartMs).toBeLessThan(PROCESS_TO_WORKBENCH_BUDGET_MS);
    expect(frontend.splashPresent).toBe(false);
    expect(frontend.realWorkbenchPresent).toBe(true);

    const processCreatedEpochMs = windowTiming.processCreatedEpochMs as number;
    const processToWorkbenchContentReadyMs =
      frontend.timeOriginEpochMs + workbenchContentReadyMs - processCreatedEpochMs;
    const htmlToReactShellReadyMs = reactShellReadyMs - htmlStartMs;
    const shellToWorkbenchVisibleMs = workbenchVisibleMs - reactShellReadyMs;
    const workbenchToContentReadyMs = workbenchContentReadyMs - workbenchVisibleMs;
    expect(processToWorkbenchContentReadyMs).toBeLessThan(PROCESS_TO_WORKBENCH_BUDGET_MS);
    expect(htmlToReactShellReadyMs).toBeLessThan(HTML_TO_REACT_SHELL_BUDGET_MS);
    expect(shellToWorkbenchVisibleMs).toBeLessThan(SHELL_TO_WORKBENCH_BUDGET_MS);
    expect(workbenchToContentReadyMs).toBeLessThan(WORKBENCH_CONTENT_BUDGET_MS);

    const evidence = {
      schemaVersion: 1,
      coldDefinition:
        'fresh isolated SQLite database and WebView2 profile; operating-system file cache is not reset',
      window: windowTiming,
      native,
      frontend,
      durations: {
        processToHtmlStartMs: frontend.timeOriginEpochMs + htmlStartMs - processCreatedEpochMs,
        processToReactShellReadyMs:
          frontend.timeOriginEpochMs + reactShellReadyMs - processCreatedEpochMs,
        processToSplashRemovedMs:
          frontend.timeOriginEpochMs + splashRemovedMs - processCreatedEpochMs,
        processToWorkbenchVisibleMs:
          frontend.timeOriginEpochMs + workbenchVisibleMs - processCreatedEpochMs,
        processToWorkbenchContentReadyMs,
        htmlToReactShellReadyMs,
        shellToWorkbenchVisibleMs,
        workbenchToContentReadyMs,
      },
      budgets: {
        processToWorkbenchMs: PROCESS_TO_WORKBENCH_BUDGET_MS,
        htmlToReactShellMs: HTML_TO_REACT_SHELL_BUDGET_MS,
        shellToWorkbenchMs: SHELL_TO_WORKBENCH_BUDGET_MS,
        workbenchContentMs: WORKBENCH_CONTENT_BUDGET_MS,
      },
      finalState: {
        splashPresent: frontend.splashPresent,
        realWorkbenchPresent: frontend.realWorkbenchPresent,
      },
    };
    fs.writeFileSync(
      path.join(artifactDirectory, 'startup-timing.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    );
    await assertCleanDiagnostics();
  });
});
