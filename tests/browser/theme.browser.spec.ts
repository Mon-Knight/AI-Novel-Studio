import fs from 'node:fs';
import path from 'node:path';
import { browser, expect, $ } from '@wdio/globals';
import { readPngVisualMetrics, type PngVisualMetrics } from './pngVisualMetrics';

const THEME_STORAGE_KEY = 'ai_novel_studio_theme_preference';
const screenshotDirectory = path.resolve(import.meta.dirname, '../../test-results/browser-theme');
const visualBaseline = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, 'theme-visual-baseline.json'), 'utf8'),
) as {
  minimumWidth: number;
  minimumHeight: number;
  minimumOpaqueRatio: number;
  minimumThemeLuminanceDelta: number;
  routes: Record<
    string,
    Record<string, { meanLuminance: [number, number]; minimumColorBuckets: number }>
  >;
};
const visualMetrics = new Map<string, PngVisualMetrics>();

const routes = [
  { name: 'home', hash: '/#/', selector: '.home-page' },
  { name: 'settings', hash: '/#/settings', selector: '.detail-card' },
  {
    name: 'story-assets',
    hash: '/#/novels/browser-fixture/story-assets',
    selector: '.story-assets-page',
  },
] as const;

function screenshotPath(theme: string, page: string): string {
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  return path.join(screenshotDirectory, `${page}-${theme}.png`);
}

async function waitForStartupSplashRemoval(): Promise<void> {
  const splash = await $('#startup-splash');
  await splash.waitForExist({ reverse: true });
  expect(await splash.isExisting()).toBe(false);
}

describe('theme visual matrix', () => {
  before(async () => {
    await browser.url('/');
    await browser.execute(() => window.localStorage.clear());
  });

  after(() => {
    for (const route of routes) {
      const light = visualMetrics.get(`${route.name}:light`);
      const dark = visualMetrics.get(`${route.name}:dark`);
      expect(light).toBeDefined();
      expect(dark).toBeDefined();
      expect((light?.meanLuminance ?? 0) - (dark?.meanLuminance ?? 1)).toBeGreaterThan(
        visualBaseline.minimumThemeLuminanceDelta,
      );
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const route of routes) {
      it(`renders ${route.name} with accessible ${theme} semantic surfaces`, async () => {
        await browser.execute((preference) => {
          window.localStorage.setItem('ai_novel_studio_theme_preference', preference);
        }, theme);
        await browser.refresh();
        await browser.url(route.hash);
        const page = await $(route.selector);
        await page.waitForDisplayed();
        await waitForStartupSplashRemoval();

        const snapshot = await browser.execute((selector) => {
          const root = document.documentElement;
          const target = document.querySelector<HTMLElement>(selector);
          const rootStyle = getComputedStyle(root);
          const bodyStyle = getComputedStyle(document.body);
          const targetStyle = target ? getComputedStyle(target) : null;
          return {
            preference: root.dataset.theme,
            effective: root.dataset.effectiveTheme,
            colorScheme: root.style.colorScheme,
            appSurface: rootStyle.getPropertyValue('--color-bg-app').trim(),
            cardSurface: rootStyle.getPropertyValue('--color-bg-card').trim(),
            text: rootStyle.getPropertyValue('--color-text-primary').trim(),
            focus: rootStyle.getPropertyValue('--color-focus-ring').trim(),
            bodyBackground: bodyStyle.backgroundColor,
            bodyText: bodyStyle.color,
            targetBackground: targetStyle?.backgroundColor ?? '',
          };
        }, route.selector);

        expect(snapshot.preference).toBe(theme);
        expect(snapshot.effective).toBe(theme);
        expect(snapshot.colorScheme).toBe(theme);
        expect(snapshot.appSurface).not.toBe(snapshot.cardSurface);
        expect(snapshot.text).not.toBe(snapshot.appSurface);
        expect(snapshot.focus).not.toBe(snapshot.appSurface);
        expect(snapshot.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
        expect(snapshot.bodyText).not.toBe('rgba(0, 0, 0, 0)');
        expect(snapshot.targetBackground).not.toBe('rgba(0, 0, 0, 0)');

        const outputPath = screenshotPath(theme, route.name);
        await browser.saveScreenshot(outputPath);
        const pixels = readPngVisualMetrics(outputPath);
        const baseline = visualBaseline.routes[route.name]?.[theme];
        expect(baseline).toBeDefined();
        expect(pixels.width).toBeGreaterThanOrEqual(visualBaseline.minimumWidth);
        expect(pixels.height).toBeGreaterThanOrEqual(visualBaseline.minimumHeight);
        expect(pixels.opaqueRatio).toBeGreaterThanOrEqual(visualBaseline.minimumOpaqueRatio);
        expect(pixels.coarseColorBuckets).toBeGreaterThanOrEqual(
          baseline?.minimumColorBuckets ?? Number.MAX_SAFE_INTEGER,
        );
        expect(pixels.meanLuminance).toBeGreaterThanOrEqual(
          baseline?.meanLuminance[0] ?? Number.MAX_SAFE_INTEGER,
        );
        expect(pixels.meanLuminance).toBeLessThanOrEqual(baseline?.meanLuminance[1] ?? -1);
        visualMetrics.set(`${route.name}:${theme}`, pixels);
      });
    }
  }

  it('persists explicit system mode while exposing an effective visual theme', async () => {
    await browser.execute((storageKey) => {
      window.localStorage.setItem(storageKey, 'system');
    }, THEME_STORAGE_KEY);
    await browser.refresh();
    await browser.url('/#/settings');
    await (await $('.detail-card')).waitForDisplayed();
    const snapshot = await browser.execute(() => ({
      preference: document.documentElement.dataset.theme,
      effective: document.documentElement.dataset.effectiveTheme,
      colorScheme: document.documentElement.style.colorScheme,
    }));
    expect(snapshot.preference).toBe('system');
    expect(['light', 'dark']).toContain(snapshot.effective);
    expect(snapshot.colorScheme).toBe(snapshot.effective);
  });
});
