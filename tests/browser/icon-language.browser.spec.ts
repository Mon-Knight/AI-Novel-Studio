import { $, browser } from '@wdio/globals';
import { expectUnifiedIconLanguage } from './iconLanguage';

const routes = [
  { name: 'workbench', hash: '/#/' },
  { name: 'novels', hash: '/#/novels' },
  { name: 'assets', hash: '/#/assets' },
  { name: 'styles', hash: '/#/styles' },
  { name: 'templates', hash: '/#/templates' },
  { name: 'ai-tasks', hash: '/#/ai-tasks' },
  { name: 'import-export', hash: '/#/import-export' },
  { name: 'settings', hash: '/#/settings' },
  { name: 'coming-soon', hash: '/#/coming-soon' },
  { name: 'not-found', hash: '/#/missing-icon-audit-route' },
] as const;

describe('application icon language', () => {
  before(async () => {
    await browser.url('/#/');
    await browser.execute(() => window.localStorage.clear());
    await browser.refresh();
  });

  for (const route of routes) {
    it(`keeps ${route.name} on the sidebar Lucide line-icon baseline`, async () => {
      await browser.url(route.hash);
      await (await $('.app-sidebar')).waitForDisplayed();
      await (await $('#startup-splash')).waitForExist({ reverse: true });
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const shell = document.querySelector('[data-testid="app-shell"]');
            const fallback = document.querySelector('[data-testid="workbench-loading"]');
            return Boolean(shell) && !fallback;
          }),
        {
          timeout: 20_000,
          interval: 50,
          timeoutMsg: `Route ${route.name} did not settle for icon inspection.`,
        },
      );
      await expectUnifiedIconLanguage();
    });
  }
});
