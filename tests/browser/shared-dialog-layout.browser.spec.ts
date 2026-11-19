import fs from 'node:fs';
import path from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import {
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  navigateHash,
  openWorkspace,
} from '../e2e/helpers';

const screenshotDirectory = path.resolve(
  import.meta.dirname,
  '../../test-results/shared-dialog-layout',
);
const chapterTitle = '隔离布局测试章';
const themeColors = new Map<string, { dialog: string; input: string }>();
let projectId = '';

async function waitForPage(selector: string): Promise<void> {
  await (await $(selector)).waitForDisplayed();
  await (await $('#startup-splash')).waitForExist({ reverse: true });
}

async function installNetworkProbe(): Promise<void> {
  await browser.execute(() => {
    if (
      window.location.hostname !== '127.0.0.1' ||
      '__TAURI__' in window ||
      '__TAURI_INTERNALS__' in window ||
      '__TAURI_IPC__' in window
    ) {
      throw new Error('Shared dialog tests require an isolated loopback browser without Tauri.');
    }
    const probe = { blockedFetches: 0 };
    (window as Window & { __sharedDialogProbe?: typeof probe }).__sharedDialogProbe = probe;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        window.location.href,
      );
      if (url.origin !== window.location.origin) {
        probe.blockedFetches += 1;
        return Promise.reject(new Error('External requests are blocked in shared dialog tests.'));
      }
      return originalFetch(input, init);
    };
  });
}

async function setViewport(width: number, height: number): Promise<void> {
  await browser.setWindowSize(width, height);
  const outer = await browser.getWindowSize();
  const inner = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
  if (inner.width !== width || inner.height !== height) {
    await browser.setWindowSize(
      outer.width + width - inner.width,
      outer.height + height - inner.height,
    );
  }
  // Headless Chromium applies the compensated resize asynchronously; asserting the very
  // next frame is racy (observed 677px for a requested 820px on the CI runner).
  await browser.waitUntil(
    async () => browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
    { timeout: 5000, timeoutMsg: `viewport did not settle at ${width}x${height}` },
  );
}

async function coldOpen(
  route: string,
  selector: string,
  theme: 'light' | 'dark' = 'light',
): Promise<void> {
  await browser.execute((preference) => {
    window.localStorage.setItem('ai_novel_studio_theme_preference', preference);
  }, theme);
  await navigateHash(route);
  // A fragment navigation alone would retain CSS imported by the previous route.
  await browser.refresh();
  await waitForPage(selector);
  await installNetworkProbe();
}

