import { browser, expect } from '@wdio/globals';
import { bridgeCall, navigateHash, waitForTestId, waitForTestIdAttribute } from './helpers';

const CUSTOM_PROTOCOL_ORIGIN = 'https://tauri.localhost';
const UPDATE_CHANNEL_STORAGE_KEY = 'ai_novel_studio_update_channel_v1';
const THEME_STORAGE_KEY = 'ai_novel_studio_theme_preference';
const LEGACY_MIGRATION_SENTINEL_KEY = 'ai_novel_studio_e2e_legacy_storage_migration_v1';
const UPDATE_CHANNEL_SECTION_SELECTOR = 'section[aria-labelledby="app-update-settings-title"]';

interface UpdateChannelChoice {
  label: string;
  checked: boolean;
}

async function readUpdateChannelChoices(): Promise<UpdateChannelChoice[]> {
  return browser.execute((sectionSelector) => {
    const section = document.querySelector<HTMLElement>(sectionSelector);
    if (!section) throw new Error('Update channel settings section is unavailable');
    return Array.from(section.querySelectorAll<HTMLElement>('[role="radio"]'), (radio) => ({
      label: (radio.textContent ?? '').replace(/\s+/gu, ' ').trim(),
      checked: radio.getAttribute('aria-checked') === 'true',
    }));
  }, UPDATE_CHANNEL_SECTION_SELECTOR);
}

function expectSelectedUpdateChannel(
  choices: UpdateChannelChoice[],
  expectedLabel: 'Stable' | 'Beta',
): void {
  expect(choices).toHaveLength(2);
  const selected = choices.filter((choice) => choice.checked);
  expect(selected).toHaveLength(1);
  expect(selected[0]?.label).toContain(expectedLabel);
}

describe('Tauri 2 desktop migration', () => {
  it('serves the packaged frontend from the Windows https custom-protocol origin', async () => {
    await waitForTestId('app-shell');
    const location = await browser.execute(() => ({
      origin: window.location.origin,
      protocol: window.location.protocol,
      host: window.location.host,
    }));

    expect(location).toEqual({
      origin: CUSTOM_PROTOCOL_ORIGIN,
      protocol: 'https:',
      host: 'tauri.localhost',
    });
  });

  it('toggles native maximize state through the Tauri 2 window ACL and reads it back', async () => {
    const shell = await waitForTestId('app-shell');
    expect(await shell.getAttribute('data-window-frame')).toBe('custom');
    expect(await shell.getAttribute('data-window-maximized')).toBe('false');

    const initialToggle = await waitForTestId('window-toggle-maximize');
    expect(await initialToggle.isEnabled()).toBe(true);
    expect(await initialToggle.getAttribute('aria-pressed')).toBe('false');

    await initialToggle.click();
    await waitForTestIdAttribute('app-shell', 'data-window-maximized', 'true');
    const maximizedToggle = await waitForTestId('window-toggle-maximize');
    expect(await maximizedToggle.getAttribute('aria-pressed')).toBe('true');

    await maximizedToggle.click();
    await waitForTestIdAttribute('app-shell', 'data-window-maximized', 'false');
    const restoredToggle = await waitForTestId('window-toggle-maximize');
    expect(await restoredToggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a pre-seeded beta update channel readable after a document reload', async () => {
    await browser.execute(
      (storageKey) => localStorage.removeItem(storageKey),
      UPDATE_CHANNEL_STORAGE_KEY,
    );
    await navigateHash('#/settings?tab=general');
    await waitForTestId('settings-tab-pane-general');
    expectSelectedUpdateChannel(await readUpdateChannelChoices(), 'Stable');

    // Seed only the persisted preference; this scenario must never trigger the updater/check IPC.
    await browser.execute(
      (storageKey) => localStorage.setItem(storageKey, 'beta'),
      UPDATE_CHANNEL_STORAGE_KEY,
    );
    // The mounted card still shows the old in-memory value; only the reload proves a fresh read.
    expectSelectedUpdateChannel(await readUpdateChannelChoices(), 'Stable');

    const timeOriginBeforeReload = await browser.execute(() => performance.timeOrigin);
    await browser.refresh();
    await browser.waitUntil(
      async () => (await browser.execute(() => performance.timeOrigin)) !== timeOriginBeforeReload,
      {
        timeout: 30000,
        timeoutMsg: 'The Tauri document did not reload',
      },
    );
    await waitForTestId('app-shell');
    await waitForTestId('settings-tab-pane-general');

    expect(await browser.execute(() => window.location.hash)).toBe('#/settings?tab=general');
    expect(await browser.execute(() => window.location.origin)).toBe(CUSTOM_PROTOCOL_ORIGIN);
    expect(
      await browser.execute(
        (storageKey) => localStorage.getItem(storageKey),
        UPDATE_CHANNEL_STORAGE_KEY,
      ),
    ).toBe('beta');
    expectSelectedUpdateChannel(await readUpdateChannelChoices(), 'Beta');
  });

  it('migrates v1 HTTP-origin LocalStorage into the Tauri 2 HTTPS origin exactly once', async () => {
    const previousSessionMarker = await browser.execute(() => performance.timeOrigin);

    await bridgeCall('seed_e2e_legacy_local_storage');
    await browser.waitUntil(
      async () => (await bridgeCall<boolean>('get_e2e_legacy_storage_seed_state')) === true,
      {
        timeout: 30000,
        timeoutMsg: 'The legacy HTTP-origin storage fixture was not seeded',
      },
    );
    // The fixture runs in a hidden http://tauri.localhost WebView and must not
    // leak into the current HTTPS origin before the app restart.
    expect(
      await browser.execute(
        (storageKey) => localStorage.getItem(storageKey),
        LEGACY_MIGRATION_SENTINEL_KEY,
      ),
    ).toBeNull();

    await browser.reloadSession();
    await browser.waitUntil(
      async () => (await browser.execute(() => performance.timeOrigin)) !== previousSessionMarker,
      {
        timeout: 30000,
        timeoutMsg: 'The Tauri document did not restart for migration verification',
      },
    );
    await waitForTestId('app-shell');
    await navigateHash('#/settings?tab=general');
    await waitForTestId('settings-tab-pane-general');

    const migrated = await browser.execute(
      (sentinelKey, channelKey, themeKey) => ({
        sentinel: localStorage.getItem(sentinelKey),
        channel: localStorage.getItem(channelKey),
        theme: localStorage.getItem(themeKey),
      }),
      LEGACY_MIGRATION_SENTINEL_KEY,
      UPDATE_CHANNEL_STORAGE_KEY,
      THEME_STORAGE_KEY,
    );
    expect(migrated).toEqual({
      sentinel: 'migrated-from-http-origin',
      channel: 'beta',
      theme: 'dark',
    });
    expectSelectedUpdateChannel(await readUpdateChannelChoices(), 'Beta');

    await bridgeCall('probe_e2e_legacy_local_storage');
    let legacyEntries: Array<{ key: string; value: string }> | null = null;
    await browser.waitUntil(
      async () => {
        legacyEntries = await bridgeCall<Array<{ key: string; value: string }> | null>(
          'get_e2e_legacy_storage_probe_entries',
        );
        return legacyEntries !== null;
      },
      {
        timeout: 30000,
        timeoutMsg: 'The legacy HTTP-origin storage probe did not complete',
      },
    );
    expect(legacyEntries?.some((entry) => entry.key === LEGACY_MIGRATION_SENTINEL_KEY)).toBe(false);
  });
});
