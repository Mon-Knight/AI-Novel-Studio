import { browser, expect, $ } from '@wdio/globals';

const SENTINEL_KEY = 'browser_e2e_sentinel';
const FORBIDDEN_BROWSER_ASSET_KEYS = [
  'ai_novel_studio_content_transactions',
  'ai_novel_studio_factions',
  'ai_novel_studio_locations',
];

describe('real browser development mode', () => {
  before(async () => {
    await browser.url('/');
    await browser.execute((sentinelKey) => {
      window.localStorage.clear();
      window.localStorage.setItem(sentinelKey, 'preserve');
    }, SENTINEL_KEY);
    await browser.url('/#/novels/browser-fixture/story-assets');
  });

  it('loads the lazy StoryAssets route in Chromium without a Tauri bridge', async () => {
    const page = await $('.story-assets-page');
    await page.waitForDisplayed();
    await expect(page).toBeDisplayed();

    const runtime = await browser.execute(() => ({
      hash: window.location.hash,
      hasTauriBridge: '__TAURI__' in window || '__TAURI_INTERNALS__' in window,
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    }));
    expect(runtime.hash).toBe('#/novels/browser-fixture/story-assets');
    expect(runtime.hasTauriBridge).toBe(false);
    expect(runtime.rootChildren).toBeGreaterThan(0);
  });

  it('exposes the browser-only boundary and never fabricates SQLite-backed assets', async () => {
    const notice = await $('.story-assets-notice');
    await expect(notice).toBeDisplayed();
    await expect(notice).toHaveText(expect.stringContaining('SQLite'));

    const submit = await $('.story-assets-form button[type="submit"]');
    await expect(submit).toBeDisabled();

    const storage = await browser.execute(
      (sentinelKey, forbiddenKeys) => ({
        sentinel: window.localStorage.getItem(sentinelKey),
        forbiddenValues: forbiddenKeys.map((key) => window.localStorage.getItem(key)),
        keys: Object.keys(window.localStorage),
      }),
      SENTINEL_KEY,
      FORBIDDEN_BROWSER_ASSET_KEYS,
    );
    expect(storage.sentinel).toBe('preserve');
    expect(storage.forbiddenValues).toEqual(FORBIDDEN_BROWSER_ASSET_KEYS.map(() => null));
    expect(storage.keys).not.toContain('ai_novel_studio_content_transactions');
  });

  it('renders manual dark and light themes with distinct semantic surfaces', async () => {
    const themeSnapshot = async (preference: 'dark' | 'light') => {
      await browser.execute((nextPreference) => {
        window.localStorage.setItem('ai_novel_studio_theme_preference', nextPreference);
      }, preference);
      await browser.refresh();
      const page = await $('.story-assets-page');
      await page.waitForDisplayed();
      return browser.execute(() => {
        const root = document.documentElement;
        const card = document.querySelector<HTMLElement>('.story-assets-card');
        const rootStyle = getComputedStyle(root);
        return {
          preference: root.dataset.theme,
          effective: root.dataset.effectiveTheme,
          colorScheme: root.style.colorScheme,
          surfaceToken: rootStyle.getPropertyValue('--color-bg-sidebar').trim(),
          textToken: rootStyle.getPropertyValue('--color-text-primary').trim(),
          cardBackground: card ? getComputedStyle(card).backgroundColor : '',
        };
      });
    };

    const dark = await themeSnapshot('dark');
    expect(dark).toMatchObject({
      preference: 'dark',
      effective: 'dark',
      colorScheme: 'dark',
      surfaceToken: '#252526',
      textToken: '#f3f3f3',
      cardBackground: 'rgb(37, 37, 38)',
    });

    const light = await themeSnapshot('light');
    expect(light).toMatchObject({
      preference: 'light',
      effective: 'light',
      colorScheme: 'light',
      surfaceToken: '#ffffff',
      textToken: '#1a1a2e',
      cardBackground: 'rgb(255, 255, 255)',
    });
  });
});
