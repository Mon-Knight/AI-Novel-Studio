import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';

const CONVERSATION_ID = 'ui-review-conversation';
const ARTIFACT_ID = 'ui-review-artifact';
const ORIGINAL_CONTENT = JSON.stringify({
  characters: [
    { name: '林澈', summary: '记录海港旧案的抄写员。' },
    { name: '周岚', summary: '守护航海日志的引航员。' },
  ],
});
const ORIGINAL_DRAFT = '保留我尚未发送的目标：先核对人物动机，再处理雾港支线。';
const firstReview = {
  title: '林澈（修订建议）',
  summary: '保留抄写员身份，补充他隐瞒旧案的具体原因。',
  notes: '不要修改已采用的章节正文。',
};
const secondReview = {
  title: '周岚（修订建议）',
  summary: '保留引航员身份，让她与主角的目标产生可解释的冲突。',
  notes: '两人的关系应当在后续章节逐步变化。',
};
const screenshotDirectory = path.resolve(import.meta.dirname, '../../test-results/artifact-review');

interface StoredBundle {
  conversation: { conversationId: string };
  turns: unknown[];
  runs: unknown[];
  artifacts: Array<{ artifactId: string; content: string }>;
  decisions: Array<{ decision: string; artifactHash: string; applyTransactionId?: string }>;
  authorizations: unknown[];
}

async function waitForWorkbench(): Promise<void> {
  await (await $('[data-testid="creative-workbench"]')).waitForDisplayed();
  await (await $('#startup-splash')).waitForExist({ reverse: true });
  await (await $('[data-testid="workbench-tree-loading"]')).waitForExist({ reverse: true });
  await (await $('[data-testid="workbench-loading"]')).waitForExist({ reverse: true });
}

