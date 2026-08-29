import fs from 'node:fs';
import path from 'node:path';
import { $, browser, expect } from '@wdio/globals';

const screenshotDirectory = path.resolve(
  import.meta.dirname,
  '../../test-results/workbench-layout',
);

async function waitForStartupSplashRemoval(): Promise<void> {
  const splash = await $('#startup-splash');
  await splash.waitForExist({ reverse: true });
}

async function seedWorkbenchConversation(): Promise<void> {
  await browser.url('/#/');
  await browser.execute(() => window.localStorage.clear());
  await browser.refresh();
  await (await $('[data-testid="creative-workbench"]')).waitForDisplayed();
  await waitForStartupSplashRemoval();
  await (await $('[data-testid="workbench-tree-loading"]')).waitForExist({ reverse: true });
  await (await $('[data-testid="workbench-loading"]')).waitForExist({ reverse: true });

  await browser.execute(() => {
    const novels = JSON.parse(
      window.localStorage.getItem('ai_novel_studio_novels') ?? '[]',
    ) as Array<Record<string, unknown>>;
    const novel = novels[0];
    if (!novel || typeof novel.id !== 'string') throw new Error('Browser fixture novel missing.');
    const now = '2026-08-27T12:00:00.000Z';
    const chapterId = 'browser-layout-chapter';
    const conversationId = 'browser-layout-conversation';
    const turnId = 'browser-layout-turn';
    const firstRunId = 'browser-layout-run-1';
    const retryRunId = 'browser-layout-run-2';
    novel.currentChapterId = chapterId;
    window.localStorage.setItem('ai_novel_studio_novels', JSON.stringify(novels));
    window.localStorage.setItem(
      'ai_novel_studio_chapters',
      JSON.stringify([
        {
          id: chapterId,
          novelId: novel.id,
          title: '第一章：雾港来信',
          chapterNumber: 1,
          orderIndex: 0,
          sortOrder: 0,
          status: 'outline_ready',
          wordCount: 0,
          currentWords: 0,
          targetWords: 3200,
          drafts: [],
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
    window.localStorage.setItem(
      'ai_novel_studio_task_conversations',
      JSON.stringify({
        bundles: [
          {
            conversation: {
              conversationId,
              novelId: novel.id,
              title: '推进雾港冲突与人物动机',
              status: 'waiting_user',
              defaultModel: {
                providerId: 'mock',
                modelId: 'Mock',
                runtimeMode: 'mock',
                capabilities: ['chat'],
                options: {},
                capturedAt: now,
              },
              createdAt: now,
              updatedAt: now,
            },
            turns: [
              {
                turnId,
                conversationId,
                sequence: 0,
                role: 'user',
                content: '读取当前小说上下文，并核对雾港冲突的推进条件。',
                createdAt: now,
              },
              {
                turnId: 'browser-layout-answer',
                conversationId,
                sequence: 1,
                role: 'assistant',
                content: Array.from(
                  { length: 18 },
                  (_, index) =>
                    `上下文核对 ${index + 1}：人物动机与当前章节目标一致，可以继续推进。`,
                ).join('\n'),
                createdAt: now,
              },
            ],
            runs: [
              {
                runId: firstRunId,
                conversationId,
                turnId,
                workerId: 'browser-layout-worker',
                status: 'failed',
                error: '首次运行读取到过期章节基线，已保留失败证据。',
                modelSnapshot: {
                  providerId: 'mock',
                  modelId: 'Mock-A',
                  runtimeMode: 'mock',
                  capabilities: ['chat'],
                  options: {},
                  capturedAt: now,
                },
                createdAt: now,
                updatedAt: now,
                startedAt: now,
                finishedAt: now,
              },
              {
                runId: retryRunId,
                conversationId,
                turnId,
                workerId: 'browser-layout-worker',
                status: 'completed',
                modelSnapshot: {
                  providerId: 'mock',
                  modelId: 'Mock-B',
                  runtimeMode: 'mock',
                  capabilities: ['chat'],
                  options: {},
                  capturedAt: '2026-08-27T12:00:01.000Z',
                },
                createdAt: '2026-08-27T12:00:01.000Z',
                updatedAt: '2026-08-27T12:00:02.000Z',
                startedAt: '2026-08-27T12:00:01.000Z',
                finishedAt: '2026-08-27T12:00:02.000Z',
              },
            ],
            toolEvents: [
              {
                eventId: 'browser-layout-event-1',
                runId: firstRunId,
                callId: 'browser-layout-call-1',
                sequence: 0,
                toolName: 'chapter.read_outline',
                argumentsSummary: { chapterId },
                status: 'failed',
                durationMs: 42,
                error: '章节基线已变化',
                createdAt: now,
                finishedAt: now,
              },
              {
                eventId: 'browser-layout-event-2',
                runId: retryRunId,
                callId: 'browser-layout-call-2',
                sequence: 0,
                toolName: 'novel.read_context',
                argumentsSummary: { novelId: novel.id },
                status: 'succeeded',
                durationMs: 84,
                result: { chapters: 1, contextReady: true },
                createdAt: '2026-08-27T12:00:01.000Z',
                finishedAt: '2026-08-27T12:00:02.000Z',
              },
            ],
            artifacts: [
              {
                cardId: 'browser-layout-card',
                conversationId,
                turnId,
                runId: retryRunId,
                artifactId: 'browser-layout-artifact',
                artifactType: 'quality_report',
                title: '雾港冲突推进核对',
                summary: '人物动机与章节目标一致，等待你决定是否继续推进。',
                content: '冲突线索、人物动机与当前章节目标均已核对。',
                status: 'candidate',
                createdAt: '2026-08-27T12:00:02.000Z',
              },
            ],
            decisions: [],
            authorizations: [],
          },
        ],
      }),
    );
    window.localStorage.setItem(
      'ai_novel_studio_workbench_selection',
      JSON.stringify({ version: 1, novelId: novel.id, conversationId }),
    );
  });

  await browser.refresh();
  await waitForStartupSplashRemoval();
  await (await $('[data-testid="workbench-task-header"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-composer-input"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-tool-event"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-artifact-card"]')).waitForExist();
}

describe('creative workbench layout', () => {
  before(async () => {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    await seedWorkbenchConversation();
  });

  for (const viewport of [
    { width: 1024, height: 700 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
  ]) {
    it(`keeps the task conversation stable at ${viewport.width}x${viewport.height}`, async () => {
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
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          shellLayout: document.querySelector<HTMLElement>('[data-testid="app-shell"]')?.dataset
            .layout,
          topbarPresent: Boolean(document.querySelector('.app-topbar')),
          rail: rect('.app-sidebar'),
          page: rect('.workbench-page'),
          tree: rect('.workbench-tree'),
          main: rect('.workbench-main'),
          header: rect('.workbench-task-header'),
          headerInner: rect('.workbench-task-header-inner'),
          titleBlock: rect('.workbench-task-title-block'),
          chapterTarget: rect('.workbench-chapter-target'),
          headerActions: rect('.workbench-task-header-actions'),
          messages: rect('.workbench-message-region'),
          turn: rect('.workbench-turn'),
          composer: rect('.workbench-composer'),
          composerSurface: rect('.workbench-composer-surface'),
          tool: rect('.workbench-tool-event'),
          artifact: rect('.workbench-artifact-card'),
          conversationStatus: document.querySelector<HTMLElement>(
            '[data-testid="workbench-conversation-status"]',
          )?.dataset.status,
          runAttempts: Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="workbench-run"]'),
          ).map((node) => node.dataset.runAttempt),
          documentScrollWidth: document.documentElement.scrollWidth,
        };
      });

      const expectedTreeWidth = layout.viewport.width >= 1920 ? 304 : 272;
      expect(layout.shellLayout).toBe('workbench');
      expect(layout.topbarPresent).toBe(false);
      expect(layout.rail.width).toBeGreaterThanOrEqual(55);
      expect(layout.rail.width).toBeLessThanOrEqual(57);
      expect(layout.tree.width).toBeGreaterThanOrEqual(expectedTreeWidth - 1);
      expect(layout.tree.width).toBeLessThanOrEqual(expectedTreeWidth + 1);
      const availableMainWidth = layout.viewport.width - layout.rail.width - layout.tree.width;
      expect(layout.main.width).toBeGreaterThanOrEqual(640);
      expect(Math.abs(layout.main.width - availableMainWidth)).toBeLessThanOrEqual(2);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.page.right).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.header.bottom).toBeLessThanOrEqual(layout.messages.top + 1);
      expect(layout.messages.bottom).toBeLessThanOrEqual(layout.composer.top + 1);
      expect(layout.composer.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
      expect(layout.messages.height).toBeGreaterThan(220);
      const turnCenter = (layout.turn.left + layout.turn.right) / 2;
      const headerCenter = (layout.headerInner.left + layout.headerInner.right) / 2;
      const composerCenter = (layout.composerSurface.left + layout.composerSurface.right) / 2;
      // A classic Windows scrollbar consumes 15px from the message viewport.
      expect(Math.abs(turnCenter - composerCenter)).toBeLessThanOrEqual(8);
      expect(Math.abs(headerCenter - composerCenter)).toBeLessThanOrEqual(8);
      expect(Math.abs(layout.turn.width - layout.composerSurface.width)).toBeLessThanOrEqual(16);
      expect(Math.abs(layout.headerInner.width - layout.composerSurface.width)).toBeLessThanOrEqual(
        16,
      );
      expect(layout.headerInner.width).toBeLessThanOrEqual(1081);
      expect(layout.titleBlock.width).toBeGreaterThanOrEqual(159);
      expect(layout.chapterTarget.scrollWidth).toBeLessThanOrEqual(
        layout.chapterTarget.clientWidth + 1,
      );
      const overlaps = (first: typeof layout.titleBlock, second: typeof layout.chapterTarget) =>
        first.left < second.right &&
        first.right > second.left &&
        first.top < second.bottom &&
        first.bottom > second.top;
      expect(overlaps(layout.titleBlock, layout.chapterTarget)).toBe(false);
      expect(overlaps(layout.chapterTarget, layout.headerActions)).toBe(false);
      expect(layout.tool.scrollWidth).toBeLessThanOrEqual(layout.tool.clientWidth + 1);
      expect(layout.artifact.scrollWidth).toBeLessThanOrEqual(layout.artifact.clientWidth + 1);
      expect(layout.conversationStatus).toBe('waiting_user');
      expect(layout.runAttempts).toEqual(['1', '2']);

      await browser.saveScreenshot(
        path.join(screenshotDirectory, `workbench-${viewport.width}x${viewport.height}.png`),
      );
    });
  }

  it('keeps the new-task flow usable in the minimum desktop viewport', async () => {
    await browser.setWindowSize(1024, 700);
    const createTaskTrigger = await $('[data-testid="workbench-create-task"]');
    await createTaskTrigger.click();
    await (await $('[data-testid="workbench-task-creator"]')).waitForDisplayed();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const dialog = document.querySelector<HTMLElement>(
            '[data-testid="workbench-task-creator"]',
          );
          return Boolean(
            dialog &&
            dialog
              .getAnimations({ subtree: true })
              .every((animation) => ['finished', 'idle'].includes(animation.playState)),
          );
        }),
      { timeout: 1_000, interval: 20, timeoutMsg: 'Task creator animation did not settle.' },
    );

    const modalLayout = await browser.execute(() => {
      const dialog = document.querySelector<HTMLElement>('[data-testid="workbench-task-creator"]');
      const actions = dialog?.querySelector<HTMLElement>('.workbench-task-creator-actions');
      const goal = dialog?.querySelector<HTMLTextAreaElement>('textarea');
      const modelControl = dialog?.querySelector<HTMLElement>('.workbench-model-control');
      const modelLabel = dialog?.querySelector<HTMLElement>('.workbench-model-label');
      const modelSelect = dialog?.querySelector<HTMLSelectElement>(
        '[data-testid="workbench-new-task-model-select"]',
      );
      if (!dialog || !actions || !goal || !modelControl || !modelLabel || !modelSelect) {
        throw new Error('New-task dialog fixture is incomplete.');
      }
      const dialogRect = dialog.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const goalRect = goal.getBoundingClientRect();
      const modelControlRect = modelControl.getBoundingClientRect();
      const modelLabelRect = modelLabel.getBoundingClientRect();
      const modelSelectRect = modelSelect.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dialog: {
          left: dialogRect.left,
          right: dialogRect.right,
          top: dialogRect.top,
          bottom: dialogRect.bottom,
          scrollHeight: dialog.scrollHeight,
          clientHeight: dialog.clientHeight,
        },
        actionsTop: actionsRect.top,
        goalBottom: goalRect.bottom,
        modelControl: {
          left: modelControlRect.left,
          right: modelControlRect.right,
        },
        modelLabel: {
          top: modelLabelRect.top,
          bottom: modelLabelRect.bottom,
          height: modelLabelRect.height,
          lineHeight: Number.parseFloat(getComputedStyle(modelLabel).lineHeight),
          whiteSpace: getComputedStyle(modelLabel).whiteSpace,
        },
        modelSelect: {
          left: modelSelectRect.left,
          right: modelSelectRect.right,
          top: modelSelectRect.top,
        },
        inertBackgroundCount: document.querySelectorAll('.workbench-page > [inert]').length,
        focusInsideDialog: dialog.contains(document.activeElement),
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    await browser.saveScreenshot(path.join(screenshotDirectory, 'workbench-new-task-1024x700.png'));
    await (await $('button[aria-label="关闭新建任务"]')).click();
    await (await $('[data-testid="workbench-task-creator"]')).waitForExist({ reverse: true });
    await browser.waitUntil(async () => createTaskTrigger.isFocused());
    const focusRestored = await createTaskTrigger.isFocused();

    expect(modalLayout.dialog.left).toBeGreaterThanOrEqual(15);
    expect(modalLayout.dialog.right).toBeLessThanOrEqual(modalLayout.viewport.width - 15);
    expect(modalLayout.dialog.top).toBeGreaterThanOrEqual(15);
    expect(modalLayout.dialog.bottom).toBeLessThanOrEqual(modalLayout.viewport.height - 15);
    expect(modalLayout.dialog.scrollHeight).toBeLessThanOrEqual(
      modalLayout.dialog.clientHeight + 1,
    );
    expect(modalLayout.goalBottom).toBeLessThanOrEqual(modalLayout.actionsTop);
    expect(modalLayout.modelLabel.whiteSpace).toBe('nowrap');
    expect(modalLayout.modelLabel.height).toBeLessThanOrEqual(
      modalLayout.modelLabel.lineHeight + 1,
    );
    expect(modalLayout.modelLabel.bottom).toBeLessThanOrEqual(modalLayout.modelSelect.top);
    expect(modalLayout.modelSelect.left).toBeGreaterThanOrEqual(modalLayout.modelControl.left - 1);
    expect(modalLayout.modelSelect.right).toBeLessThanOrEqual(modalLayout.modelControl.right + 1);
    expect(modalLayout.inertBackgroundCount).toBeGreaterThanOrEqual(2);
    expect(modalLayout.focusInsideDialog).toBe(true);
    expect(modalLayout.documentScrollWidth).toBeLessThanOrEqual(modalLayout.viewport.width);
    expect(focusRestored).toBe(true);
  });

  it('supports keyboard navigation in task menus', async () => {
    await browser.setWindowSize(1024, 700);
    const trigger = await $('.workbench-task-menu-trigger');
    expect(await trigger.getAttribute('aria-haspopup')).toBe('menu');
    await trigger.click();
    await (await $('[role="menu"]')).waitForDisplayed();
    await browser.waitUntil(async () =>
      browser.execute(() => document.activeElement?.getAttribute('role') === 'menuitem'),
    );
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe('重命名');

    await browser.execute(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    );
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      '归档任务',
    );

    await browser.execute(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    await (await $('[role="menu"]')).waitForExist({ reverse: true });
    await browser.waitUntil(async () => trigger.isFocused());
  });

  it('docks the latest-progress action outside the scroll viewport', async () => {
    await browser.setWindowSize(1024, 700);
    const messageList = await $('[data-testid="workbench-message-list"]');
    const isScrollable = await browser.execute(
      (node) => node.scrollHeight > node.clientHeight,
      messageList,
    );
    expect(isScrollable).toBe(true);
    await browser.execute((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, messageList);

    const input = await $('[data-testid="workbench-composer-input"]');
    await input.setValue('你能做什么？');
    const send = await $('[data-testid="workbench-send-task"]');
    await send.waitForEnabled({ timeout: 30_000 });
    await send.click();

    const dock = await $('[data-testid="workbench-latest-dock"]');
    await dock.waitForDisplayed({ timeout: 30_000 });
    const layout = await browser.execute(() => {
      const region = document.querySelector<HTMLElement>('.workbench-message-region');
      const list = document.querySelector<HTMLElement>('[data-testid="workbench-message-list"]');
      const latestDock = document.querySelector<HTMLElement>(
        '[data-testid="workbench-latest-dock"]',
      );
      if (!region || !list || !latestDock) throw new Error('Latest-progress dock is incomplete.');
      const regionRect = region.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const dockRect = latestDock.getBoundingClientRect();
      return {
        regionBottom: regionRect.bottom,
        listBottom: listRect.bottom,
        dockTop: dockRect.top,
        dockBottom: dockRect.bottom,
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layout.listBottom).toBeLessThanOrEqual(layout.dockTop + 1);
    expect(layout.dockBottom).toBeLessThanOrEqual(layout.regionBottom + 1);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    await browser.saveScreenshot(
      path.join(screenshotDirectory, 'workbench-latest-dock-1024x700.png'),
    );

    await (await $('button=查看最新进展')).click();
    await dock.waitForExist({ reverse: true });
  });

  it('keeps model recovery actions usable without blocking local replies', async () => {
    await browser.setWindowSize(1024, 700);
    await browser.execute(() => {
      window.localStorage.setItem(
        'ai_novel_studio_ai_settings',
        JSON.stringify({
          runtimeMode: 'api',
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          modelName: 'deepseek-chat',
        }),
      );
    });
    await browser.refresh();
    await waitForStartupSplashRemoval();
    await (await $('[data-testid="workbench-task-header"]')).waitForDisplayed();
    const recovery = await $('[data-testid="workbench-model-directory-status"]');
    await recovery.waitForDisplayed();

    const input = await $('[data-testid="workbench-composer-input"]');
    const send = await $('[data-testid="workbench-send-task"]');
    await input.setValue('继续生成本章正文');
    expect(await send.isEnabled()).toBe(false);
    await input.setValue('你能做什么？');
    expect(await send.isEnabled()).toBe(true);

    const layout = await browser.execute(() => {
      const composer = document.querySelector<HTMLElement>('.workbench-composer');
      const notice = document.querySelector<HTMLElement>(
        '[data-testid="workbench-model-directory-status"]',
      );
      const actions = notice?.querySelector<HTMLElement>('.workbench-recovery-actions');
      const retry = document.querySelector<HTMLButtonElement>(
        '[data-testid="workbench-model-directory-status-retry"]',
      );
      const settings = document.querySelector<HTMLButtonElement>(
        '[data-testid="workbench-model-directory-status-settings"]',
      );
      if (!composer || !notice || !actions || !retry || !settings) {
        throw new Error('Model recovery fixture is incomplete.');
      }
      const composerRect = composer.getBoundingClientRect();
      const noticeRect = notice.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        composerBottom: composerRect.bottom,
        noticeRight: noticeRect.right,
        actionsBottom: actionsRect.bottom,
        noticeBottom: noticeRect.bottom,
        noticeScrollWidth: notice.scrollWidth,
        noticeClientWidth: notice.clientWidth,
        retryVisible: retry.getBoundingClientRect().width > 0,
        settingsVisible: settings.getBoundingClientRect().width > 0,
      };
    });

    expect(layout.composerBottom).toBeLessThanOrEqual(701);
    expect(layout.noticeRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.actionsBottom).toBeLessThanOrEqual(layout.noticeBottom + 1);
    expect(layout.noticeScrollWidth).toBeLessThanOrEqual(layout.noticeClientWidth + 1);
    expect(layout.retryVisible).toBe(true);
    expect(layout.settingsVisible).toBe(true);

    await browser.saveScreenshot(
      path.join(screenshotDirectory, 'workbench-model-recovery-1024x700.png'),
    );
    await browser.execute(() => window.localStorage.removeItem('ai_novel_studio_ai_settings'));
  });

  it('restores the standard desktop shell away from the workbench route', async () => {
    await browser.setWindowSize(1440, 900);
    await browser.url('/#/settings');
    await waitForStartupSplashRemoval();
    await (await $('.settings-sidebar')).waitForDisplayed();
    await browser.waitUntil(async () => {
      const width = await browser.execute(
        () =>
          document.querySelector<HTMLElement>('.app-sidebar')?.getBoundingClientRect().width ?? 0,
      );
      return width >= 219;
    });
    const shell = await browser.execute(() => {
      const sidebar = document.querySelector<HTMLElement>('.app-sidebar');
      const topbar = document.querySelector<HTMLElement>('.app-topbar');
      return {
        layout: document.querySelector<HTMLElement>('[data-testid="app-shell"]')?.dataset.layout,
        sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
        topbarVisible: Boolean(topbar && topbar.getBoundingClientRect().height > 0),
      };
    });
    expect(shell.layout).toBe('standard');
    expect(shell.sidebarWidth).toBeGreaterThanOrEqual(219);
    expect(shell.sidebarWidth).toBeLessThanOrEqual(221);
    expect(shell.topbarVisible).toBe(true);
  });
});
