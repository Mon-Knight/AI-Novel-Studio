import fs from 'node:fs';
import path from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import {
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTextareaTestId,
  openWorkspace,
} from '../e2e/helpers';

const screenshotDirectory = path.resolve(
  import.meta.dirname,
  '../../test-results/writing-workspace-layout',
);

async function waitForStartupSplashRemoval(): Promise<void> {
  await (await $('#startup-splash')).waitForExist({ reverse: true });
}

describe('writing workspace layout', () => {
  before(async () => {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await browser.url('/#/novels');
    await browser.execute(() => window.localStorage.clear());
    await browser.refresh();
    await waitForStartupSplashRemoval();
    await (await $('[data-testid="project-list"]')).waitForDisplayed();

    const projectId = await createProjectThroughUi('雾港记事');
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi('第一卷：潮汐之门');
    await createChapterThroughUi('雾港来信', volumeId);
    await fillTextareaTestId(
      'chapter-editor',
      '港口的雾在黄昏后沉了下来。\n\n林深展开那封被潮水浸过的信，纸上只剩一行模糊的字：不要相信钟楼里的人。',
    );
  });

  for (const viewport of [
    { width: 1024, height: 700 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
  ]) {
    it(`keeps the review surface stable at ${viewport.width}x${viewport.height}`, async () => {
      await browser.setWindowSize(viewport.width, viewport.height);
      await browser.pause(80);

      const layout = await browser.execute(() => {
        const rect = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector);
          if (!node) throw new Error(`Missing layout node: ${selector}`);
          const value = node.getBoundingClientRect();
          return {
            left: value.left,
            right: value.right,
            top: value.top,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          };
        };
        const chapter = document.querySelector<HTMLElement>('[data-testid="chapter-item"]');
        const volume = document.querySelector<HTMLElement>('.tree-volume-header');
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="chapter-editor"]',
        );
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          shell: rect('[data-testid="app-shell"]'),
          globalNavigation: rect('.app-sidebar'),
          workspace: rect('.workspace-page'),
          chapterTree: rect('.workspace-sidebar'),
          editor: rect('.workspace-editor'),
          topbar: rect('.workspace-topbar'),
          editorContent: rect('.editor-content'),
          paper: rect('.editor-paper'),
          textarea: rect('[data-testid="chapter-editor"]'),
          toolbar: rect('.right-toolbar'),
          statusbar: rect('.workspace-statusbar'),
          chapterTag: chapter?.tagName,
          chapterCurrent: chapter?.getAttribute('aria-current'),
          volumeTag: volume?.tagName,
          volumeExpanded: volume?.getAttribute('aria-expanded'),
          textareaResize: textarea ? getComputedStyle(textarea).resize : '',
          iconCount: document.querySelectorAll('.right-toolbar svg, .app-sidebar .nav-icon svg')
            .length,
          obsoleteNotice: document.body.textContent?.includes('右侧 AI 生成面板') ?? false,
          blockingLoadingState: Boolean(
            document.querySelector(
              '.workspace-full-state, [data-testid="workspace-document-loading"]',
            ),
          ),
          documentScrollWidth: document.documentElement.scrollWidth,
        };
      });

      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.workspace.right).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.chapterTree.width).toBeGreaterThanOrEqual(239);
      expect(layout.chapterTree.width).toBeLessThanOrEqual(241);
      expect(layout.editor.width).toBeGreaterThan(360);
      expect(layout.topbar.height).toBeGreaterThanOrEqual(43);
      expect(layout.topbar.height).toBeLessThanOrEqual(45);
      expect(layout.paper.width).toBeLessThanOrEqual(922);
      expect(layout.paper.left).toBeGreaterThanOrEqual(layout.editorContent.left - 1);
      expect(layout.paper.right).toBeLessThanOrEqual(layout.editorContent.right + 1);
      expect(layout.textarea.scrollWidth).toBeLessThanOrEqual(layout.textarea.clientWidth + 1);
      expect(layout.toolbar.right).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.statusbar.bottom).toBeLessThanOrEqual(layout.workspace.bottom + 1);
      expect(layout.chapterTag).toBe('BUTTON');
      expect(layout.chapterCurrent).toBe('page');
      expect(layout.volumeTag).toBe('BUTTON');
      expect(layout.volumeExpanded).toBe('true');
      expect(layout.textareaResize).toBe('none');
      expect(layout.iconCount).toBeGreaterThanOrEqual(13);
      expect(layout.obsoleteNotice).toBe(false);
      expect(layout.blockingLoadingState).toBe(false);

      await browser.saveScreenshot(
        path.join(
          screenshotDirectory,
          `writing-workspace-${viewport.width}x${viewport.height}.png`,
        ),
      );
    });
  }

  it('keeps a review panel bounded in the standard desktop viewport', async () => {
    await browser.setWindowSize(1440, 900);
    await (await $('[data-testid="chapter-summary"]')).click();
    await (await $('.right-panel')).waitForDisplayed();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const editor = document.querySelector<HTMLElement>('.workspace-editor');
          if (!editor) return false;
          const editorMargin = Number.parseFloat(getComputedStyle(editor).marginRight);
          const panelWidth = Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--right-panel-width'),
          );
          return Math.abs(editorMargin - panelWidth) <= 1;
        }),
      {
        timeout: 2_000,
        interval: 25,
        timeoutMsg: 'The writing surface did not finish making room for the review panel.',
      },
    );

    const layout = await browser.execute(() => {
      const editor = document
        .querySelector<HTMLElement>('.workspace-editor')
        ?.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>('.right-panel')?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        editorRight: editor?.right ?? 0,
        panelLeft: panel?.left ?? 0,
        panelRight: panel?.right ?? 0,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    await browser.saveScreenshot(
      path.join(screenshotDirectory, 'writing-workspace-review-panel-1440x900.png'),
    );
    expect(layout.editorRight).toBeLessThanOrEqual(layout.panelLeft + 1);
    expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });
});