async function inspectDialog(maximumWidth = 640) {
  await (await $('.modal-dialog')).waitForDisplayed();
  const snapshot = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('.modal-dialog');
    if (!dialog) throw new Error('Expected the real shared dialog.');
    const box = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    const body = dialog.querySelector<HTMLElement>('.modal-frame-body');
    const header = dialog.querySelector<HTMLElement>('.modal-frame-header');
    const footer = dialog.querySelector<HTMLElement>('.modal-frame-footer');
    if (!body || !header || !footer) throw new Error('Shared modal chrome is incomplete.');
    const fields = Array.from(
      dialog.querySelectorAll<HTMLElement>('.form-input, .form-textarea, .panel-select'),
    ).map((field) => {
      const fieldBox = field.getBoundingClientRect();
      const fieldStyle = getComputedStyle(field);
      return {
        tag: field.tagName,
        left: fieldBox.left,
        right: fieldBox.right,
        background: fieldStyle.backgroundColor,
        color: fieldStyle.color,
        border: parseFloat(fieldStyle.borderTopWidth),
        padding: parseFloat(fieldStyle.paddingTop),
        radius: parseFloat(fieldStyle.borderTopLeftRadius),
      };
    });
    return {
      theme: document.documentElement.dataset.effectiveTheme,
      viewport: { width: innerWidth, height: innerHeight },
      box: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      },
      background: style.backgroundColor,
      border: parseFloat(style.borderTopWidth),
      padding: parseFloat(getComputedStyle(body).paddingTop),
      role: dialog.getAttribute('role'),
      labelledBy: dialog.getAttribute('aria-labelledby'),
      initialFocusInside: dialog.contains(document.activeElement),
      bodyOverflow: getComputedStyle(body).overflowY,
      chrome: {
        headerTop: header.getBoundingClientRect().top,
        footerBottom: footer.getBoundingClientRect().bottom,
        bodyHeight: body.clientHeight,
      },
      fields,
      horizontalOverflow: dialog.scrollWidth - dialog.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(snapshot.box.width).toBeGreaterThanOrEqual(280);
  expect(snapshot.box.width).toBeLessThanOrEqual(maximumWidth + 1);
  expect(snapshot.box.top).toBeGreaterThanOrEqual(12);
  expect(snapshot.box.bottom).toBeLessThanOrEqual(snapshot.viewport.height - 11);
  expect(
    Math.abs((snapshot.box.left + snapshot.box.right) / 2 - snapshot.viewport.width / 2),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs((snapshot.box.top + snapshot.box.bottom) / 2 - snapshot.viewport.height / 2),
  ).toBeLessThanOrEqual(2);
  expect(snapshot.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(snapshot.border).toBeGreaterThanOrEqual(1);
  expect(snapshot.padding).toBeGreaterThanOrEqual(16);
  expect(snapshot.role).toBe('dialog');
  expect(snapshot.labelledBy).not.toBe('');
  expect(snapshot.initialFocusInside).toBe(true);
  expect(snapshot.bodyOverflow).toBe('auto');
  expect(snapshot.chrome.headerTop).toBeGreaterThanOrEqual(snapshot.box.top);
  expect(snapshot.chrome.footerBottom).toBeLessThanOrEqual(snapshot.box.bottom);
  expect(snapshot.chrome.bodyHeight).toBeGreaterThan(0);
  expect(snapshot.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(snapshot.documentWidth).toBeLessThanOrEqual(snapshot.viewport.width);
  expect(snapshot.fields.length).toBeGreaterThan(0);
  for (const field of snapshot.fields) {
    expect(field.left).toBeGreaterThan(snapshot.box.left);
    expect(field.right).toBeLessThan(snapshot.box.right);
    expect(field.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(field.color).not.toBe(field.background);
    expect(field.border).toBeGreaterThanOrEqual(1);
    expect(field.padding).toBeGreaterThanOrEqual(6);
    expect(field.radius).toBeGreaterThanOrEqual(4);
  }
  return snapshot;
}

async function scrollToDialogActions(requireScrollable = false): Promise<void> {
  const scroll = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('.modal-dialog');
    if (!dialog) throw new Error('Missing dialog while checking action reachability.');
    const regions = [dialog, ...dialog.querySelectorAll<HTMLElement>('*')].filter((node) => {
      const overflow = getComputedStyle(node).overflowY;
      return ['auto', 'scroll'].includes(overflow) && node.scrollHeight > node.clientHeight + 1;
    });
    return { regions: regions.length };
  });
  if (requireScrollable) expect(scroll.regions).toBeGreaterThan(0);
  await browser.execute(() => {
    const cancel = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.modal-dialog button'),
    ).find((button) => button.textContent?.trim() === '取消');
    if (!cancel) throw new Error('Missing real dialog cancel action.');
    // The standard DOM scroll path avoids Edge's wheel-action viewport limitation.
    cancel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  const actions = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('.modal-dialog');
    if (!dialog) throw new Error('Missing dialog while inspecting action bounds.');
    return Array.from(
      dialog.querySelectorAll<HTMLButtonElement>(
        '.modal-frame-header button, .modal-frame-footer button',
      ),
    ).map((button) => {
      const box = button.getBoundingClientRect();
      const centerX = (box.left + box.right) / 2;
      const centerY = (box.top + box.bottom) / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      return {
        label: button.textContent?.trim(),
        top: box.top,
        bottom: box.bottom,
        viewportHeight: innerHeight,
        unobscured: Boolean(hit && (hit === button || button.contains(hit))),
      };
    });
  });
  expect(actions.length).toBeGreaterThanOrEqual(2);
  for (const action of actions) {
    expect(action.top).toBeGreaterThanOrEqual(0);
    expect(action.bottom).toBeLessThanOrEqual(action.viewportHeight);
    expect(action.unobscured).toBe(true);
  }
}

