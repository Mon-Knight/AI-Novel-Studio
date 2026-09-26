import fs from 'node:fs';
import path from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { expectUnifiedIconLanguage } from './iconLanguage';
import {
  boxesOverlap,
  readCenterHits,
  recordRound2Metrics,
  resetRound2Metrics,
  setExactViewport,
  takeRound2Screenshot,
  waitForStableBoxSet,
  waitForStableWorkbenchBoxes,
} from './workbenchGeometry';

const screenshotDirectory = path.resolve(
  import.meta.dirname,
  '../../test-results/workbench-layout',
);
const sourceDirectory = path.resolve(import.meta.dirname, '../../src');
/** Keeps this spec's round-two geometry evidence separate from the other browser specs. */
const round2SpecId = 'workbench-layout';

function cssFilesWithTransitionAll(): string[] {
  const transitionAllPattern = /\btransition\s*:\s*all(?:\s|;|$)/i;
  return (fs.readdirSync(sourceDirectory, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((relativePath) => relativePath.endsWith('.css'))
    .filter((relativePath) =>
      transitionAllPattern.test(fs.readFileSync(path.join(sourceDirectory, relativePath), 'utf8')),
    )
    .map((relativePath) => relativePath.replaceAll('\\', '/'));
}

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

/**
 * Round-two presentation fixture: two consecutive successful reads (one collapsed disclosure
 * group), a failed read and an active read that must both stay visible, plus one candidate card
 * carrying real evidence so name, target, source disclosure and next step can be measured.
 */
async function seedRound2PresentationConversation(): Promise<void> {
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
    const now = '2026-09-10T08:00:00.000Z';
    const chapterId = 'browser-round2-chapter';
    const conversationId = 'browser-round2-conversation';
    const turnId = 'browser-round2-turn';
    const runId = 'browser-round2-run';
    const model = {
      providerId: 'mock',
      modelId: 'Mock',
      runtimeMode: 'mock',
      capabilities: ['chat'],
      options: {},
      capturedAt: now,
    };
    novel.currentChapterId = chapterId;
    window.localStorage.setItem('ai_novel_studio_novels', JSON.stringify(novels));
    window.localStorage.setItem(
      'ai_novel_studio_chapters',
      JSON.stringify([
        {
          id: chapterId,
          novelId: novel.id,
          title: '第二章：潮汐之前',
          chapterNumber: 2,
          orderIndex: 1,
          sortOrder: 1,
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
              title: '第二轮读取分组与候选卡片',
              status: 'running',
              defaultModel: model,
              createdAt: now,
              updatedAt: now,
            },
            turns: [
              {
                turnId,
                conversationId,
                sequence: 0,
                role: 'user',
                content: '读取上下文并核对候选来源。',
                createdAt: now,
              },
            ],
            runs: [
              {
                runId,
                conversationId,
                turnId,
                workerId: 'browser-round2-worker',
                status: 'running',
                modelSnapshot: model,
                createdAt: '2026-09-10T08:00:01.000Z',
                updatedAt: '2026-09-10T08:00:09.000Z',
                startedAt: '2026-09-10T08:00:01.000Z',
              },
            ],
            toolEvents: [
              {
                eventId: 'browser-round2-read-a',
                runId,
                callId: 'browser-round2-call-a',
                sequence: 0,
                toolName: 'novel.read_context',
                argumentsSummary: { scope: 'novel' },
                status: 'succeeded',
                durationMs: 210,
                result: { chapters: 2, contextReady: true },
                createdAt: '2026-09-10T08:00:02.000Z',
                finishedAt: '2026-09-10T08:00:03.000Z',
              },
              {
                eventId: 'browser-round2-read-b',
                runId,
                callId: 'browser-round2-call-b',
                sequence: 1,
                toolName: 'structure.read',
                argumentsSummary: { scope: 'outline' },
                status: 'succeeded',
                durationMs: 320,
                result: { volumes: 1, chapters: 2 },
                createdAt: '2026-09-10T08:00:04.000Z',
                finishedAt: '2026-09-10T08:00:05.000Z',
              },
              {
                eventId: 'browser-round2-read-failed',
                runId,
                callId: 'browser-round2-call-c',
                sequence: 2,
                toolName: 'memory.search',
                argumentsSummary: { scope: 'memory' },
                status: 'failed',
                durationMs: 42,
                error: '检索失败不得折叠',
                createdAt: '2026-09-10T08:00:06.000Z',
                finishedAt: '2026-09-10T08:00:07.000Z',
              },
              {
                eventId: 'browser-round2-read-running',
                runId,
                callId: 'browser-round2-call-d',
                sequence: 3,
                toolName: 'query_world_state',
                argumentsSummary: { scope: 'rules' },
                status: 'running',
                createdAt: '2026-09-10T08:00:08.000Z',
              },
            ],
            artifacts: [
              {
                cardId: 'browser-round2-card',
                conversationId,
                turnId,
                runId,
                artifactId: 'round2-artifact',
                artifactType: 'quality_report',
                title: '雾港冲突推进核对',
                summary: '人物动机与章节目标一致，等待你决定是否继续推进。',
                content: '冲突线索、人物动机与当前章节目标均已核对。',
                status: 'candidate',
                createdAt: '2026-09-10T08:00:09.000Z',
                artifactEvidence: {
                  sourceNovelId: novel.id,
                  sourceChapterId: chapterId,
                  sourceDraftVersion: 3,
                  baseContentHash: 'round2-baseline-hash-0001',
                  processingStatus: 'valid',
                  validationIssues: [
                    {
                      issueId: 'browser-round2-issue',
                      artifactId: 'round2-artifact',
                      validationRunId: 'browser-round2-validation',
                      issueIndex: 0,
                      severity: 'warning',
                      code: 'ROUND2_SOURCE_NOTICE',
                      message: '候选来源为浏览器隔离夹具，不写入正式正文。',
                      jsonPath: '$.chapterId',
                      validatorVersion: 'browser-round2',
                      createdAt: '2026-09-10T08:00:09.000Z',
                    },
                  ],
                },
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
  await (await $('[data-testid="workbench-completed-read"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-artifact-card"]')).waitForExist();
  const recoveryDialog = await $('[data-testid="conversation-recovery-dialog"]');
  if (await recoveryDialog.isExisting()) {
    await (await recoveryDialog.$('[data-testid="conversation-recovery-dismiss"]')).click();
    await recoveryDialog.waitForExist({ reverse: true });
  }
}

describe('creative workbench layout', () => {
  before(async () => {
    fs.mkdirSync(screenshotDirectory, { recursive: true });
    resetRound2Metrics(round2SpecId);
    await seedWorkbenchConversation();
  });

  it('keeps source CSS free of transition all', () => {
    expect(cssFilesWithTransitionAll()).toEqual([]);
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
          frameBarPresent: Boolean(document.querySelector('.app-frame-bar')),
          globalSidebarPresent: Boolean(document.querySelector('.app-sidebar')),
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

      // The workbench route owns a single sidebar (quick actions + project/task tree);
      // the global sidebar is not rendered there and the frame bar spans every route.
      const expectedTreeWidth = 248;
      expect(layout.shellLayout).toBe('workbench');
      expect(layout.frameBarPresent).toBe(true);
      expect(layout.globalSidebarPresent).toBe(false);
      expect(layout.tree.width).toBeGreaterThanOrEqual(expectedTreeWidth - 1);
      expect(layout.tree.width).toBeLessThanOrEqual(expectedTreeWidth + 1);
      const availableMainWidth = layout.viewport.width - layout.tree.width;
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

  it('docks every side-panel view in the right column and overlays it in narrow windows', async () => {
    const panelRect = async () => {
      // The panel carries a 220ms enter animation; measure its settled final box only.
      await waitForStableBoxSet({
        selectors: { panel: '.workbench-side-panel' },
        label: 'side panel view',
        requireFound: true,
      });
      return browser.execute(() => {
        const page = document.querySelector<HTMLElement>('.workbench-page');
        const panel = document.querySelector<HTMLElement>('.workbench-side-panel');
        const tree = document.querySelector<HTMLElement>('.workbench-tree');
        const main = document.querySelector<HTMLElement>('.workbench-main');
        if (!page || !panel || !tree || !main) throw new Error('Missing side panel layout node');
        const rect = panel.getBoundingClientRect();
        return {
          view: page.dataset.sidePanel,
          viewportWidth: window.innerWidth,
          panelLeft: rect.left,
          panelRight: rect.right,
          panelTop: rect.top,
          panelWidth: rect.width,
          treeRight: tree.getBoundingClientRect().right,
          treeBottom: tree.getBoundingClientRect().bottom,
          mainRight: main.getBoundingClientRect().right,
          position: getComputedStyle(panel).position,
        };
      });
    };

    await browser.setWindowSize(1440, 900);
    await browser.pause(80);
    await (await $('[data-testid="workbench-toggle-side-panel"]')).click();
    await (await $('[data-testid="workbench-side-pin"]')).waitForDisplayed();
    await (await $('[data-testid="workbench-side-pin"]')).click();
    await (await $('[data-testid="workbench-side-open-context"]')).waitForDisplayed();
    for (const view of ['context', 'artifacts', 'events', 'plugins'] as const) {
      await (await $(`[data-testid="workbench-side-open-${view}"]`)).click();
      await (await $('[data-testid="workbench-side-back"]')).waitForDisplayed();
      const wide = await panelRect();
      expect(wide.view).toBe(view);
      // Wide window: the panel is the third grid column, flush with the viewport's right edge
      // and sharing the top edge with the tree, never wrapping under it.
      expect(Math.abs(wide.panelWidth - 360)).toBeLessThanOrEqual(1);
      expect(Math.abs(wide.panelRight - wide.viewportWidth)).toBeLessThanOrEqual(1);
      expect(wide.panelLeft).toBeGreaterThanOrEqual(wide.treeRight + 200);
      expect(wide.panelTop).toBeLessThan(wide.treeBottom - 100);
      expect(Math.abs(wide.mainRight - wide.panelLeft)).toBeLessThanOrEqual(1);
      await browser.saveScreenshot(
        path.join(screenshotDirectory, `workbench-side-${view}-1440x900.png`),
      );
      await (await $('[data-testid="workbench-side-back"]')).click();
      await (await $('[data-testid="workbench-side-open-context"]')).waitForDisplayed();
    }

    await (await $('[data-testid="workbench-side-open-context"]')).click();
    await (await $('[data-testid="workbench-side-back"]')).waitForDisplayed();
    await browser.setWindowSize(1024, 700);
    await browser.pause(120);
    const narrow = await panelRect();
    // Narrow window: the two-column grid stays intact and the panel overlays the transcript.
    expect(narrow.position).toBe('absolute');
    expect(Math.abs(narrow.panelRight - narrow.viewportWidth)).toBeLessThanOrEqual(1);
    expect(narrow.panelTop).toBeLessThan(narrow.treeBottom - 100);
    expect(narrow.mainRight).toBeGreaterThan(narrow.panelLeft + 100);
    await browser.saveScreenshot(
      path.join(screenshotDirectory, 'workbench-side-context-1024x700.png'),
    );
    await (await $('[data-testid="workbench-side-close"]')).click();
    await browser.setWindowSize(1440, 900);
    await browser.pause(80);
  });

  it('shows immutable task model information instead of a disabled selector', async () => {
    const fixed = await $('[data-testid="workbench-model-select"]');
    await expect(fixed).toHaveAttribute('role', 'group');
    await expect(fixed).toHaveAttribute('data-model-locked', 'true');
    await expect(fixed).toHaveAttribute('data-model-value', 'mock:Mock');
    const reason = await $('[data-testid="workbench-fixed-model-reason"]');
    // WDIO's attribute matcher stringifies a missing boolean attribute and can
    // report a null-vs-null mismatch. Read the DOM value directly.
    expect(await reason.getAttribute('open')).toBe(null);
    expect(await reason.getText()).toContain('固定原因');
    await reason.$('summary').click();
    expect(await reason.getText()).toContain('任务创建时固定');
    expect(
      await browser.execute(
        () => document.querySelector('[data-testid="workbench-model-select"] select') === null,
      ),
    ).toBe(true);
  });

  it('keeps overlay, pinned column and collapsed tree aligned within 2px at 1024/1280/1440/2560', async () => {
    const headerTriggers = [
      '[data-testid="workbench-open-context"]',
      '[data-testid="workbench-open-artifacts"]',
      '[data-testid="workbench-current-plugins"]',
      '[data-testid="workbench-toggle-side-panel"]',
      '[data-testid="workbench-toggle-focus"]',
    ];
    const expectHeaderReachable = async () => {
      const hits = await readCenterHits(headerTriggers);
      expect(hits.map((hit) => hit.found)).toEqual(headerTriggers.map(() => true));
      // A transient overlay that slides over the header would fail this real hit test.
      expect(hits.map((hit) => hit.hitInsideTarget)).toEqual(headerTriggers.map(() => true));
    };

    // A preceding panel test closes the view but intentionally keeps its
    // session presentation. Normalize it before the first geometry sample.
    await (await $('[data-testid="workbench-open-context"]')).click();
    const initialPanel = await $('[data-testid="workbench-side-panel"]');
    await initialPanel.waitForDisplayed();
    if ((await initialPanel.getAttribute('data-panel-intent')) === 'pinned') {
      await (await $('[data-testid="workbench-side-pin"]')).click();
      await expect(initialPanel).toHaveAttribute('data-panel-intent', 'transient');
    }
    await (await $('[data-testid="workbench-side-close"]')).click();

    for (const viewport of [
      { width: 1024, height: 700 },
      { width: 1280, height: 820 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1440 },
    ]) {
      await setExactViewport(viewport.width, viewport.height);
      const docked = viewport.width > 1180;
      const label = `${viewport.width}x${viewport.height}`;

      // State A - tree expanded, no reference panel: the grid owns exactly two columns.
      const closed = await waitForStableWorkbenchBoxes(`closed ${label}`);
      expect(closed.page.found).toBe(true);
      expect(closed.panel.found).toBe(false);
      expect(closed.page.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(closed.main.width).toBeGreaterThanOrEqual(640);
      const expandedMain = closed.main;

      // State B - the header opens the default transient overlay: no column, header still live.
      await (await $('[data-testid="workbench-open-context"]')).click();
      const transient = await waitForStableWorkbenchBoxes(`transient overlay ${label}`, {
        requireFound: true,
      });
      await expect($('[data-testid="creative-workbench"]')).toHaveAttribute(
        'data-panel-intent',
        'transient',
      );
      await expect($('[data-testid="workbench-side-panel"]')).toHaveAttribute(
        'data-panel-intent',
        'transient',
      );
      expect(transient.panel.position).toBe('absolute');
      expect(transient.panel.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(Math.abs(transient.panel.width - 360)).toBeLessThanOrEqual(1);
      // The overlay starts at the task header bottom instead of covering the header.
      expect(transient.panel.top).toBeGreaterThanOrEqual(transient.header.bottom - 1);
      expect(Math.abs(transient.main.left - expandedMain.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(transient.main.width - expandedMain.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(transient.main.height - expandedMain.height)).toBeLessThanOrEqual(1);
      expect(transient.page.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(transient.messages.height).toBeGreaterThan(220);
      await expectHeaderReachable();
      await takeRound2Screenshot(`workbench-transient-${label}`);
      recordRound2Metrics(round2SpecId, 'workbench-transient', {
        viewport,
        panel: transient.panel,
        main: transient.main,
        header: transient.header,
      });

      // State C - only an explicit pin may claim the reference column, and only above 1180px.
      await (await $('[data-testid="workbench-side-pin"]')).click();
      const pinned = await waitForStableWorkbenchBoxes(`pinned ${label}`, { requireFound: true });
      await expect($('[data-testid="creative-workbench"]')).toHaveAttribute(
        'data-panel-intent',
        'pinned',
      );
      await expect($('[data-testid="workbench-side-panel"]')).toHaveAttribute(
        'data-panel-intent',
        'pinned',
      );
      expect(Math.abs(pinned.panel.width - 360)).toBeLessThanOrEqual(1);
      expect(Math.abs(pinned.panel.right - viewport.width)).toBeLessThanOrEqual(1);
      if (docked) {
        expect(pinned.panel.position).toBe('static');
        expect(Math.abs(pinned.panel.left - pinned.main.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(pinned.panel.top - pinned.main.top)).toBeLessThanOrEqual(2);
        expect(
          Math.abs(pinned.main.width - (viewport.width - pinned.tree.width - 360)),
        ).toBeLessThanOrEqual(2);
      } else {
        // The 1180px media query keeps a pinned panel as an overlay in narrow windows.
        expect(pinned.panel.position).toBe('absolute');
        expect(pinned.panel.top).toBeGreaterThanOrEqual(pinned.header.bottom - 1);
        expect(Math.abs(pinned.main.left - expandedMain.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(pinned.main.width - expandedMain.width)).toBeLessThanOrEqual(1);
      }
      expect(pinned.page.right).toBeLessThanOrEqual(viewport.width + 1);
      await expectHeaderReachable();
      recordRound2Metrics(round2SpecId, 'workbench-pinned', {
        viewport,
        docked,
        panel: pinned.panel,
        main: pinned.main,
        tree: pinned.tree,
      });

      // State D - the collapsed tree keeps the reference column and the header stays reachable.
      await (await $('[data-testid="shell-toggle-sidebar"]')).click();
      const collapsed = await waitForStableWorkbenchBoxes(`pinned with collapsed tree ${label}`, {
        requireFound: true,
      });
      expect(collapsed.tree.display).toBe('none');
      if (docked) {
        expect(collapsed.main.left).toBeLessThanOrEqual(1);
        expect(Math.abs(collapsed.main.width - (viewport.width - 360))).toBeLessThanOrEqual(2);
      } else {
        expect(Math.abs(collapsed.main.width - viewport.width)).toBeLessThanOrEqual(1);
        expect(collapsed.panel.position).toBe('absolute');
      }
      await expectHeaderReachable();
      await takeRound2Screenshot(`workbench-pinned-collapsed-${label}`);

      // Unpinning releases the column immediately and returns to the transient overlay.
      await (await $('[data-testid="workbench-side-pin"]')).click();
      const unpinned = await waitForStableWorkbenchBoxes(`unpinned ${label}`, {
        requireFound: true,
      });
      await expect($('[data-testid="creative-workbench"]')).toHaveAttribute(
        'data-panel-intent',
        'transient',
      );
      expect(unpinned.panel.position).toBe('absolute');
      expect(unpinned.panel.top).toBeGreaterThanOrEqual(unpinned.header.bottom - 1);
      expect(Math.abs(unpinned.main.left - collapsed.main.left)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(unpinned.main.width - (collapsed.main.width + (docked ? 360 : 0))),
      ).toBeLessThanOrEqual(2);

      // Restore the expanded tree and close the reference view for the next viewport.
      await (await $('[data-testid="shell-toggle-sidebar"]')).click();
      await waitForStableWorkbenchBoxes(`restored tree ${label}`);
      await (await $('[data-testid="workbench-side-close"]')).click();
      const reclosed = await waitForStableWorkbenchBoxes(`reclosed ${label}`);
      expect(reclosed.panel.found).toBe(false);
    }
  });

  it('keeps focus mode session-only: the tree and the transient panel return without rewriting the preference', async () => {
    const preferenceKey = 'ai_novel_studio_sidebar_collapsed:workbench';
    const readPreference = () =>
      browser.execute((key) => window.localStorage.getItem(key), preferenceKey);
    const draft = '专注回归草稿不得丢失';

    // Own a fresh component instance so a prior panel test cannot leave a
    // closed view or a pinned presentation behind.
    await seedWorkbenchConversation();
    const focusTrigger = await $('[data-testid="workbench-toggle-focus"]');
    const panel = await $('[data-testid="workbench-side-panel"]');
    const input = await $('[data-testid="workbench-composer-input"]');

    for (const viewport of [
      { width: 1024, height: 700 },
      { width: 1440, height: 900 },
    ]) {
      await setExactViewport(viewport.width, viewport.height);
      const label = `${viewport.width}x${viewport.height}`;
      // Typing outside a transient overlay intentionally dismisses it. Seed the
      // draft first, then open the panel so focus mode can hide and restore it.
      await input.clearValue();
      await input.setValue(draft);
      await (await $('[data-testid="workbench-open-context"]')).click();
      await waitForStableWorkbenchBoxes(`focus baseline ${label}`, { requireFound: true });
      expect(await readPreference()).toBe('0');

      // Focus hides the tree and the transient overlay for this session only.
      await focusTrigger.click();
      const focused = await waitForStableWorkbenchBoxes(`focus ${label}`, { requireFound: true });
      await expect($('[data-testid="app-shell"]')).toHaveAttribute('data-sidebar', 'collapsed');
      await expect($('[data-testid="app-shell"]')).toHaveAttribute('data-focus-mode', 'true');
      await expect($('[data-testid="creative-workbench"]')).toHaveAttribute(
        'data-focus-mode',
        'true',
      );
      await expect(focusTrigger).toHaveAttribute('aria-pressed', 'true');
      expect(focused.tree.display).toBe('none');
      expect(focused.panel.hidden).toBe(true);
      expect(focused.panel.inert).toBe(true);
      expect(await readPreference()).toBe('0');
      expect(await input.getValue()).toBe(draft);
      await takeRound2Screenshot(`workbench-focus-${label}`);
      recordRound2Metrics(round2SpecId, 'workbench-focus', {
        viewport,
        treeDisplay: focused.tree.display,
        panelHidden: focused.panel.hidden,
        sidebarPreference: '0',
        main: focused.main,
      });

      // Leaving focus restores the same transient reference view and the drafting text.
      await focusTrigger.click();
      const restored = await waitForStableWorkbenchBoxes(`focus exited ${label}`, {
        requireFound: true,
      });
      await expect($('[data-testid="app-shell"]')).toHaveAttribute('data-focus-mode', 'false');
      await expect(panel).toHaveAttribute('data-view', 'context');
      expect(restored.panel.hidden).toBe(false);
      expect(await panel.isDisplayed()).toBe(true);
      expect(restored.panel.top).toBeGreaterThanOrEqual(restored.header.bottom - 1);
      expect(await readPreference()).toBe('0');
      expect(await input.getValue()).toBe(draft);
    }

    // A collapsed preference must survive a focus round trip; Ctrl+K is the explicit reveal.
    await setExactViewport(1440, 900);
    await (await $('[data-testid="shell-toggle-sidebar"]')).click();
    await waitForStableWorkbenchBoxes('collapsed preference');
    expect(await readPreference()).toBe('1');
    await focusTrigger.click();
    await waitForStableWorkbenchBoxes('focus with collapsed preference');
    expect(await readPreference()).toBe('1');
    await browser.execute(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      ),
    );
    await expect($('[data-testid="app-shell"]')).toHaveAttribute('data-sidebar', 'expanded');
    await expect($('[data-testid="app-shell"]')).toHaveAttribute('data-focus-mode', 'false');
    const search = await $('input[aria-label="搜索创作任务"]');
    await search.waitForDisplayed();
    expect(await search.isFocused()).toBe(true);
    // Ctrl+K is the product's explicit reveal request, so the stored preference follows it.
    expect(await readPreference()).toBe('0');
    // Ctrl+K hands the shell the search intent and closes the transient
    // reference view while revealing the tree.
    const revealed = await waitForStableBoxSet({
      label: 'ctrl+k reveal',
      selectors: {
        page: '.workbench-page',
        tree: '.workbench-tree',
        main: '.workbench-main',
        header: '.workbench-task-header',
        messages: '.workbench-message-region',
        composer: '.workbench-composer',
      },
    });
    expect(revealed.tree.display).not.toBe('none');
    const revealedPanel = await browser.execute(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="workbench-side-panel"]');
      return node ? { hidden: node.hidden, intent: node.dataset.panelIntent ?? null } : null;
    });
    expect(revealedPanel === null || revealedPanel.hidden === false).toBe(true);
    expect(await input.getValue()).toBe(draft);
  });

  it('highlights only artifacts appended to the active task once', async () => {
    await seedWorkbenchConversation();
    const initialArtifact = await $(
      '[data-testid="workbench-artifact-card"][data-card-id="browser-layout-card"]',
    );
    expect(await initialArtifact.getAttribute('data-newly-arrived')).toBe(null);

    await browser.execute(() => {
      const state = JSON.parse(
        window.localStorage.getItem('ai_novel_studio_task_conversations') ?? '{"bundles":[]}',
      ) as {
        bundles: Array<{
          conversation: { conversationId: string };
          artifacts: Array<Record<string, unknown>>;
        }>;
      };
      const bundle = state.bundles.find(
        (candidate) => candidate.conversation.conversationId === 'browser-layout-conversation',
      );
      if (!bundle) throw new Error('Active browser fixture bundle missing.');
      bundle.artifacts.push({
        cardId: 'browser-layout-card-new',
        conversationId: 'browser-layout-conversation',
        turnId: 'browser-layout-turn',
        runId: 'browser-layout-run-2',
        artifactId: 'browser-layout-artifact-new',
        artifactType: 'quality_report',
        title: '新增推进核对',
        summary: '这是同一任务运行期间追加的产物。',
        content: '新增核对内容。',
        status: 'candidate',
        createdAt: '2026-08-27T12:00:03.000Z',
      });
      window.localStorage.setItem('ai_novel_studio_task_conversations', JSON.stringify(state));
    });

    await (await $('[data-testid="workbench-artifact-acknowledge"]')).click();
    const newArtifact = await $(
      '[data-testid="workbench-artifact-card"][data-card-id="browser-layout-card-new"]',
    );
    await newArtifact.waitForDisplayed();
    await browser.waitUntil(
      async () => (await newArtifact.getAttribute('data-newly-arrived')) === 'true',
      {
        timeout: 2_000,
        interval: 20,
        timeoutMsg: 'New artifact did not receive its arrival state.',
      },
    );
    expect(await initialArtifact.getAttribute('data-newly-arrived')).toBe(null);
    await browser.waitUntil(
      async () => (await newArtifact.getAttribute('data-newly-arrived')) === null,
      { timeout: 2_000, interval: 20, timeoutMsg: 'Artifact arrival state did not settle.' },
    );

    await browser.execute(() => {
      const state = JSON.parse(
        window.localStorage.getItem('ai_novel_studio_task_conversations') ?? '{"bundles":[]}',
      ) as {
        bundles: Array<{
          conversation: { conversationId: string };
          artifacts: Array<Record<string, unknown>>;
        }>;
      };
      const bundle = state.bundles.find(
        (candidate) => candidate.conversation.conversationId === 'browser-layout-conversation',
      );
      const artifact = bundle?.artifacts.find(
        (candidate) => candidate.cardId === 'browser-layout-card-new',
      );
      if (!artifact) throw new Error('New browser fixture artifact missing.');
      artifact.summary = '同一卡片完成了一次持久化水合。';
      window.localStorage.setItem('ai_novel_studio_task_conversations', JSON.stringify(state));
    });
    await (await newArtifact.$('[data-testid="workbench-artifact-acknowledge"]')).click();
    await browser.waitUntil(
      async () => (await newArtifact.getAttribute('data-decision')) === 'confirm',
      { timeout: 2_000, interval: 20, timeoutMsg: 'Artifact hydration did not complete.' },
    );
    expect(await newArtifact.getAttribute('data-newly-arrived')).toBe(null);
    await seedWorkbenchConversation();
  });

  it('scrolls task switches immediately without replaying hydrated artifact arrivals', async () => {
    await seedWorkbenchConversation();
    await browser.execute(() => {
      const state = JSON.parse(
        window.localStorage.getItem('ai_novel_studio_task_conversations') ?? '{"bundles":[]}',
      ) as {
        bundles: Array<{
          conversation: Record<string, unknown> & { conversationId: string; novelId: string };
          turns: Array<Record<string, unknown>>;
          runs: Array<Record<string, unknown>>;
          toolEvents: Array<Record<string, unknown>>;
          artifacts: Array<Record<string, unknown>>;
          decisions?: Array<Record<string, unknown>>;
          authorizations?: Array<Record<string, unknown>>;
        }>;
      };
      const source = state.bundles[0];
      if (!source) throw new Error('Source browser fixture bundle missing.');
      const conversationId = 'browser-layout-conversation-secondary';
      const now = '2026-08-27T11:00:00.000Z';
      state.bundles.push({
        conversation: {
          ...source.conversation,
          conversationId,
          title: '次要任务滚动基线',
          status: 'waiting_user',
          createdAt: now,
          updatedAt: now,
        },
        turns: Array.from({ length: 12 }, (_, index) => ({
          turnId: `browser-secondary-turn-${index + 1}`,
          conversationId,
          sequence: index,
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: Array.from(
            { length: 12 },
            (__, lineIndex) => `次要任务 ${index + 1} · 进展 ${lineIndex + 1}`,
          ).join('\n'),
          createdAt: now,
        })),
        runs: [],
        toolEvents: [],
        artifacts: [
          {
            cardId: 'browser-secondary-card',
            conversationId,
            turnId: 'browser-secondary-turn-12',
            artifactId: 'browser-secondary-artifact',
            artifactType: 'quality_report',
            title: '次要任务既有产物',
            summary: '切换任务时只建立基线，不播放新增提示。',
            content: '既有产物内容。',
            status: 'candidate',
            createdAt: now,
          },
        ],
        decisions: [],
        authorizations: [],
      });
      window.localStorage.setItem('ai_novel_studio_task_conversations', JSON.stringify(state));
    });
    await browser.refresh();
    await waitForStartupSplashRemoval();
    await (await $('[data-testid="workbench-task-header"]')).waitForDisplayed();

    await browser.execute(() => {
      type InstrumentedWindow = typeof window & {
        __workbenchOriginalScrollTo?: typeof HTMLElement.prototype.scrollTo;
        __workbenchScrollBehaviors?: string[];
      };
      const host = window as InstrumentedWindow;
      host.__workbenchOriginalScrollTo = HTMLElement.prototype.scrollTo;
      host.__workbenchScrollBehaviors = [];
      HTMLElement.prototype.scrollTo = function (
        optionsOrX?: ScrollToOptions | number,
        y?: number,
      ) {
        if (typeof optionsOrX === 'object') {
          if (this.matches('[data-testid="workbench-message-list"]')) {
            host.__workbenchScrollBehaviors?.push(optionsOrX.behavior ?? 'auto');
          }
          if (typeof optionsOrX.left === 'number') this.scrollLeft = optionsOrX.left;
          if (typeof optionsOrX.top === 'number') this.scrollTop = optionsOrX.top;
          return;
        }
        if (typeof optionsOrX === 'number') this.scrollLeft = optionsOrX;
        if (typeof y === 'number') this.scrollTop = y;
      } as typeof HTMLElement.prototype.scrollTo;
    });

    const secondaryTask = await $(
      '[data-testid="workbench-task"][data-conversation-id="browser-layout-conversation-secondary"]',
    );
    await secondaryTask.click();
    await browser.waitUntil(
      async () => (await secondaryTask.getAttribute('data-selected')) === 'true',
    );
    const messageList = await $('[data-testid="workbench-message-list"]');
    await browser.waitUntil(
      async () =>
        browser.execute(
          (node) => node.scrollHeight - node.scrollTop - node.clientHeight <= 2,
          messageList,
        ),
      { timeout: 2_000, interval: 20, timeoutMsg: 'Task switch did not reach the latest message.' },
    );
    const switchState = await browser.execute(() => {
      const host = window as typeof window & { __workbenchScrollBehaviors?: string[] };
      return {
        behaviors: host.__workbenchScrollBehaviors ?? [],
        artifactArrival: document
          .querySelector<HTMLElement>('[data-card-id="browser-secondary-card"]')
          ?.getAttribute('data-newly-arrived'),
      };
    });
    expect(switchState.behaviors).toContain('auto');
    expect(switchState.behaviors).not.toContain('smooth');
    expect(switchState.artifactArrival).toBe(null);

    await browser.execute(() => {
      const host = window as typeof window & {
        __workbenchOriginalScrollTo?: typeof HTMLElement.prototype.scrollTo;
        __workbenchScrollBehaviors?: string[];
      };
      if (host.__workbenchOriginalScrollTo) {
        HTMLElement.prototype.scrollTo = host.__workbenchOriginalScrollTo;
      }
      delete host.__workbenchOriginalScrollTo;
      delete host.__workbenchScrollBehaviors;
    });
    await seedWorkbenchConversation();
  });

  it('keeps the spinner singular and disables spatial motion when reduced motion is requested', async () => {
    await seedWorkbenchConversation();
    const defaultMotion = await browser.execute(() => {
      const tool = document.querySelector<HTMLElement>('[data-testid="workbench-tool-event"]');
      const icon = tool?.querySelector<HTMLElement>('.workbench-tool-icon');
      const spinner = icon?.querySelector<SVGElement>('svg');
      const artifact = document.querySelector<HTMLElement>('[data-card-id="browser-layout-card"]');
      if (!tool || !icon || !spinner || !artifact) {
        throw new Error('Motion fixture is incomplete.');
      }
      tool.classList.add('is-running');
      artifact.classList.add('is-newly-arrived');
      return {
        iconAnimation: getComputedStyle(icon).animationName,
        iconOpacity: getComputedStyle(icon).opacity,
        spinnerAnimation: getComputedStyle(spinner).animationName,
        artifactAnimation: getComputedStyle(artifact).animationName,
        artifactTransform: getComputedStyle(artifact).transform,
      };
    });
    expect(defaultMotion.iconAnimation).toBe('none');
    expect(defaultMotion.iconOpacity).toBe('1');
    expect(defaultMotion.spinnerAnimation).toBe('workbench-spin');
    expect(defaultMotion.artifactAnimation).toBe('workbench-artifact-arrive');
    expect(defaultMotion.artifactTransform).toBe('none');

    await browser.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reducedMotion = await browser.execute(() => {
      const icon = document.querySelector<HTMLElement>(
        '.workbench-tool-event.is-running .workbench-tool-icon',
      );
      const spinner = icon?.querySelector<SVGElement>('svg');
      const artifact = document.querySelector<HTMLElement>(
        '.workbench-artifact-card.is-newly-arrived',
      );
      if (!icon || !spinner || !artifact) throw new Error('Reduced motion fixture is incomplete.');
      return {
        iconAnimation: getComputedStyle(icon).animationName,
        spinnerAnimation: getComputedStyle(spinner).animationName,
        artifactAnimation: getComputedStyle(artifact).animationName,
      };
    });
    expect(reducedMotion.iconAnimation).toBe('none');
    expect(reducedMotion.spinnerAnimation).toBe('none');
    expect(reducedMotion.artifactAnimation).toBe('none');
    await browser.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
  });

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
    await expectUnifiedIconLanguage();
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

    const latestButton = await $('button=查看最新进展');
    await latestButton.click();
    // The labelled dock container stays mounted for layout stability; only the jump action that
    // was just used goes away. The pending-candidate entry must survive in the same dock, and it
    // must still navigate to the exact card instead of being a decorative leftover.
    await latestButton.waitForDisplayed({ reverse: true });
    const pendingButton = await $('[data-testid="workbench-locate-pending"]');
    await pendingButton.waitForDisplayed();
    expect(await pendingButton.getText()).toContain('查看待处理候选（1）');
    await pendingButton.click();
    await browser.waitUntil(
      async () =>
        (await $('[data-presentation-id="artifact:browser-layout-card"]').getAttribute(
          'data-located',
        )) === 'true',
      { timeoutMsg: 'Pending-candidate navigation did not locate the artifact card.' },
    );
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

  it('collapses consecutive successful reads into one disclosure while failure and active read stay exposed', async () => {
    await seedRound2PresentationConversation();
    await setExactViewport(1440, 900);

    const boxes = await waitForStableBoxSet({
      selectors: {
        group: '[data-testid="workbench-completed-read"]',
        groupDetails: '[data-testid="workbench-completed-read"] > details',
        failedAlert: '[data-testid="workbench-tool-public-error"]',
        failedRow:
          '[data-testid="workbench-tool-event"][data-event-id="browser-round2-read-failed"]',
        activeRow:
          '[data-testid="workbench-tool-event"][data-event-id="browser-round2-read-running"]',
        messages: '.workbench-message-region',
        list: '[data-testid="workbench-message-list"]',
      },
      label: 'completed-read disclosure group',
      requireFound: true,
    });
    await expect($('[data-testid="workbench-completed-read"]')).toHaveAttribute(
      'data-read-event-ids',
      'tool:browser-round2-read-a,tool:browser-round2-read-b',
    );
    await expect($('[data-testid="workbench-completed-read"] > details')).toHaveAttribute(
      'data-disclosure-key',
      'completed-read:tool:browser-round2-read-a,tool:browser-round2-read-b',
    );

    const group = await browser.execute(() => {
      const container = document.querySelector<HTMLElement>(
        '[data-testid="workbench-completed-read"]',
      );
      const details = container?.querySelector<HTMLDetailsElement>('details');
      if (!container || !details) throw new Error('Completed-read group fixture missing.');
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>('[data-testid="workbench-tool-event"]'),
      );
      return {
        open: details.open,
        summary: details.querySelector('summary')?.textContent ?? '',
        statuses: rows.map((row) => row.dataset.status ?? ''),
        eventIds: rows.map((row) => row.dataset.eventId ?? ''),
        nestedGroups: container.querySelectorAll('[data-testid="workbench-completed-read"]').length,
        outside: Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="workbench-tool-event"]'),
        )
          .filter((row) => !container.contains(row))
          .map((row) => `${row.dataset.eventId ?? ''}:${row.dataset.status ?? ''}`),
      };
    });
    // A successful read group starts collapsed, contains only succeeded reads and never nests.
    expect(group.open).toBe(false);
    expect(group.summary).toContain('已读取创作材料 · 2 项');
    expect(group.statuses).toEqual(['succeeded', 'succeeded']);
    expect(group.eventIds).toEqual(['browser-round2-read-a', 'browser-round2-read-b']);
    expect(group.nestedGroups).toBe(0);
    // The failed read and the interrupted read must both stay outside the disclosure.
    // Browser startup recovery marks the in-flight tool as cancelled while
    // preserving its visible row.
    expect(group.outside).toEqual([
      'browser-round2-read-failed:failed',
      'browser-round2-read-running:cancelled',
    ]);
    expect(await (await $('[data-testid="workbench-tool-public-error"]')).getText()).toContain(
      '检索失败不得折叠',
    );
    expect(boxes.failedRow.found).toBe(true);
    expect(boxes.activeRow.found).toBe(true);
    // Real geometry: group, failure alert and active row occupy distinct visible boxes.
    expect(boxesOverlap(boxes.group, boxes.failedAlert)).toBe(false);
    expect(boxesOverlap(boxes.group, boxes.activeRow)).toBe(false);
    expect(boxesOverlap(boxes.group, boxes.list)).toBe(true);
    expect(boxes.list.top).toBeLessThanOrEqual(boxes.group.top + 1);
    expect(boxes.group.bottom).toBeLessThanOrEqual(boxes.list.bottom + 1);
    expect(boxes.messages.height).toBeGreaterThan(220);
    await takeRound2Screenshot('workbench-read-disclosure-1440x900');
    recordRound2Metrics(round2SpecId, 'workbench-read-disclosure', { group, boxes });

    // Expanding the disclosure reveals exactly the two read rows instead of reordering them.
    await (await $('[data-testid="workbench-completed-read"] summary')).click();
    const expanded = await browser.execute(() => {
      const container = document.querySelector<HTMLElement>(
        '[data-testid="workbench-completed-read"]',
      );
      const details = container?.querySelector<HTMLDetailsElement>('details');
      if (!container || !details) throw new Error('Completed-read group fixture missing.');
      return {
        open: details.open,
        visibleRows: Array.from(
          container.querySelectorAll<HTMLElement>('[data-testid="workbench-tool-event"]'),
        )
          .filter((row) => row.getBoundingClientRect().height > 0)
          .map((row) => row.dataset.eventId ?? ''),
      };
    });
    expect(expanded.open).toBe(true);
    expect(expanded.visibleRows).toEqual(['browser-round2-read-a', 'browser-round2-read-b']);
    await takeRound2Screenshot('workbench-read-disclosure-expanded-1440x900');
    await seedWorkbenchConversation();
  });

  it('keeps the candidate identity and next step measurable inside the browser card', async () => {
    await seedRound2PresentationConversation();
    await setExactViewport(1280, 820);

    const card = await waitForStableBoxSet({
      selectors: {
        card: '[data-testid="workbench-artifact-card"][data-card-id="browser-round2-card"]',
        heading: '[data-testid="workbench-artifact-card"][data-card-id="browser-round2-card"] h3',
        number: '[data-testid="workbench-artifact-number"]',
        identity: '[data-testid="workbench-artifact-identity"]',
        target: '[data-testid="workbench-artifact-target"]',
        model: '[data-testid="workbench-artifact-model"]',
        nextStep: '[data-testid="workbench-artifact-next-step"]',
        modelReason: '[data-testid="workbench-fixed-model-reason"]',
      },
      label: 'candidate identity card',
      requireFound: true,
    });
    expect(await (await $('[data-testid="workbench-artifact-card"] h3')).getText()).toBe(
      '雾港冲突推进核对',
    );
    expect(await (await $('[data-testid="workbench-artifact-number"]')).getText()).toMatch(
      /候选\s*\d{2}/u,
    );
    expect(await (await $('[data-testid="workbench-artifact-target"]')).getText()).toContain(
      '目标：',
    );
    expect(await (await $('[data-testid="workbench-artifact-model"]')).getText()).toContain(
      '来源：',
    );
    expect(await (await $('[data-testid="workbench-artifact-next-step"]')).getText()).toContain(
      '下一步：',
    );
    // The first screen keeps name/target/source/next step in readable, unclipped geometry.
    expect(card.card.width).toBeGreaterThan(0);
    expect(card.identity.top).toBeGreaterThanOrEqual(card.card.top - 1);
    expect(card.nextStep.top).toBeGreaterThanOrEqual(card.identity.bottom - 1);
    expect(boxesOverlap(card.identity, card.nextStep)).toBe(false);
    expect(card.nextStep.left).toBeGreaterThanOrEqual(card.card.left - 1);
    expect(card.nextStep.right).toBeLessThanOrEqual(card.card.right + 1);
    expect(card.card.scrollWidth).toBeLessThanOrEqual(card.card.clientWidth + 1);
    expect(card.heading.width).toBeGreaterThan(0);

    // Browser mode deliberately does not hydrate SQLite artifact evidence. The
    // candidate identity and next step remain visible; source, validation and
    // technical evidence are desktop-only facts.
    expect(await $('[data-testid="workbench-artifact-source"]').isExisting()).toBe(false);
    expect(await $('.workbench-artifact-technical-evidence').isExisting()).toBe(false);
    expect(await $('[data-testid="workbench-artifact-validation"]').isExisting()).toBe(false);

    // The fixed-model reason is a disclosure as well and only expands on demand.
    const modelReason = await $('[data-testid="workbench-fixed-model-reason"]');
    expect(await modelReason.getAttribute('open')).toBe(null);
    expect(await modelReason.getText()).toContain('固定原因');
    await (await modelReason.$('summary')).click();
    await browser.waitUntil(async () => (await modelReason.getAttribute('open')) !== null);
    expect(await modelReason.getText()).toContain('任务创建时固定');

    await takeRound2Screenshot('workbench-candidate-card-1280x820');
    recordRound2Metrics(round2SpecId, 'workbench-candidate-card', { card });
    await seedWorkbenchConversation();
  });

  it('uses the resource-center shell away from the workbench route', async () => {
    await browser.setWindowSize(1440, 900);
    await browser.url('/#/settings');
    await waitForStartupSplashRemoval();
    await (await $('.settings-sidebar')).waitForDisplayed();
    await browser.waitUntil(async () => {
      const width = await browser.execute(
        () =>
          document.querySelector<HTMLElement>('.settings-sidebar')?.getBoundingClientRect().width ??
          0,
      );
      return width >= 231;
    });
    const shell = await browser.execute(() => {
      const hubSidebar = document.querySelector<HTMLElement>('.settings-sidebar');
      const frameBar = document.querySelector<HTMLElement>('.app-frame-bar');
      return {
        layout: document.querySelector<HTMLElement>('[data-testid="app-shell"]')?.dataset.layout,
        hubSidebarWidth: hubSidebar?.getBoundingClientRect().width ?? 0,
        globalSidebarPresent: Boolean(document.querySelector('.app-sidebar')),
        frameBarHeight: frameBar?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(shell.layout).toBe('hub');
    expect(shell.hubSidebarWidth).toBeGreaterThanOrEqual(231);
    expect(shell.hubSidebarWidth).toBeLessThanOrEqual(233);
    expect(shell.globalSidebarPresent).toBe(false);
    expect(shell.frameBarHeight).toBeGreaterThanOrEqual(37);
    expect(shell.frameBarHeight).toBeLessThanOrEqual(39);
  });
});
