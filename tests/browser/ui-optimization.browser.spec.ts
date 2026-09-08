import fs from 'node:fs';
import path from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';

const NOVEL_ID = 'ui-optimization-novel';
const VOLUME_ID = 'ui-optimization-volume';
const TASK_A = 'ui-optimization-task-a';
const TASK_B = 'ui-optimization-task-b';
const screenshotDirectory = path.resolve(import.meta.dirname, '../../test-results/ui-optimization');
const longGoal = `  ${'保留人物动机、章节目标和已确认的情节约束。'.repeat(25)}\n${'要求逐段审阅，不直接采用。'.repeat(40)}\n保留末尾空格。  `;
const metrics: Array<Record<string, unknown>> = [];

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
  await browser.waitUntil(async () =>
    browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
  );
}

async function waitForWorkbench(): Promise<void> {
  await (await $('[data-testid="creative-workbench"]')).waitForDisplayed();
  await (await $('#startup-splash')).waitForExist({ reverse: true });
  await (await $('[data-testid="workbench-tree-loading"]')).waitForExist({ reverse: true });
  await (await $('[data-testid="workbench-loading"]')).waitForExist({ reverse: true });
}

async function installNetworkGuard(): Promise<void> {
  await browser.execute(() => {
    const state = { externalRequests: 0 };
    (window as Window & { __uiOptimizationProbe?: typeof state }).__uiOptimizationProbe = state;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      );
      if (url.origin !== location.origin) {
        state.externalRequests += 1;
        return Promise.reject(
          new Error('External requests are forbidden in isolated UI acceptance.'),
        );
      }
      return original(input, init);
    };
  });
}

