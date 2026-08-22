import { browser, expect } from '@wdio/globals';

export interface Diagnostics {
  enabled?: boolean;
  dataDir?: string;
  databasePath?: string;
  networkBlocked?: boolean;
  integrityCheck?: string;
  foreignKeysEnabled?: boolean;
  journalMode?: string;
  schemaReady?: boolean;
  migrationCount?: number;
  latestMigrationId?: string;
  counts?: Record<string, number>;
  webviewNetwork?: {
    installed?: boolean;
    total?: number;
    byTransport?: Record<string, number>;
  };
}

export interface MockAiGateState {
  paused: boolean;
  waitingRequests: number;
  requestCount: number;
}

export type MockGateMethod =
  'getMockAiGateState' | 'pauseMockAi' | 'advanceMockAi' | 'releaseMockAi';

interface BridgeShape {
  invoke: (command: string, args?: Record<string, unknown>) => unknown;
  getDiagnostics?: () => unknown;
  getConsoleLogs?: () => unknown;
  getUnhandledErrors?: () => unknown;
  getNetworkAttempts?: () => unknown;
  clearDiagnostics?: () => unknown;
}

let fixtureSequence = 0;

export const unique = (prefix: string): string => `${prefix}-${++fixtureSequence}`;

export async function callMockGate(method: MockGateMethod): Promise<MockAiGateState> {
  return browser.execute((methodName) => {
    type GateBridge = Partial<Record<MockGateMethod, () => MockAiGateState>>;
    const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: GateBridge })
      .__AI_NOVEL_STUDIO_E2E__;
    const operation = bridge?.[methodName];
    if (!operation) throw new Error(`E2E Mock AI bridge method is unavailable: ${methodName}`);
    return operation();
  }, method);
}

export async function bridgeCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const response = await browser.executeAsync(
    (name, input, done) => {
      const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: BridgeShape })
        .__AI_NOVEL_STUDIO_E2E__;
      if (!bridge?.invoke)
        return done({ ok: false, error: 'window.__AI_NOVEL_STUDIO_E2E__.invoke is unavailable' });
      let settled = false;
      const finish = (value: { ok: boolean; value?: unknown; error?: string }) => {
        if (settled) return;
        settled = true;
        done(value);
      };
      const timer = window.setTimeout(
        () => finish({ ok: false, error: `timeout invoking ${name}` }),
        15000,
      );
      Promise.resolve(bridge.invoke(name, input))
        .then((value) => {
          window.clearTimeout(timer);
          finish({ ok: true, value });
        })
        .catch((error) => {
          window.clearTimeout(timer);
          finish({ ok: false, error: String(error) });
        });
    },
    command,
    args ?? {},
  );
  const result = response as { ok: boolean; value?: T; error?: string };
  if (!result.ok)
    throw new Error(`E2E bridge invoke ${command} failed: ${result.error ?? 'unknown error'}`);
  return result.value as T;
}

export async function bridgeDiagnostics(): Promise<Diagnostics> {
  const result = await browser.executeAsync((done) => {
    const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: BridgeShape })
      .__AI_NOVEL_STUDIO_E2E__;
    if (!bridge?.getDiagnostics)
      return done({ ok: false, error: 'E2E diagnostics bridge is unavailable' });
    let settled = false;
    const finish = (value: { ok: boolean; value?: unknown; error?: string }) => {
      if (settled) return;
      settled = true;
      done(value);
    };
    const timer = window.setTimeout(
      () => finish({ ok: false, error: 'timeout invoking get_e2e_diagnostics' }),
      15000,
    );
    Promise.resolve(bridge.getDiagnostics())
      .then((value) => {
        window.clearTimeout(timer);
        finish({ ok: true, value });
      })
      .catch((error) => {
        window.clearTimeout(timer);
        finish({ ok: false, error: String(error) });
      });
  });
  const response = result as { ok: boolean; value?: Diagnostics; error?: string };
  if (!response.ok) throw new Error(response.error ?? 'E2E diagnostics unavailable');
  return response.value ?? {};
}

export async function bridgeClearDiagnostics(): Promise<void> {
  await browser.execute(() => {
    const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: BridgeShape })
      .__AI_NOVEL_STUDIO_E2E__;
    bridge?.clearDiagnostics?.();
  });
}