async function cancelDialog(): Promise<void> {
  await scrollToDialogActions();
  await (await (await $('.modal-dialog')).$('button=取消')).click();
  await (await $('.modal-dialog')).waitForExist({ reverse: true });
}

async function inspectImportFrame(kind: 'TXT' | 'JSON', maximumWidth: number): Promise<void> {
  await setViewport(1024, 240);
  await (await (await $('.home-quick-actions')).$(`button=导入 ${kind}`)).click();
  await (await $('.modal-frame')).waitForDisplayed();
  const snapshot = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('.modal-frame');
    const body = dialog?.querySelector<HTMLElement>('.modal-frame-body');
    const header = dialog?.querySelector<HTMLElement>('.modal-frame-header');
    if (!dialog || !body || !header) throw new Error('Expected a shared import frame.');
    const box = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    const headerTop = header.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    const scrolled = body.scrollTop;
    const headerStayedFixed = header.getBoundingClientRect().top === headerTop;
    body.scrollTop = 0;
    return {
      position: style.position,
      background: style.backgroundColor,
      maxHeight: parseFloat(style.maxHeight),
      width: box.width,
      top: box.top,
      bottom: box.bottom,
      centerX: (box.left + box.right) / 2,
      centerY: (box.top + box.bottom) / 2,
      viewport: { width: innerWidth, height: innerHeight },
      nestedInOverlay: Boolean(dialog.closest('.modal-overlay')),
      scrolled,
      headerStayedFixed,
      labelled: Boolean(dialog.getAttribute('aria-labelledby')),
    };
  });
  expect(snapshot.position).toBe('relative');
  expect(snapshot.nestedInOverlay).toBe(true);
  expect(snapshot.labelled).toBe(true);
  expect(snapshot.headerStayedFixed).toBe(true);
  expect(snapshot.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(snapshot.width).toBeLessThanOrEqual(maximumWidth + 1);
  expect(snapshot.top).toBeGreaterThanOrEqual(12);
  expect(snapshot.bottom).toBeLessThanOrEqual(snapshot.viewport.height - 11);
  expect(snapshot.maxHeight).toBeLessThanOrEqual(snapshot.viewport.height - 16);
  expect(Math.abs(snapshot.centerX - snapshot.viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(snapshot.centerY - snapshot.viewport.height / 2)).toBeLessThanOrEqual(2);
  expect(snapshot.scrolled).toBeGreaterThan(0);
  await (await $(`.modal-frame button[aria-label="关闭 ${kind} 导入"]`)).click();
  await (await $('.modal-frame')).waitForExist({ reverse: true });
  expect(
    await browser.execute(
      (type) => document.activeElement?.textContent?.trim() === `导入 ${type}`,
      kind,
    ),
  ).toBe(true);
}

async function sharedStyleSnapshot(selectors: string[]) {
  await browser.action('pointer').move({ x: 1, y: 1 }).perform();
  await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
  await browser.pause(200);
  return browser.execute((targets) => {
    return targets.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing shared style comparison target: ${selector}`);
      const style = getComputedStyle(element);
      return {
        selector,
        background: style.backgroundColor,
        color: style.color,
        padding: style.padding,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        display: style.display,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        transitionProperty: style.transitionProperty,
        boxSizing: style.boxSizing,
      };
    });
  }, selectors);
}

describe('shared legacy dialog and form layout', () => {
  before(async () => {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await browser.url('/#/novels');
    await installNetworkProbe();
    await browser.execute(() => window.localStorage.clear());
    await browser.refresh();
    await waitForPage('[data-testid="project-list"]');
    await installNetworkProbe();
    projectId = await createProjectThroughUi('共享弹窗隔离布局作品');
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi('隔离布局测试卷');
    await createChapterThroughUi(chapterTitle, volumeId);
  });

  beforeEach(async () => {
    await setViewport(1280, 820);
    await coldOpen('/novels', '[data-testid="project-list"]');
  });

  afterEach(async () => {
    const safety = await browser.execute(() => ({
      hasTauriBridge:
        '__TAURI__' in window || '__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window,
      aiTasks: JSON.parse(window.localStorage.getItem('ai_novel_studio_ai_tasks') ?? '[]').length,
      blockedFetches:
        (window as Window & { __sharedDialogProbe?: { blockedFetches: number } })
          .__sharedDialogProbe?.blockedFetches ?? -1,
    }));
    expect(safety).toEqual({ hasTauriBridge: false, aiTasks: 0, blockedFetches: 0 });
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`centers and styles the new-project dialog in ${theme} mode`, async () => {
      await setViewport(1440, 900);
      await coldOpen('/novels', '[data-testid="project-list"]', theme);
      await (await $('[data-testid="project-create"]')).click();
      const layout = await inspectDialog(560);
      expect(layout.theme).toBe(theme);
      expect(layout.fields.some((field) => field.tag === 'TEXTAREA')).toBe(true);
      themeColors.set(theme, { dialog: layout.background, input: layout.fields[0].background });
      if (theme === 'dark') {
        expect(themeColors.get('light')?.dialog).not.toBe(layout.background);
        expect(themeColors.get('light')?.input).not.toBe(layout.fields[0].background);
      }
      await scrollToDialogActions();
      await browser.saveScreenshot(path.join(screenshotDirectory, `new-project-${theme}.png`));
      await cancelDialog();
      if (theme === 'light') {
        await setViewport(1024, 700);
        await (await $('[data-testid="project-create"]')).click();
        await inspectDialog(560);
        await browser.saveScreenshot(path.join(screenshotDirectory, 'new-project-1024.png'));
        await cancelDialog();
        await inspectImportFrame('TXT', 540);
        await inspectImportFrame('JSON', 480);
      }
    });
  }

  it('traps keyboard focus and returns it to the opener without losing an unsaved form value', async () => {
    await (await $('[data-testid="project-create"]')).click();
    await (await $('[data-testid="project-name-input"]')).setValue('未提交的隔离标题');
    const state = await browser.execute(() => {
      const dialog = document.querySelector<HTMLElement>('.modal-frame')!;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      buttons[buttons.length - 1].focus();
      return {
        first: buttons[0].getAttribute('data-modal-close'),
        backgroundIsolated: Boolean(
          document.querySelector('.home-page > header[inert], .home-page > .page-heading[inert]'),
        ),
      };
    });
    expect(state.backgroundIsolated).toBe(true);
    await browser.keys('Tab');
    expect(
      await browser.execute(() => document.activeElement?.getAttribute('data-modal-close')),
    ).toBe(state.first);
    await browser.keys(['Shift', 'Tab']);
    expect(await browser.execute(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'project-save',
    );
    expect(await (await $('[data-testid="project-name-input"]')).getValue()).toBe(
      '未提交的隔离标题',
    );
    await browser.keys('Escape');
    await (await $('.modal-frame')).waitForExist({ reverse: true });
    expect(await browser.execute(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'project-create',
    );
    const persisted = await browser.execute(
      () =>
        JSON.parse(localStorage.getItem('ai_novel_studio_novels') ?? '[]') as Array<{
          title: string;
        }>,
    );
    expect(persisted.some((novel) => novel.title === '未提交的隔离标题')).toBe(false);
  });

  it('keeps workspace new-volume and new-chapter dialogs centered with styled input and select', async () => {
    await openWorkspace(projectId);
    await (await $('[data-testid="volume-create"]')).click();
    await inspectDialog(360);
    await cancelDialog();
    await (await $('[data-testid="chapter-create"]')).click();
    const chapterDialog = await inspectDialog(360);
    expect(chapterDialog.fields.some((field) => field.tag === 'SELECT')).toBe(true);
    await cancelDialog();
  });

  it('keeps detail-page volume and chapter editors bounded with reachable actions in a short viewport', async () => {
    await navigateHash(`/novels/${projectId}`);
    await waitForPage('[data-testid="novel-detail-outline"]');
    const outline = await $('[data-testid="novel-detail-outline"]');
    await (await outline.$('button=编辑')).click();
    await expect($('.modal-title')).toHaveText('编辑分卷');
    await inspectDialog(520);
    await cancelDialog();

    await setViewport(1024, 480);
    await (await outline.$(`button[aria-label="编辑章节 ${chapterTitle}"]`)).click();
    await expect($('.modal-title')).toHaveText('编辑章节');
    await inspectDialog(560);
    await scrollToDialogActions(true);
    await browser.saveScreenshot(path.join(screenshotDirectory, 'edit-chapter-short.png'));
    await cancelDialog();
  });

  it('styles style/output/text-analysis dialogs and lets the long style form scroll to its actions', async () => {
    await navigateHash('/styles');
    await (await $('button=新建风格')).waitForDisplayed();
    await setViewport(1024, 480);
    await (await $('button=新建风格')).click();
    await expect($('.modal-title')).toHaveText('新建风格方案');
    await inspectDialog(560);
    await scrollToDialogActions(true);
    await browser.saveScreenshot(path.join(screenshotDirectory, 'new-style-short.png'));
    await cancelDialog();

    await (await $('button*=输出控制')).click();
    await (await $('button=新建方案')).click();
    await expect($('.modal-title')).toHaveText('新建输出方案');
    await inspectDialog(480);
    await cancelDialog();

    await (await $('button*=风格方案')).click();
    await (await $('button=TXT分析')).click();
    await expect($('.modal-title')).toHaveText('TXT 风格分析');
    await inspectDialog(640);
    await scrollToDialogActions();
    // Inspect the entry only: never trigger its Provider-backed analysis action.
    await cancelDialog();
  });

  for (const dialog of [
    {
      name: 'new-project',
      route: '/novels',
      ready: '[data-testid="project-list"]',
      trigger: '[data-testid="project-create"]',
      fields: [
        '.modal-dialog .panel-field-label',
        '.modal-dialog .form-input',
        '.modal-dialog .form-textarea',
      ],
    },
    {
      name: 'style',
      route: '/styles',
      ready: 'button=新建风格',
      trigger: 'button=新建风格',
      fields: [
        '.modal-dialog .panel-field-label',
        '.modal-dialog .form-input',
        '.modal-dialog .panel-select',
      ],
    },
  ]) {
    it(`keeps ${dialog.name} labels and fields identical before and after the writing dock loads`, async () => {
      await coldOpen(dialog.route, dialog.ready);
      await (await $(dialog.trigger)).click();
      await inspectDialog(560);
      const before = await sharedStyleSnapshot(dialog.fields);
      await cancelDialog();

      await openWorkspace(projectId);
      await navigateHash(dialog.route);
      await waitForPage(dialog.ready);
      await (await $(dialog.trigger)).click();
      const after = await sharedStyleSnapshot(dialog.fields);
      expect(after).toEqual(before);
      await cancelDialog();
    });
  }

  for (const route of [
    {
      name: 'settings',
      path: '/settings',
      ready: '[data-testid="settings-tab-pane-general"]',
      selectors: [
        '.settings-card',
        '.app-update-actions .btn-secondary',
        '.app-update-actions .btn-primary',
      ],
    },
    {
      name: 'assets',
      path: '/assets',
      ready: '.page-layout .detail-card .input',
      selectors: ['.page-layout .detail-card', '.page-layout .detail-card .input'],
    },
  ]) {
    it(`keeps shared ${route.name} styles identical before and after visiting novel detail`, async () => {
      await coldOpen(route.path, route.ready);
      const before = await sharedStyleSnapshot(route.selectors);
      expect(before[0].background).not.toBe('rgba(0, 0, 0, 0)');
      expect(parseFloat(before[0].borderWidth)).toBeGreaterThanOrEqual(1);
      await navigateHash(`/novels/${projectId}`);
      await waitForPage('[data-testid="novel-detail-outline"]');
      await navigateHash(route.path);
      await waitForPage(route.ready);
      const after = await sharedStyleSnapshot(route.selectors);
      expect(after).toEqual(before);
    });
  }
});