async function seed(theme: 'light' | 'dark' = 'light'): Promise<void> {
  await browser.url('/#/');
  await browser.execute(() => {
    if (
      location.hostname !== '127.0.0.1' ||
      '__TAURI__' in window ||
      '__TAURI_INTERNALS__' in window ||
      '__TAURI_IPC__' in window
    ) {
      throw new Error(
        'UI acceptance requires isolated loopback browser storage, never a desktop bridge.',
      );
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await browser.refresh();
  await waitForWorkbench();
  await browser.execute(
    (novelId, volumeId, taskA, taskB, preference) => {
      const now = '2026-09-05T08:00:00.000Z';
      const model = {
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock',
        capabilities: ['chat'],
        options: {},
        capturedAt: now,
      };
      sessionStorage.clear();
      localStorage.setItem('ai_novel_studio_theme_preference', preference);
      localStorage.setItem(
        'ai_novel_studio_novels',
        JSON.stringify([
          {
            id: novelId,
            title: '千章长篇界面验收',
            genre: '隔离测试',
            description: '仅用于浏览器UI验证，不调用模型。',
            status: 'planning',
            currentVolumeId: volumeId,
            currentChapterId: 'ui-chapter-1',
            totalWords: 0,
            targetWords: 400000,
            createdAt: now,
            updatedAt: now,
          },
        ]),
      );
      localStorage.setItem(
        'ai_novel_studio_volumes',
        JSON.stringify([
          {
            id: volumeId,
            novelId,
            title: '第一卷',
            volumeNumber: 1,
            orderIndex: 0,
            sortOrder: 0,
            status: 'planned',
            createdAt: now,
            updatedAt: now,
          },
        ]),
      );
      localStorage.setItem(
        'ai_novel_studio_chapters',
        JSON.stringify(
          Array.from({ length: 1000 }, (_, index) => ({
            id: `ui-chapter-${index + 1}`,
            novelId,
            volumeId,
            chapterNumber: index + 1,
            orderIndex: index,
            sortOrder: index,
            title:
              index === 998
                ? '雾港终局：保留全部超长标题以验证选择器与正文导航的边界'
                : `航行记录${index + 1}`,
            outline: '隔离大纲，仅验证章节定位。',
            goal: '不触发正文生成或采用',
            status: 'not_started',
            drafts: [],
            wordCount: 0,
            currentWords: 0,
            targetWords: 4000,
            createdAt: now,
            updatedAt: now,
          })),
        ),
      );
      const bundle = (conversationId: string, letter: string) => ({
        conversation: {
          conversationId,
          novelId,
          title: `任务${letter}：审阅人物与保护草稿`,
          status: 'waiting_user',
          defaultModel: model,
          createdAt: now,
          updatedAt: now,
        },
        turns: [
          {
            turnId: `turn-${letter}`,
            conversationId,
            sequence: 0,
            role: 'user',
            content: '生成人物候选',
            createdAt: now,
          },
        ],
        // A real waiting-for-review projection already has a finished run.
        // An orphan user chapter goal is intentionally recoverable by the app
        // and is not a stationary review fixture.
        runs: [
          {
            runId: `ui-run-${letter}`,
            turnId: `turn-${letter}`,
            conversationId,
            workerId: 'ui-optimization-fixture',
            status: 'completed',
            modelSnapshot: model,
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
          },
        ],
        toolEvents: [],
        artifacts: [
          {
            cardId: `ui-card-${letter}`,
            artifactId: `ui-artifact-${letter}`,
            conversationId,
            turnId: `turn-${letter}`,
            runId: `ui-run-${letter}`,
            artifactType: 'character_candidates',
            title: `任务${letter}人物候选`,
            summary: '原始候选等待人工审阅，不自动应用。',
            content: JSON.stringify({
              characters: [
                { id: 'first', name: `${letter}岑舟`, summary: '保留原始人物身份和动机。' },
                { id: 'second', name: `${letter}白榆`, summary: '另一位不可变候选。' },
              ],
            }),
            status: 'candidate',
            createdAt: now,
          },
        ],
        decisions: [],
        authorizations: [],
      });
      localStorage.setItem(
        'ai_novel_studio_task_conversations',
        JSON.stringify({ bundles: [bundle(taskA, 'A'), bundle(taskB, 'B')] }),
      );
      localStorage.setItem(
        'ai_novel_studio_workbench_selection',
        JSON.stringify({ version: 1, novelId, conversationId: taskA }),
      );
    },
    NOVEL_ID,
    VOLUME_ID,
    TASK_A,
    TASK_B,
    theme,
  );
  await browser.refresh();
  await waitForWorkbench();
  await (await $('[data-testid="workbench-task-header"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-artifact-candidates"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-chapter-select"]')).waitForDisplayed();
  await installNetworkGuard();
}

async function assertNoExecution(): Promise<void> {
  const state = await browser.execute(() => {
    const stored = JSON.parse(
      localStorage.getItem('ai_novel_studio_task_conversations') ?? '{"bundles":[]}',
    ) as {
      bundles: Array<{
        turns: unknown[];
        runs: unknown[];
        decisions: unknown[];
        authorizations: unknown[];
      }>;
    };
    return {
      bridge: '__TAURI__' in window || '__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window,
      requests: (window as Window & { __uiOptimizationProbe?: { externalRequests: number } })
        .__uiOptimizationProbe?.externalRequests,
      tasks: stored.bundles.map((bundle) => ({
        turns: bundle.turns.length,
        runs: bundle.runs.length,
        decisions: bundle.decisions.length,
        authorizations: bundle.authorizations.length,
      })),
    };
  });
  expect(state.bridge).toBe(false);
  expect(state.requests).toBe(0);
  expect(state.tasks).toEqual([
    { turns: 1, runs: 1, decisions: 0, authorizations: 0 },
    { turns: 1, runs: 1, decisions: 0, authorizations: 0 },
  ]);
}

async function screenshot(name: string): Promise<void> {
  await browser.saveScreenshot(path.join(screenshotDirectory, `${name}.png`));
}

describe('UI optimization browser acceptance', () => {
  before(() => fs.mkdirSync(screenshotDirectory, { recursive: true }));
  after(() =>
    fs.writeFileSync(
      path.join(screenshotDirectory, 'layout-metrics.json'),
      JSON.stringify(metrics, null, 2),
    ),
  );
  afterEach(async function () {
    if (this.currentTest?.state === 'failed') {
      await screenshot(
        `failed-${this.currentTest.title.replace(/[^a-z\d]+/gi, '-').slice(0, 110)}`,
      );
    }
  });

  for (const viewport of [
    { width: 1024, height: 700 },
    { width: 1280, height: 820 },
    { width: 2560, height: 1440 },
  ]) {
    it(`protects a long goal, template undo and chapter selection at ${viewport.width} logical pixels`, async () => {
      await seed();
      await setViewport(viewport.width, viewport.height);
      const input = await $('[data-testid="workbench-composer-input"]');
      await input.setValue(longGoal);
      await expect(input).toHaveValue(longGoal, { trim: false });
      await expect(input).toHaveAttribute('aria-label', '创作目标');
      const layout = await browser.execute(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="workbench-composer-input"]',
        )!;
        const selectors = [
          '.workbench-main',
          '.workbench-task-header',
          '.workbench-chapter-target',
          '.workbench-chapter-target .chapter-locator',
          '.workbench-chapter-target input',
          '#workbench-chapter-select',
          '.workbench-composer',
          '.workbench-composer-surface',
        ];
        const style = getComputedStyle(textarea);
        const boxes = selectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return {
            selector,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          };
        });
        return {
          width: innerWidth,
          height: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          inputHeight: textarea.getBoundingClientRect().height,
          lineHeight: parseFloat(style.lineHeight),
          padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
          inputScroll: textarea.scrollHeight,
          inputClient: textarea.clientHeight,
          boxes,
        };
      });
      metrics.push({ scenario: 'long-goal', ...layout });
      await screenshot(`long-goal-${viewport.width}`);
      expect(layout.width).toBe(viewport.width);
      expect(layout.height).toBe(viewport.height);
      expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(layout.inputHeight).toBeGreaterThanOrEqual(layout.lineHeight * 2 + layout.padding - 1);
      expect(layout.inputHeight).toBeLessThanOrEqual(
        Math.min(layout.lineHeight * 8 + layout.padding, viewport.height * 0.3) + 2,
      );
      expect(layout.inputScroll).toBeGreaterThan(layout.inputClient);
      for (const box of layout.boxes) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
      }
      // Templates live in the composer "+" menu; open it before using the chips.
      await (await $('[data-testid="workbench-composer-attach"]')).click();
      await (await $('[data-testid="workbench-template-generate-chapter"]')).waitForDisplayed();
      await (await $('[data-testid="workbench-template-generate-chapter"]')).click();
      await expect(input).toHaveValue(longGoal, { trim: false });
      await (await $('button=替换目标')).click();
      await expect(input).toHaveValue('生成下一章');
      await (await $('button=撤销模板')).click();
      await expect(input).toHaveValue(longGoal, { trim: false });
      await (await $('.workbench-template-more > summary')).click();
      await (await $('[data-testid="workbench-template-events"]')).waitForDisplayed();
      await (await $('[data-testid="workbench-template-events"]')).click();
      await (await $('button=追加到目标')).click();
      await expect(input).toHaveValue(`${longGoal}\n\n生成本章剧情事件候选`, { trim: false });
      await (await $('button=撤销模板')).click();
      await expect(input).toHaveValue(longGoal, { trim: false });
      await (await $('.workbench-template-more > summary')).click();
      const chapterSearch = await $('.workbench-chapter-target input[type="search"]');
      expect((await $$('#workbench-chapter-select option')).length).toBeLessThanOrEqual(81);
      await chapterSearch.setValue('第999章');
      await expect($('.workbench-chapter-target [role="status"]')).toHaveText('匹配 1 章');
      await chapterSearch.click();
      await browser.keys('Enter');
      await expect($('#workbench-chapter-select')).toHaveValue('ui-chapter-999');
      await expect(input).toHaveValue(longGoal, { trim: false });
      await screenshot(`chapter-selected-${viewport.width}`);
      await assertNoExecution();
    });
  }

  it('protects creator text, preserves IME composition and restores focus without executing', async () => {
    await seed();
    await setViewport(1024, 700);
    const composer = await $('[data-testid="workbench-composer-input"]');
    await composer.setValue('你能做什么？');
    await expect($('[data-testid="workbench-send-task"]')).toBeEnabled();
    await browser.execute(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="workbench-composer-input"]',
      )!;
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, keyCode: 229, bubbles: true }),
      );
    });
    await expect(composer).toHaveValue('你能做什么？');
    const trigger = await $('[data-testid="workbench-create-task"]');
    await trigger.click();
    const goal = await $('[data-testid="workbench-new-task-goal"]');
    await goal.waitForDisplayed();
    await goal.setValue(longGoal.slice(0, 550));
    const original = await goal.getValue();
    const common = await $(
      '.workbench-task-creator [data-testid="workbench-template-generate-chapter"]',
    );
    await common.click();
    await expect(goal).toHaveValue(original, { trim: false });
    await (await (await $('.workbench-task-creator')).$('button=替换目标')).click();
    await expect(goal).toHaveValue('生成下一章');
    await (await (await $('.workbench-task-creator')).$('button=撤销模板')).click();
    await expect(goal).toHaveValue(original, { trim: false });
    await goal.setValue('你能做什么？');
    await expect($('[data-testid="workbench-create-and-start"]')).toBeEnabled();
    await browser.execute(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="workbench-new-task-goal"]',
      )!;
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, keyCode: 229, bubbles: true }),
      );
    });
    await expect($('[data-testid="workbench-task-creator"]')).toBeDisplayed();
    await screenshot('new-task-input-protection-1024');
    await (await $('button[aria-label="关闭新建任务"]')).click();
    await trigger.waitUntil(async () => trigger.isFocused());
    await expect(composer).toHaveValue('你能做什么？');
    await assertNoExecution();
  });

  it('retains unsent candidate notes across task A-B-A while showing one whole-card action', async () => {
    await seed();
    await setViewport(1280, 820);
    const first = (await $$('[data-testid="workbench-artifact-candidate"]'))[0];
    await (await first.$('[data-testid="workbench-artifact-candidate-edit"]')).click();
    await (
      await (await first.$('label*=补充要求')).$('textarea')
    ).setValue('只属于任务A的未带出意见，保持全部原始候选不变。');
    await expect($('[data-testid="workbench-artifact-revise"]')).toHaveText('带出全部意见（1）');
    expect(await $$('[data-testid="workbench-artifact-candidate-revise"]')).toHaveLength(0);
    await (await $(`[data-testid="workbench-task"][data-conversation-id="${TASK_B}"]`)).click();
    await expect($('[data-testid="workbench-task-header"]')).toHaveAttribute(
      'data-conversation-id',
      TASK_B,
    );
    const second = (await $$('[data-testid="workbench-artifact-candidate"]'))[0];
    await (await second.$('[data-testid="workbench-artifact-candidate-edit"]')).click();
    const secondNotes = await (await second.$('label*=补充要求')).$('textarea');
    await expect(secondNotes).toHaveValue('');
    await secondNotes.setValue('只属于任务B的意见');
    await (await $(`[data-testid="workbench-task"][data-conversation-id="${TASK_A}"]`)).click();
    await expect($('[data-testid="workbench-task-header"]')).toHaveAttribute(
      'data-conversation-id',
      TASK_A,
    );
    const restored = (await $$('[data-testid="workbench-artifact-candidate"]'))[0];
    await (await restored.$('[data-testid="workbench-artifact-candidate-edit"]')).click();
    await expect((await restored.$('label*=补充要求')).$('textarea')).toHaveValue(
      '只属于任务A的未带出意见，保持全部原始候选不变。',
    );
    await expect(restored.$('.workbench-artifact-candidate-title')).toHaveText('A岑舟');
    await screenshot('candidate-notes-a-b-a');
    await assertNoExecution();
  });

  it('finds a distant chapter in a 1000-chapter tree and returns to it without losing the 80-row bound', async () => {
    await seed();
    await browser.url(`/#/novels/${NOVEL_ID}/workspace?chapterId=ui-chapter-1`);
    await (await $('[data-testid="chapter-item"]')).waitForDisplayed();
    await installNetworkGuard();
    for (const viewport of [
      { width: 1024, height: 700 },
      { width: 1280, height: 820 },
      { width: 2560, height: 1440 },
    ]) {
      await setViewport(viewport.width, viewport.height);
      const search = await $('.workspace-chapter-locator input[type="search"]');
      await search.setValue('第999章');
      const result = await $('.chapter-locator-results button');
      await expect(result).toHaveText(expect.stringContaining('第999章'));
      await result.click();
      const active = await $('[data-testid="chapter-item"][data-chapter-id="ui-chapter-999"]');
      await expect(active).toHaveAttribute('data-active', 'true');
      expect((await $$('[data-testid="chapter-item"]')).length).toBe(80);
      await (await (await $('.tree-window-controls')).$('button=上一批')).click();
      await expect(
        $('[data-testid="chapter-item"][data-chapter-id="ui-chapter-999"]'),
      ).not.toBeExisting();
      await (await (await $('.workspace-chapter-locator')).$('button=返回当前章')).click();
      await expect(active).toHaveAttribute('data-active', 'true');
      expect((await $$('[data-testid="chapter-item"]')).length).toBe(80);
      const geometry = await browser.execute(() => {
        const root = document.querySelector<HTMLElement>('.workspace-chapter-locator')!;
        const rect = root.getBoundingClientRect();
        return {
          width: innerWidth,
          height: innerHeight,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      metrics.push({ scenario: 'chapter-tree', ...geometry });
      await screenshot(`chapter-tree-${viewport.width}`);
      expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    }
    await assertNoExecution();
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`keeps useful workbench text legible in the ${theme} palette`, async () => {
      await seed(theme);
      await setViewport(1280, 820);
      await (await $('[data-testid="workbench-composer-input"]')).setValue('尚未发送的创作目标');
      const report = await browser.execute(() => {
        const color = (value: string): number[] => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const over = (foreground: number[], background: number[]): number[] => {
          const alpha = foreground[3] / 255;
          return [0, 1, 2]
            .map((index) => foreground[index] * alpha + background[index] * (1 - alpha))
            .concat(255);
        };
        const luminance = (rgba: number[]) =>
          rgba
            .slice(0, 3)
            .map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const samples = [
          '[data-testid="workbench-composer-input"]',
          '.workbench-task-copy time',
          '.workbench-template-chip:not(:disabled)',
          '.workbench-artifact-candidate-summary',
          '.workbench-artifact-apply-scope',
        ].map((selector) => {
          const target = document.querySelector<HTMLElement>(selector)!;
          const ancestors: HTMLElement[] = [];
          for (let node: HTMLElement | null = target; node; node = node.parentElement)
            ancestors.unshift(node);
          const background = ancestors.reduce(
            (composite, node) => over(color(getComputedStyle(node).backgroundColor), composite),
            [255, 255, 255, 255],
          );
          const style = getComputedStyle(target);
          const foreground = over(color(style.color), background);
          const first = luminance(foreground),
            second = luminance(background);
          return {
            selector,
            foreground,
            background,
            ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
            fontSize: parseFloat(style.fontSize),
          };
        });
        return { theme: document.documentElement.dataset.effectiveTheme, samples };
      });
      metrics.push({ scenario: 'text-contrast', ...report });
      await screenshot(`workbench-palette-${theme}`);
      expect(report.theme).toBe(theme);
      for (const sample of report.samples) {
        expect(sample.fontSize).toBeGreaterThanOrEqual(12);
        expect(sample.ratio).toBeGreaterThanOrEqual(4.5);
      }
      await assertNoExecution();
    });
  }
});