export async function assertCleanDiagnostics(): Promise<void> {
  const diagnostics = await bridgeDiagnostics();
  expect(diagnostics.enabled).toBe(true);
  expect(diagnostics.schemaReady).toBe(true);
  expect(diagnostics.foreignKeysEnabled).toBe(true);
  expect(diagnostics.integrityCheck).toBe('ok');
  expect(diagnostics.networkBlocked).toBe(true);
  expect(diagnostics.webviewNetwork?.installed).toBe(true);
  expect(diagnostics.webviewNetwork?.total).toBe(0);
  const frontEndResult = await browser.executeAsync((timeoutMs, done) => {
    const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: BridgeShape })
      .__AI_NOVEL_STUDIO_E2E__;
    if (!bridge?.getUnhandledErrors || !bridge.getConsoleLogs) {
      return done({ ok: false, error: 'Front-end diagnostics bridge is unavailable' });
    }
    let settled = false;
    const finish = (value: { ok: boolean; value?: unknown; error?: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      done(value);
    };
    const timer = window.setTimeout(
      () =>
        finish({ ok: false, error: `timeout reading front-end diagnostics after ${timeoutMs}ms` }),
      timeoutMs,
    );
    Promise.all([
      Promise.resolve(bridge.getUnhandledErrors()),
      Promise.resolve(bridge.getConsoleLogs()),
    ])
      .then(([errors, logs]) =>
        finish({ ok: true, value: { errors: errors ?? [], logs: logs ?? [] } }),
      )
      .catch((error) => finish({ ok: false, error: String(error) }));
  }, 5000);
  const frontEnd = frontEndResult as {
    ok: boolean;
    value?: { errors?: unknown[]; logs?: Array<{ level?: string; message?: string }> };
    error?: string;
  };
  if (!frontEnd.ok) throw new Error(frontEnd.error ?? 'Front-end diagnostics unavailable');
  expect(frontEnd.value?.errors ?? []).toEqual([]);
  expect((frontEnd.value?.logs ?? []).filter((entry) => entry.level === 'error')).toEqual([]);
}

export async function waitForTestId(testId: string) {
  const findDisplayed = async () => {
    const elements = await browser.$$(`[data-testid="${testId}"]`);
    for (const element of elements) {
      if (await element.isDisplayed()) return element;
    }
    return undefined;
  };
  await browser.waitUntil(async () => Boolean(await findDisplayed()), {
    timeout: 30000,
    timeoutMsg: `${testId} was not displayed`,
  });
  const element = await findDisplayed();
  if (!element) throw new Error(`${testId} disappeared after becoming visible`);
  return element;
}

export async function waitForTestIdAttribute(
  testId: string,
  attribute: string,
  expected: string,
  timeout = 30000,
) {
  return findTestIdByAttribute(testId, attribute, expected, timeout);
}

export async function findTestIdByAttribute(
  testId: string,
  attribute: string,
  expected: string,
  timeout = 30000,
) {
  const find = async () => {
    const elements = await browser.$$(`[data-testid="${testId}"]`);
    for (const element of elements) {
      if ((await element.getAttribute(attribute)) === expected && (await element.isDisplayed()))
        return element;
    }
    return undefined;
  };
  await browser.waitUntil(async () => Boolean(await find()), {
    timeout,
    timeoutMsg: `${testId} with ${attribute}=${expected} was not displayed`,
  });
  const element = await find();
  if (!element) throw new Error(`${testId} with ${attribute}=${expected} disappeared`);
  return element;
}

export async function waitForTestIdMissing(testId: string, timeout = 30000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const elements = await browser.$$(`[data-testid="${testId}"]`);
      for (const element of elements) {
        if (await element.isDisplayed()) return false;
      }
      return true;
    },
    {
      timeout,
      timeoutMsg: `${testId} remained visible`,
    },
  );
}

export async function clickTestId(testId: string): Promise<void> {
  const element = await waitForTestId(testId);
  await element.waitForClickable({ timeout: 30000 });
  await element.click();
}

export async function fillTestId(testId: string, value: string): Promise<void> {
  const element = await waitForTestId(testId);
  await element.clearValue();
  await element.setValue(value);
}

export async function fillTextareaTestId(testId: string, value: string): Promise<string> {
  const canonicalValue = await browser.execute(
    (id, nextValue) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error(`${id} is not a textarea`);
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) throw new Error('HTMLTextAreaElement value setter is unavailable');
      setter.call(element, nextValue);
      element.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }),
      );
      return element.value;
    },
    testId,
    value,
  );

  await browser.waitUntil(
    async () => {
      const element = await browser.$(`[data-testid="${testId}"]`);
      return (
        (await element.getAttribute('data-dirty')) === 'true' &&
        (await element.getValue()).length === canonicalValue.length
      );
    },
    {
      timeout: 30000,
      timeoutMsg: `${testId} did not receive the complete textarea value`,
    },
  );
  return canonicalValue;
}

