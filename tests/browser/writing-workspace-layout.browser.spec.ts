import fs from 'node:fs';
import path from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import {
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTextareaTestId,
  waitForTestIdAttribute,
  openWorkspace,
} from '../e2e/helpers';
import { expectUnifiedIconLanguage } from './iconLanguage';

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
    await fillTextareaTestId(
      'chapter-editor',
      Array.from(
        { length: 48 },
        (_, index) => `第${index + 1}段：雾潮沿着旧码头缓慢推进，林深把来信压在航海日志下面。`,
      ).join('\n\n'),
    );
    const before = await browser.execute(() => {
      const editor = document.querySelector<HTMLElement>('.workspace-editor');
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="chapter-editor"]',
      );
      if (!editor || !textarea) throw new Error('Missing writing surface before panel toggle.');
      textarea.scrollTop = Math.min(
        120,
        Math.max(0, textarea.scrollHeight - textarea.clientHeight),
      );
      textarea.setSelectionRange(18, 42);
      return {
        editorWidth: editor.getBoundingClientRect().width,
        scrollTop: textarea.scrollTop,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      };
    });
    await (await $('[data-testid="chapter-summary"]')).click();
    await (await $('.right-panel')).waitForExist();
    const openingTransitionProperties = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>('.right-panel');
      if (!panel) throw new Error('Missing review panel during its opening transition.');
      return panel
        .getAnimations()
        .map(
          (animation) =>
            (animation as Animation & { transitionProperty?: string }).transitionProperty ?? '',
        );
    });
    expect(openingTransitionProperties).toContain('opacity');
    expect(openingTransitionProperties).toContain('transform');
    await (await $('.right-panel')).waitForDisplayed();

    const layout = await browser.execute(() => {
      const editor = document
        .querySelector<HTMLElement>('.workspace-editor')
        ?.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>('.right-panel')?.getBoundingClientRect();
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="chapter-editor"]',
      );
      return {
        viewportWidth: window.innerWidth,
        editorWidth: editor?.width ?? 0,
        editorRight: editor?.right ?? 0,
        panelLeft: panel?.left ?? 0,
        panelRight: panel?.right ?? 0,
        scrollTop: textarea?.scrollTop ?? -1,
        selectionStart: textarea?.selectionStart ?? -1,
        selectionEnd: textarea?.selectionEnd ?? -1,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    await browser.saveScreenshot(
      path.join(screenshotDirectory, 'writing-workspace-review-panel-1440x900.png'),
    );
    await expectUnifiedIconLanguage();
    expect(Math.abs(layout.editorWidth - before.editorWidth)).toBeLessThanOrEqual(1);
    expect(layout.scrollTop).toBe(before.scrollTop);
    expect(layout.selectionStart).toBe(before.selectionStart);
    expect(layout.selectionEnd).toBe(before.selectionEnd);
    expect(layout.panelLeft).toBeLessThan(layout.editorRight);
    expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);

    await (await $('[data-testid="chapter-summary"]')).click();
    await browser.pause(260);
    const closedPanelState = await browser.execute(() => ({
      toolbarPressed: document
        .querySelector('[data-testid="chapter-summary"]')
        ?.getAttribute('aria-pressed'),
      overlays: Array.from(document.querySelectorAll<HTMLElement>('.right-panel-overlay')).map(
        (overlay) => ({
          className: overlay.className,
          panelState: overlay.dataset.panelState ?? '',
          ariaHidden: overlay.getAttribute('aria-hidden'),
          panelClassName: overlay.querySelector<HTMLElement>('.right-panel')?.className ?? '',
        }),
      ),
    }));
    expect(closedPanelState.toolbarPressed).toBe('false');
    expect(closedPanelState.overlays).toContainEqual(
      expect.objectContaining({ panelState: 'closed', ariaHidden: 'true' }),
    );
    const afterClose = await browser.execute(() => {
      const editor = document.querySelector<HTMLElement>('.workspace-editor');
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="chapter-editor"]',
      );
      return {
        editorWidth: editor?.getBoundingClientRect().width ?? 0,
        scrollTop: textarea?.scrollTop ?? -1,
      };
    });
    expect(Math.abs(afterClose.editorWidth - before.editorWidth)).toBeLessThanOrEqual(1);
    expect(afterClose.scrollTop).toBe(before.scrollTop);
  });

  it('uses inline feedback for body and outline saves without opening LoadingModal', async () => {
    await fillTextareaTestId('chapter-editor', '正文内联保存验证。\n\n第二段仍保留在编辑器中。');
    await browser.execute(() => {
      const status = document.querySelector<HTMLElement>('[data-testid="document-save-status"]');
      const probe = {
        states: [] as string[],
        loadingEvents: 0,
        modalSeen: false,
        toolbarBusySeen: false,
        toolbarSavingLabelSeen: false,
        observer: null as MutationObserver | null,
        listener: null as EventListener | null,
      };
      const record = () => {
        if (status?.dataset.saveState) probe.states.push(status.dataset.saveState);
        if (document.querySelector('.loading-modal-card')) probe.modalSeen = true;
        const saveButton = document.querySelector<HTMLElement>('[data-testid="chapter-save"]');
        if (saveButton?.getAttribute('aria-busy') === 'true') probe.toolbarBusySeen = true;
        if (saveButton?.textContent?.includes('保存中')) probe.toolbarSavingLabelSeen = true;
      };
      const listener = () => {
        probe.loadingEvents += 1;
        record();
      };
      probe.listener = listener;
      probe.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'data-save-state' &&
            mutation.oldValue
          ) {
            probe.states.push(mutation.oldValue);
          }
        }
        record();
      });
      if (status) {
        probe.observer.observe(status, {
          attributes: true,
          attributeOldValue: true,
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
      window.addEventListener('ai-novel-studio:loading-modal', listener);
      record();
      (window as typeof window & { __saveProbe?: typeof probe }).__saveProbe = probe;
    });

    await (await $('[data-testid="chapter-save"]')).click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const editor = document.querySelector<HTMLTextAreaElement>(
            '[data-testid="chapter-editor"]',
          );
          return editor?.dataset.dirty === 'false' && editor.dataset.saving === 'false';
        }),
      { timeout: 3_000, interval: 25 },
    );

    const bodySave = await browser.execute(() => {
      const owner = window as typeof window & {
        __saveProbe?: {
          states: string[];
          loadingEvents: number;
          modalSeen: boolean;
          toolbarBusySeen: boolean;
          toolbarSavingLabelSeen: boolean;
          observer: MutationObserver | null;
          listener: EventListener | null;
        };
      };
      const probe = owner.__saveProbe;
      probe?.observer?.disconnect();
      if (probe?.listener) {
        window.removeEventListener('ai-novel-studio:loading-modal', probe.listener);
      }
      delete owner.__saveProbe;
      return {
        states: probe?.states ?? [],
        loadingEvents: probe?.loadingEvents ?? -1,
        modalSeen: probe?.modalSeen ?? true,
        toolbarBusySeen: probe?.toolbarBusySeen ?? false,
        toolbarSavingLabelSeen: probe?.toolbarSavingLabelSeen ?? false,
        modalPresent: Boolean(document.querySelector('.loading-modal-card')),
        label: document.querySelector('[data-testid="document-save-status"]')?.textContent ?? '',
      };
    });
    const savingIndex = bodySave.states.indexOf('saving');
    const savedIndex = bodySave.states.lastIndexOf('saved');
    expect(savingIndex).toBeGreaterThanOrEqual(0);
    expect(savedIndex).toBeGreaterThan(savingIndex);
    expect(bodySave.toolbarBusySeen).toBe(true);
    expect(bodySave.toolbarSavingLabelSeen).toBe(true);
    expect(bodySave.loadingEvents).toBe(0);
    expect(bodySave.modalSeen).toBe(false);
    expect(bodySave.modalPresent).toBe(false);
    expect(bodySave.label).toContain('已保存');

    await (await $('button=手动编写')).click();
    await (await $('.editor-info-card textarea')).setValue('主角收到来信，并决定前往钟楼。');
    await browser.execute(() => {
      const owner = window as typeof window & {
        __outlineSaveProbe?: { loadingEvents: number; listener: EventListener };
      };
      const probe: { loadingEvents: number; listener: EventListener } = {
        loadingEvents: 0,
        listener: () => undefined,
      };
      probe.listener = () => {
        probe.loadingEvents += 1;
      };
      owner.__outlineSaveProbe = probe;
      window.addEventListener('ai-novel-studio:loading-modal', probe.listener);
    });
    await (await $('.editor-info-card .btn-primary')).click();
    const outlineSaveFeedback = await waitForTestIdAttribute(
      'outline-save-feedback',
      'data-save-state',
      'saved',
      3_000,
    );
    expect(await outlineSaveFeedback.getAttribute('data-save-state')).toBe('saved');
    const outlineSave = await browser.execute(() => {
      const owner = window as typeof window & {
        __outlineSaveProbe?: { loadingEvents: number; listener: EventListener };
      };
      const probe = owner.__outlineSaveProbe;
      if (probe) window.removeEventListener('ai-novel-studio:loading-modal', probe.listener);
      delete owner.__outlineSaveProbe;
      return {
        loadingEvents: probe?.loadingEvents ?? -1,
        modalPresent: Boolean(document.querySelector('.loading-modal-card')),
      };
    });
    expect(outlineSave.loadingEvents).toBe(0);
    expect(outlineSave.modalPresent).toBe(false);
  });

  it('keeps edited body content and reports an inline error when local persistence fails', async () => {
    const failedBody = '这段正文必须在保存失败后原样保留。\n\n潮声仍在窗外，编辑内容不能被清空。';
    await fillTextareaTestId('chapter-editor', failedBody);
    await browser.execute(() => {
      const owner = window as typeof window & {
        __draftSaveFailureProbe?: {
          originalSetItem: typeof Storage.prototype.setItem;
          loadingEvents: number;
          listener: EventListener;
        };
      };
      const probe = {
        originalSetItem: Storage.prototype.setItem,
        loadingEvents: 0,
        listener: (() => undefined) as EventListener,
      };
      probe.listener = () => {
        probe.loadingEvents += 1;
      };
      owner.__draftSaveFailureProbe = probe;
      window.addEventListener('ai-novel-studio:loading-modal', probe.listener);
      Storage.prototype.setItem = function setItemWithDraftFailure(key, value) {
        if (key.startsWith('ai_novel_studio_drafts_list_')) {
          throw new DOMException('模拟草稿写入失败。', 'QuotaExceededError');
        }
        return probe.originalSetItem.call(this, key, value);
      };
    });

    let failure:
      | {
          content: string;
          dirty: string;
          saveState: string;
          label: string;
          role: string | null;
          loadingEvents: number;
          modalPresent: boolean;
        }
      | undefined;
    try {
      await (await $('[data-testid="chapter-save"]')).click();
      await browser.waitUntil(
        async () =>
          browser.execute(() => {
            const status = document.querySelector<HTMLElement>(
              '[data-testid="document-save-status"]',
            );
            const editor = document.querySelector<HTMLTextAreaElement>(
              '[data-testid="chapter-editor"]',
            );
            return status?.dataset.saveState === 'error' && editor?.dataset.saving === 'false';
          }),
        { timeout: 3_000, interval: 25 },
      );
      failure = await browser.execute(() => {
        const owner = window as typeof window & {
          __draftSaveFailureProbe?: { loadingEvents: number };
        };
        const editor = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="chapter-editor"]',
        );
        const status = document.querySelector<HTMLElement>('[data-testid="document-save-status"]');
        const label = status?.querySelector<HTMLElement>('.statusbar-save-label');
        return {
          content: editor?.value ?? '',
          dirty: editor?.dataset.dirty ?? '',
          saveState: status?.dataset.saveState ?? '',
          label: label?.textContent ?? '',
          role: label?.getAttribute('role') ?? null,
          loadingEvents: owner.__draftSaveFailureProbe?.loadingEvents ?? -1,
          modalPresent: Boolean(document.querySelector('.loading-modal-card')),
        };
      });
    } finally {
      await browser.execute(() => {
        const owner = window as typeof window & {
          __draftSaveFailureProbe?: {
            originalSetItem: typeof Storage.prototype.setItem;
            listener: EventListener;
          };
        };
        const probe = owner.__draftSaveFailureProbe;
        if (probe) {
          Storage.prototype.setItem = probe.originalSetItem;
          window.removeEventListener('ai-novel-studio:loading-modal', probe.listener);
        }
        delete owner.__draftSaveFailureProbe;
      });
    }

    expect(failure?.content).toBe(failedBody);
    expect(failure?.dirty).toBe('true');
    expect(failure?.saveState).toBe('error');
    expect(failure?.label).not.toBe('');
    expect(failure?.label).not.toContain('已保存');
    expect(failure?.role).toBe('alert');
    expect(failure?.loadingEvents).toBe(0);
    expect(failure?.modalPresent).toBe(false);
  });
});