async function seedReviewFixture(): Promise<void> {
  await browser.url('/#/');
  await browser.execute(() => {
    if (
      window.location.hostname !== '127.0.0.1' ||
      '__TAURI__' in window ||
      '__TAURI_INTERNALS__' in window ||
      '__TAURI_IPC__' in window
    ) {
      throw new Error('Artifact review fixtures require an isolated loopback browser session.');
    }
    window.localStorage.clear();
  });
  await browser.refresh();
  await waitForWorkbench();

  await browser.execute(
    (conversationId, artifactId, content) => {
      const novels = JSON.parse(
        window.localStorage.getItem('ai_novel_studio_novels') ?? '[]',
      ) as Array<{ id: string }>;
      const novel = novels[0];
      if (!novel?.id) throw new Error('Isolated browser fixture novel is missing.');
      const now = '2026-09-05T08:00:00.000Z';
      const turnId = 'ui-review-turn';
      const runId = 'ui-review-run';
      const model = {
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock',
        capabilities: ['chat'],
        options: {},
        capturedAt: now,
      };
      window.localStorage.setItem(
        'ai_novel_studio_task_conversations',
        JSON.stringify({
          bundles: [
            {
              conversation: {
                conversationId,
                novelId: novel.id,
                title: '人物候选审阅语义验证',
                status: 'waiting_user',
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
                  content: '为雾港支线准备两个人物候选。',
                  createdAt: now,
                },
              ],
              runs: [
                {
                  runId,
                  conversationId,
                  turnId,
                  workerId: 'ui-review-worker',
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
                  cardId: 'ui-review-card',
                  conversationId,
                  turnId,
                  runId,
                  artifactId,
                  artifactType: 'character_candidates',
                  title: '雾港人物候选',
                  summary: '两个人物均为原始候选，尚未应用到作品。',
                  content,
                  status: 'candidate',
                  createdAt: now,
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
    },
    CONVERSATION_ID,
    ARTIFACT_ID,
    ORIGINAL_CONTENT,
  );
  await browser.refresh();
  await waitForWorkbench();
  await (await $('[data-testid="workbench-artifact-candidates"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-composer-input"]')).waitForDisplayed();

  // No send/apply action is used. Block external fetches during review interactions as well.
  await browser.execute(() => {
    const probe = { blockedFetches: 0 };
    const reviewWindow = window as Window & { __artifactReviewProbe?: typeof probe };
    reviewWindow.__artifactReviewProbe = probe;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        window.location.href,
      );
      if (url.origin !== window.location.origin) {
        probe.blockedFetches += 1;
        return Promise.reject(new Error('External fetch blocked by the artifact review test.'));
      }
      return originalFetch(input, init);
    };
  });
}

async function readReviewState() {
  return browser.execute((conversationId) => {
    const state = JSON.parse(
      window.localStorage.getItem('ai_novel_studio_task_conversations') ?? '{"bundles":[]}',
    ) as { bundles: StoredBundle[] };
    const bundle = state.bundles.find(
      (item) => item.conversation.conversationId === conversationId,
    );
    if (!bundle) throw new Error('Artifact review fixture disappeared.');
    const domainKeys = Object.keys(window.localStorage)
      .filter((key) =>
        /^ai_novel_studio_(novels|chapters|volumes|character|chapter_events|world_settings|rule_systems|protagonists|abilities|draft|content_transactions|chapter_summaries|context_records)/.test(
          key,
        ),
      )
      .sort();
    return {
      hasTauriBridge:
        '__TAURI__' in window || '__TAURI_INTERNALS__' in window || '__TAURI_IPC__' in window,
      domains: domainKeys.map((key) => [key, window.localStorage.getItem(key)]),
      turns: bundle.turns,
      runs: bundle.runs,
      artifacts: bundle.artifacts.map(({ artifactId, content }) => ({ artifactId, content })),
      decisions: bundle.decisions,
      authorizations: bundle.authorizations,
      blockedFetches:
        (window as Window & { __artifactReviewProbe?: { blockedFetches: number } })
          .__artifactReviewProbe?.blockedFetches ?? -1,
    };
  }, CONVERSATION_ID);
}

async function fillReview(index: number, review: typeof firstReview): Promise<void> {
  const candidate = (await $$('[data-testid="workbench-artifact-candidate"]'))[index];
  const edit = await candidate.$('[data-testid="workbench-artifact-candidate-edit"]');
  if ((await edit.getAttribute('aria-expanded')) !== 'true') await edit.click();
  await (await (await candidate.$('label*=建议标题')).$('input')).setValue(review.title);
  await (await (await candidate.$('label*=建议摘要')).$('textarea')).setValue(review.summary);
  await (await (await candidate.$('label*=补充要求')).$('textarea')).setValue(review.notes);
}

async function expectOriginalCandidates(): Promise<void> {
  const candidates = await $$('[data-testid="workbench-artifact-candidate"]');
  expect(candidates.length).toBe(2);
  await expect(candidates[0].$('.workbench-artifact-candidate-title')).toHaveText('林澈');
  await expect(candidates[0].$('.workbench-artifact-candidate-summary')).toHaveText(
    '记录海港旧案的抄写员。',
  );
  await expect(candidates[1].$('.workbench-artifact-candidate-title')).toHaveText('周岚');
  await expect(candidates[1].$('.workbench-artifact-candidate-summary')).toHaveText(
    '守护航海日志的引航员。',
  );
}

describe('artifact candidate review semantics', () => {
  before(() => fs.mkdirSync(screenshotDirectory, { recursive: true }));
  beforeEach(seedReviewFixture);

  it('keeps original candidates immutable while marking review and writing suggestions', async () => {
    const before = await readReviewState();
    const candidate = (await $$('[data-testid="workbench-artifact-candidate"]'))[0];
    const reviewed = await candidate.$('input[type="checkbox"]');
    await expect(reviewed).not.toBeSelected();
    await expect(candidate.$('.workbench-artifact-candidate-select')).toHaveText('已审阅');
    await reviewed.click();
    await fillReview(0, firstReview);
    await expectOriginalCandidates();
    await expect(reviewed).toBeSelected();
    await expect($('[data-testid="workbench-artifact-apply-scope"]')).toHaveText(
      expect.stringContaining('整份原始候选'),
    );
    const after = await readReviewState();
    expect(after).toEqual(before);
    expect(after.hasTauriBridge).toBe(false);
    expect(after.blockedFetches).toBe(0);
  });

  it('appends every filled review through the single card action without sending or applying', async () => {
    const before = await readReviewState();
    await (await $('[data-testid="workbench-composer-input"]')).setValue(ORIGINAL_DRAFT);
    await fillReview(0, firstReview);
    await fillReview(1, secondReview);
    const selector = '[data-testid="workbench-artifact-revise"]';
    expect(await $$('[data-testid="workbench-artifact-candidate-revise"]')).toHaveLength(0);
    expect(await (await $(selector)).getText()).toBe('带出全部意见（2）');
    await (await $(selector)).click();
    await browser.waitUntil(async () => {
      const value = await (await $('[data-testid="workbench-composer-input"]')).getValue();
      return value.includes(firstReview.notes) && value.includes(secondReview.notes);
    });
    const draft = await (await $('[data-testid="workbench-composer-input"]')).getValue();
    expect(draft.startsWith(ORIGINAL_DRAFT)).toBe(true);
    for (const review of [firstReview, secondReview]) {
      expect(draft).toContain(review.title);
      expect(draft).toContain(review.summary);
      expect(draft).toContain(review.notes);
    }
    await expectOriginalCandidates();
    const after = await readReviewState();
    expect(after.domains).toEqual(before.domains);
    expect(after.turns).toEqual(before.turns);
    expect(after.runs).toEqual(before.runs);
    expect(after.artifacts).toEqual(before.artifacts);
    expect(after.authorizations).toEqual([]);
    expect(after.decisions.length).toBe(1);
    expect(after.decisions[0]).toMatchObject({
      decision: 'request_revision',
      artifactHash: createHash('sha256').update(ORIGINAL_CONTENT).digest('hex'),
    });
    expect(after.decisions[0].applyTransactionId).toBeUndefined();
    expect(after.hasTauriBridge).toBe(false);
    expect(after.blockedFetches).toBe(0);
  });

  for (const width of [1024, 1440]) {
    it(`keeps whole-artifact scope and review controls bounded at ${width}px`, async () => {
      await browser.setWindowSize(width, 900);
      const windowSize = await browser.getWindowSize();
      const viewportWidth = await browser.execute(() => window.innerWidth);
      if (viewportWidth !== width) {
        await browser.setWindowSize(windowSize.width + width - viewportWidth, windowSize.height);
      }
      await fillReview(0, firstReview);
      await expect($('[data-testid="workbench-artifact-apply"]')).toHaveText('应用到作品');
      const scope = await $('[data-testid="workbench-artifact-apply-scope"]');
      await expect(scope).toHaveText(expect.stringContaining('整份原始候选'));
      await expect(scope).toHaveText(expect.stringContaining('全部'));
      await expect(scope).toHaveText(expect.stringContaining('不改变应用范围'));
      const layout = await browser.execute(() => {
        const selectors = [
          '[data-testid="workbench-artifact-card"]',
          '[data-testid="workbench-artifact-apply-scope"]',
          '[data-testid="workbench-artifact-apply"]',
          '[data-testid="workbench-composer-input"]',
          '.workbench-artifact-candidate-editor',
        ];
        return {
          viewportWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          boxes: selectors.map((selector) => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) throw new Error(`Missing review layout element: ${selector}`);
            const box = element.getBoundingClientRect();
            return {
              selector,
              left: box.left,
              right: box.right,
              width: box.width,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
          }),
        };
      });
      expect(layout.viewportWidth).toBe(width);
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(width);
      for (const box of layout.boxes) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width + 1);
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
      }
      await browser.execute(() => {
        document
          .querySelector('[data-testid="workbench-artifact-apply-scope"]')
          ?.scrollIntoView({ block: 'center' });
      });
      await browser.saveScreenshot(path.join(screenshotDirectory, `artifact-review-${width}.png`));
      expect((await readReviewState()).blockedFetches).toBe(0);
    });
  }
});