export async function createProjectThroughUi(title = unique('E2E Project')): Promise<string> {
  if ((await browser.execute(() => window.location.hash)) !== '#/novels') {
    await navigateHash('#/novels');
  }
  await waitForTestId('project-list');
  await clickTestId('project-create');
  await fillTestId('project-name-input', title);
  await clickTestId('project-save');
  await waitForTestId('project-settings');
  const settings = await browser.$('[data-testid="project-settings"]');
  const projectId = await settings.getAttribute('data-project-id');
  if (!projectId) throw new Error('Created project did not expose data-project-id');
  return projectId;
}

export async function navigateHash(route: string): Promise<void> {
  const expectedHash = route.startsWith('#')
    ? route
    : `#${route.startsWith('/') ? route : `/${route}`}`;
  await browser.execute((nextHash) => {
    window.location.hash = nextHash;
  }, expectedHash);
  await browser.waitUntil(
    async () => (await browser.execute(() => window.location.hash)) === expectedHash,
    {
      timeout: 30000,
      timeoutMsg: `HashRouter did not navigate to ${expectedHash}`,
    },
  );
}

export async function goHome(): Promise<void> {
  await navigateHash('#/novels');
  await waitForTestId('app-shell');
  await waitForTestId('project-list');
}

export async function openWorkspace(projectId: string): Promise<void> {
  await navigateHash(`#/novels/${projectId}/workspace`);
  await waitForTestId('app-shell');
  await waitForTestId('chapter-list');
}

export async function openProjectFromList(projectId: string): Promise<void> {
  const openTarget = await findTestIdByAttribute('project-open', 'data-project-id', projectId);
  await openTarget.waitForClickable({ timeout: 30000 });
  await openTarget.click();
  await waitForTestIdAttribute('project-settings', 'data-project-id', projectId);
  await browser.waitUntil(
    async () => (await browser.execute(() => window.location.hash)) === `#/novels/${projectId}`,
    {
      timeout: 30000,
      timeoutMsg: 'project detail route did not become active',
    },
  );
}

export async function createVolumeThroughUi(title = unique('E2E Volume')): Promise<string> {
  await clickTestId('volume-create');
  await fillTestId('volume-title-input', title);
  await clickTestId('volume-save');
  const volumeItem = await findTestIdByAttribute('volume-item', 'data-volume-title', title);
  const volumeId = await volumeItem.getAttribute('data-volume-id');
  if (!volumeId) throw new Error('Created volume did not expose data-volume-id');
  return volumeId;
}

export async function createChapterThroughUi(
  title = unique('Chapter'),
  volumeId?: string,
): Promise<string> {
  let targetVolumeId = volumeId;
  if (!targetVolumeId) {
    const volumeItem = await waitForTestId('volume-item');
    targetVolumeId = (await volumeItem.getAttribute('data-volume-id')) ?? undefined;
  }
  if (!targetVolumeId) throw new Error('Chapter creation requires an existing volume');

  await clickTestId('chapter-create');
  const volumeSelect = await waitForTestId('chapter-volume-select');
  await volumeSelect.selectByAttribute('value', targetVolumeId);
  expect(await volumeSelect.getValue()).toBe(targetVolumeId);
  await fillTestId('chapter-title-input', title);
  await clickTestId('chapter-create-submit');
  const chapterItem = await findTestIdByAttribute('chapter-item', 'data-chapter-title', title);
  const chapterId = await chapterItem.getAttribute('data-chapter-id');
  if (!chapterId) throw new Error('Created chapter did not expose data-chapter-id');
  await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
  return chapterId;
}

export async function createFirstChapterThroughUi(): Promise<string> {
  const volumeId = await createVolumeThroughUi();
  return createChapterThroughUi(unique('E2E Chapter'), volumeId);
}

export async function invokeProject(projectId: string): Promise<Record<string, unknown>> {
  return bridgeCall<Record<string, unknown>>('get_novel_by_id', { id: projectId });
}

export async function disposeCurrentPage(): Promise<void> {
  try {
    await browser.deleteSession();
  } catch {
    // WDIO will close the session during teardown; this is only a best effort.
  }
}
