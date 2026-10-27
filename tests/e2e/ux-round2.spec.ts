/* eslint-disable no-console -- this E2E spec must keep NOT_COVERED and geometry diagnostics visible in the runner log. */
import { browser, expect } from '@wdio/globals';
import type { WorldRuleDocument } from '../../src/types/worldRules';
import {
  clickTestId,
  fillTestId,
  findTestIdByAttribute,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';
import {
  assertDiagnosticsAttributed,
  beginHarnessResize,
  captureUxScreenshot,
  clickComposerOutsideSidePanel,
  closeSidePanelThroughToggle,
  createRepairTask,
  ensureSidePanelIntent,
  expandFirstReadGroup,
  expandWorldRuleGroup,
  expectFocusedAriaLabel,
  expectFocusedTestId,
  layoutAnimationTargets,
  openRepairRuleEditor,
  prepareRepairProject,
  readCandidateFirstScreen,
  readRepairBundle,
  readRepairRule,
  readSidePanel,
  readSidebarPreferences,
  readWorkbenchReadGroups,
  readWorldRuleFormFirstScreen,
  repairFixture,
  requestViewportWidth,
  resetDiagnosticsLedger,
  settleHarnessResize,
  waitForRepairArtifacts,
  waitForStableWorkbenchGeometry,
  writeUxEvidence,
  type ViewportMeasurement,
  type WorkbenchGeometry,
} from './interaction-world-rules-fixture';

const DOCK_MIN_WIDTH = 1180;

/** Mirrors the product's compactable read allowlist so a missing group is attributable. */
const COMPACTABLE_READ_TOOLS = new Set([
  'novel.read_context',
  'chapter.read_outline',
  'get_character_states',
  'search_memory',
  'query_world_state',
  'query_character_state',
  'query_chapter_info',
  'novel.read',
  'structure.read',
  'context.read',
  'memory.search',
]);

async function settle(label: string): Promise<WorkbenchGeometry> {
  const settled = await waitForStableWorkbenchGeometry();
  expect(layoutAnimationTargets(settled.geometry)).toEqual([]);
  expect(settled.geometry.documentScrollWidth).toBeLessThanOrEqual(settled.geometry.innerWidth);
  writeUxEvidence('geometry-' + label + '.json', settled.geometry);
  return settled.geometry;
}

async function expectTreeVisible(visible: boolean): Promise<void> {
  const tree = await browser.execute(() => {
    const node = document.querySelector<HTMLElement>('.workbench-tree');
    return node ? getComputedStyle(node).display : null;
  });
  expect(tree !== null && tree !== 'none').toBe(visible);
}

async function waitForGreeting(conversationId: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const bundle = await readRepairBundle(conversationId);
      return bundle.turns.some((turn) => turn.role === 'assistant');
    },
    { timeout: 30_000, timeoutMsg: 'Local greeting did not settle' },
  );
}

describe('round-2 desktop interaction contract', () => {
  beforeEach(resetDiagnosticsLedger);
  afterEach(assertDiagnosticsAttributed);

  it('keeps the reference panel transient until an explicit pin and records final geometry at 1024 and 1440', async function () {
    this.timeout(300_000);
    const project = await prepareRepairProject('参考面板几何');
    const conversationId = await createRepairTask(project, '你好');
    await waitForGreeting(conversationId);
    await fillTestId('workbench-composer-input', repairFixture.unsentDraft);
    const before = await readRepairBundle(conversationId);

    const samples: Array<Record<string, unknown>> = [];
    for (const requestedWidth of [1024, 1440]) {
      await beginHarnessResize('viewport-' + requestedWidth);
      const measurement: ViewportMeasurement = await requestViewportWidth(requestedWidth, 900);
      await settleHarnessResize('viewport-' + requestedWidth);

      // A transient reference panel is an overlay anchored below the live task header.
      await ensureSidePanelIntent('transient');
      const overlay = await settle('transient-' + measurement.innerWidth);
      expect(overlay.panelPosition).toBe('absolute');
      expect(overlay.headerRect).not.toBeNull();
      expect(overlay.pageRect).not.toBeNull();
      expect(overlay.panelRect).not.toBeNull();
      expect(overlay.panelRect!.top).toBeGreaterThanOrEqual(overlay.headerRect!.bottom - 2);
      expect(Math.abs(overlay.panelRect!.right - overlay.innerWidth)).toBeLessThanOrEqual(1);
      expect(overlay.panelRect!.top).toBeGreaterThan(overlay.pageRect!.top);
      const inset = Number.parseFloat(overlay.panelInsetTop);
      expect(Number.isFinite(inset)).toBe(true);
      expect(
        Math.abs(inset - (overlay.headerRect!.bottom - overlay.pageRect!.top)),
      ).toBeLessThanOrEqual(1);
      await captureUxScreenshot(
        'panel-transient-' + overlay.innerWidth + 'x' + overlay.innerHeight + '.png',
      );

      // The composer keeps working: an outside click dismisses the overlay, never the draft.
      const transientClick = await clickComposerOutsideSidePanel();
      if (!transientClick.outsidePanel) {
        throw new Error(
          'NO_UNCOVERED_COMPOSER_POINT: ' +
            JSON.stringify({
              measurement,
              composerRect: transientClick.composerRect,
              panelRect: transientClick.panelRect,
            }),
        );
      }
      await waitForTestIdMissing('workbench-side-panel');
      await expectFocusedTestId('workbench-composer-input');
      expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
        repairFixture.unsentDraft,
      );

      // Only the author's pin control may claim the reference column.
      await ensureSidePanelIntent('pinned');
      expect((await readSidePanel()).pinned).toBe(true);
      const pinnedClick = await clickComposerOutsideSidePanel();
      const docked = measurement.innerWidth > DOCK_MIN_WIDTH;
      if (docked) {
        await waitForTestId('workbench-side-panel');
        const pinned = await settle('pinned-' + measurement.innerWidth);
        expect(pinned.panelPosition).toBe('static');
        expect(Math.abs(pinned.mainRect!.right - pinned.panelRect!.left)).toBeLessThanOrEqual(2);
        expect(Math.abs(pinned.panelRect!.right - pinned.innerWidth)).toBeLessThanOrEqual(1);
        expect(pinned.treeDisplay).not.toBe('none');
        await captureUxScreenshot(
          'panel-pinned-' + pinned.innerWidth + 'x' + pinned.innerHeight + '.png',
        );
        samples.push({
          requestedWidth,
          measurement,
          overlay,
          pinned,
          transientClick,
          pinnedClick,
          docked,
        });
      } else {
        await waitForTestIdMissing('workbench-side-panel');
        console.warn(
          '[NOT_COVERED] innerWidth=' +
            measurement.innerWidth +
            ' (requested ' +
            requestedWidth +
            ', clamped=' +
            measurement.clamped +
            ') cannot show the docked reference column; the narrow pinned panel is still an overlay.',
        );
        samples.push({ requestedWidth, measurement, overlay, transientClick, pinnedClick, docked });
      }
      await ensureSidePanelIntent('transient');
      await closeSidePanelThroughToggle();
      expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
        repairFixture.unsentDraft,
      );
    }

    const coverage = {
      measuredWidths: samples.map(
        (sample) => (sample.measurement as ViewportMeasurement).innerWidth,
      ),
      requestedWidths: samples.map((sample) => sample.requestedWidth),
      dockedCovered: samples.some((sample) => sample.docked === true),
    };
    writeUxEvidence('panel-geometry.json', { coverage, samples });
    if (!coverage.dockedCovered) {
      console.warn(
        '[NOT_COVERED] No requested width reached the >1180 dock threshold; the pinned column contract stays covered by tests/browser/workbench-layout.browser.spec.ts.',
      );
    }

    await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', conversationId);
    const after = await readRepairBundle(conversationId);
    expect(after.turns).toEqual(before.turns);
    expect(after.runs).toEqual(before.runs);
    expect(after.artifacts).toEqual(before.artifacts);
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
      repairFixture.unsentDraft,
    );
  });

  it('enters session-only focus and restores the tree, panel and draft through every exit path', async function () {
    this.timeout(300_000);
    const project = await prepareRepairProject('专注会话布局');
    const conversationId = await createRepairTask(project, '你好');
    await waitForGreeting(conversationId);
    await fillTestId('workbench-composer-input', repairFixture.unsentDraft);
    const before = await readRepairBundle(conversationId);

    // The tree must be expanded before focus so its restoration is observable.
    const treeToggle = await waitForTestId('shell-toggle-sidebar');
    if ((await treeToggle.getAttribute('aria-expanded')) !== 'true') await treeToggle.click();
    await waitForTestIdAttribute('app-shell', 'data-sidebar', 'expanded');
    await expectTreeVisible(true);
    const preferencesBefore = await readSidebarPreferences();

    await ensureSidePanelIntent('transient');
    await clickTestId('workbench-toggle-focus');
    await waitForTestIdAttribute('app-shell', 'data-focus-mode', 'true');
    await waitForTestIdAttribute('app-shell', 'data-sidebar', 'collapsed');
    const focused = await settle('focus-entered');
    expect(focused.treeDisplay).toBe('none');
    expect(focused.panelTemporarilyHidden).toBe(true);
    expect(focused.panelHidden).toBe(true);
    expect(
      await browser.execute(
        () =>
          document.querySelector('[data-testid="workbench-side-panel"]')?.hasAttribute('inert') ??
          false,
      ),
    ).toBe(true);
    await expectTreeVisible(false);
    expect(await readSidebarPreferences()).toEqual(preferencesBefore);
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
      repairFixture.unsentDraft,
    );
    await captureUxScreenshot('focus-hidden-tree-and-panel.png');

    // Exit 1: the same control restores the pre-focus layout without rewriting preferences.
    await clickTestId('workbench-toggle-focus');
    await waitForTestIdAttribute('app-shell', 'data-focus-mode', 'false');
    await waitForTestIdAttribute('app-shell', 'data-sidebar', 'expanded');
    const restored = await settle('focus-exited-by-toggle');
    expect(restored.treeDisplay).not.toBe('none');
    expect(restored.panelTemporarilyHidden).toBe(false);
    expect(restored.panelHidden).toBe(false);
    await expectTreeVisible(true);
    expect(await readSidebarPreferences()).toEqual(preferencesBefore);
    await captureUxScreenshot('focus-restored.png');

    // Exit 2: the frame bar sidebar control leaves focus and shows the tree again.
    await clickTestId('workbench-toggle-focus');
    await waitForTestIdAttribute('app-shell', 'data-focus-mode', 'true');
    await clickTestId('shell-toggle-sidebar');
    await waitForTestIdAttribute('app-shell', 'data-focus-mode', 'false');
    await waitForTestIdAttribute('app-shell', 'data-sidebar', 'expanded');
    const barExit = await settle('focus-exited-by-frame-bar');
    expect(barExit.treeDisplay).not.toBe('none');
    await expectTreeVisible(true);

    // Exit 3: Ctrl+K hands over to search with the tree visible and its field focused.
    await clickTestId('workbench-toggle-focus');
    await waitForTestIdAttribute('app-shell', 'data-focus-mode', 'true');
    await browser.keys(['Control', 'k']);
    await waitForTestIdAttribute('app-shell', 'data-focus-mode', 'false');
    await waitForTestIdAttribute('app-shell', 'data-sidebar', 'expanded');
    await expectFocusedAriaLabel('搜索创作任务');
    const searchExit = await settle('focus-exited-by-ctrl-k');
    expect(searchExit.treeDisplay).not.toBe('none');
    await captureUxScreenshot('focus-ctrl-k-search.png');

    // Focus is presentation only: task, draft and persisted runs stay untouched.
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
      repairFixture.unsentDraft,
    );
    await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', conversationId);
    const after = await readRepairBundle(conversationId);
    expect(after.turns).toEqual(before.turns);
    expect(after.runs).toEqual(before.runs);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.artifacts).toEqual(before.artifacts);
    expect(await readSidebarPreferences()).toEqual(preferencesBefore);
    writeUxEvidence('focus-round-trip.json', {
      conversationId,
      preferencesBefore,
      preferencesAfter: await readSidebarPreferences(),
      focused,
      restored,
      barExit,
      searchExit,
      runs: after.runs.length,
    });
  });

  it('groups finished reads into one disclosure, keeps failures outside it, and shows a human candidate header', async function () {
    this.timeout(300_000);
    const project = await prepareRepairProject('读取分组与候选首屏');
    const conversationId = await createRepairTask(project);
    const bundle = await waitForRepairArtifacts(conversationId);
    const candidate = bundle.artifacts.find((card) => card.artifactType === 'chapter_text')!;
    // The persisted candidate is the source of truth; wait for its own card before reading DOM.
    await findTestIdByAttribute(
      'workbench-artifact-card',
      'data-artifact-id',
      candidate.artifactId,
    );
    const observation = await readWorkbenchReadGroups();
    const runIds = new Set(bundle.runs.map((run) => run.runId));
    const persistedToolEvents = bundle.toolEvents.filter((event) => runIds.has(event.runId));

    // Grouping may compact a finished read, never hide or duplicate a persisted tool fact.
    expect(observation.toolEvents).toHaveLength(persistedToolEvents.length);
    expect(new Set(observation.presentationIds).size).toBe(observation.presentationIds.length);
    expect(observation.errorsInsideGroups).toBe(0);
    expect(observation.presentationIds).toContain('artifact:' + candidate.cardId);

    const reads = persistedToolEvents.filter((event) => COMPACTABLE_READ_TOOLS.has(event.toolName));
    const succeededReads = reads.filter((event) => event.status === 'succeeded' && !event.error);
    if (succeededReads.length >= 2 && observation.groupCount === 0) {
      throw new Error(
        'COMPLETED_READ_GROUP_MISSING (if a persisted read carried an incomplete/unknown ' +
          'receipt marker the product keeps it visible, so verify the result keys below before ' +
          'changing the product): ' +
          JSON.stringify(
            reads.map((event) => ({
              toolName: event.toolName,
              status: event.status,
              error: event.error ?? null,
              resultKeys:
                event.result && typeof event.result === 'object'
                  ? Object.keys(event.result as Record<string, unknown>)
                  : null,
            })),
          ),
      );
    }
    if (observation.groupCount > 0) {
      expect(observation.groupDetailsOpen.every((open) => open === false)).toBe(true);
      expect(observation.groupReadEventIds.length).toBe(observation.groupCount);
      observation.groupReadEventIds.forEach((ids, index) => {
        expect(ids.length).toBeGreaterThanOrEqual(2);
        expect(observation.groupToolEvents[index]).toBe(ids.length);
        expect(observation.groupToolStatuses[index].every((status) => status === 'succeeded')).toBe(
          true,
        );
      });
      const rowsBeforeExpand = observation.groupToolEvents[0];
      await expandFirstReadGroup();
      const expanded = await readWorkbenchReadGroups();
      expect(expanded.groupDetailsOpen[0]).toBe(true);
      expect(expanded.groupToolEvents[0]).toBe(rowsBeforeExpand);
      expect(expanded.errorsInsideGroups).toBe(0);
      await captureUxScreenshot('read-group-expanded.png');
      writeUxEvidence('read-group.json', { observation, expanded });
    } else {
      console.warn(
        '[NOT_COVERED] The deterministic runtime produced fewer than two contiguous successful reads for this run; grouping stays covered by the adjacent behavior tests.',
      );
      writeUxEvidence('read-group.json', { observation, expanded: null });
    }

    const screen = await readCandidateFirstScreen(candidate.artifactId);
    expect(screen.number).toBe('候选 01');
    expect(screen.target).toContain(repairFixture.title + ' / 读取分组与候选首屏');
    expect(screen.target).toContain('第一章 渡口');
    expect(screen.target).not.toContain(candidate.artifactId);
    expect(screen.target).not.toContain(project.chapterIds[0]);
    expect(screen.nextStep).toBe('下一步：查看候选并决定下一步');
    expect(screen.revisionSource).toBeNull();
    expect(screen.model).toMatch(/^来源：\S/u);
    await captureUxScreenshot('candidate-first-screen.png');
    writeUxEvidence('candidate-first-screen.json', screen);
  });

  it('shows scope and cost on the world-rule first screen, separates fact, belief and source, and previews the full text before the native save', async function () {
    this.timeout(300_000);
    const project = await prepareRepairProject('世界表单首屏');
    const baseline = await readRepairRule(project.novelId, project.ruleSystemId);
    const baselineDocument = baseline.structuredJson
      ? (JSON.parse(baseline.structuredJson) as WorldRuleDocument)
      : null;
    const editorId = await openRepairRuleEditor(project);

    const firstScreen = await readWorldRuleFormFirstScreen(editorId);
    expect(firstScreen.contentVisible).toBe(true);
    expect(firstScreen.scopeVisible).toBe(true);
    expect(firstScreen.costVisible).toBe(true);
    expect(firstScreen.beliefHintVisible).toBe(false);
    for (const [group, open] of Object.entries(firstScreen.detailsOpen)) {
      if (open) throw new Error('WORLD_RULE_GROUP_NOT_COLLAPSED_ON_FIRST_SCREEN: ' + group);
    }
    if (firstScreen.groupTexts['world-rule-group-world'].includes('知情角色')) {
      throw new Error('WORLD_FACT_GROUP_LEAKS_BELIEF_FIELDS');
    }
    if (firstScreen.groupTexts['world-rule-group-source'].includes('依赖资产 ID') === false) {
      throw new Error('WORLD_SOURCE_GROUP_MISSING_DEPENDENCIES');
    }

    const statement = [
      '渡船抢渡需要可解释的路径与代价，并且必须写明由谁承担后果。',
      '闸门调度员只有在潮位窗口内才能放行，违令者需接受调查并补偿设施损坏。',
      '救援船例外必须单独审批，不从传闻推导自动豁免，也不改变已采用正文。',
    ].join('\n');
    expect(statement.length).toBeGreaterThan(80);
    await fillTestId('setting-content', statement);
    await fillTestId('world-rule-scope', '雾港渡口的普通渡船，不含军用与特许航线');
    await fillTestId('world-rule-cost', '补偿设施损坏并接受港务调查，期间不得再申请优先通行');

    // Belief is not a world fact and the hint says so without erasing filled content.
    await (await waitForTestId('world-rule-kind')).selectByAttribute('value', 'character_belief');
    expect((await readWorldRuleFormFirstScreen(editorId)).beliefHintVisible).toBe(true);
    await (await waitForTestId('world-rule-kind')).selectByAttribute('value', 'world_fact');
    expect((await readWorldRuleFormFirstScreen(editorId)).beliefHintVisible).toBe(false);
    expect(await (await waitForTestId('setting-content')).getValue()).toBe(statement);

    await expandWorldRuleGroup(editorId, 'world-rule-group-world');
    await expandWorldRuleGroup(editorId, 'world-rule-knowledge-toggle');
    await expandWorldRuleGroup(editorId, 'world-rule-group-source');
    const expandedForm = await readWorldRuleFormFirstScreen(editorId);
    expect(expandedForm.detailsOpen['world-rule-group-world']).toBe(true);
    expect(expandedForm.detailsOpen['world-rule-knowledge-toggle']).toBe(true);
    expect(expandedForm.detailsOpen['world-rule-group-source']).toBe(true);
    expect(expandedForm.groupTexts['world-rule-group-world']).toContain('不是角色听说或相信的版本');
    expect(expandedForm.groupTexts['world-rule-knowledge-toggle']).toContain('知情角色');
    expect(expandedForm.groupTexts['world-rule-knowledge-toggle']).toContain('角色仍可能不知道');
    expect(expandedForm.groupTexts['world-rule-group-source']).toContain('来源引用');
    expect(expandedForm.groupTexts['world-rule-group-source']).toContain('自动获得作者确认');
    await captureUxScreenshot('world-form-first-screen.png');

    await clickTestId('setting-impact-preview');
    await waitForTestId('setting-impact-result');
    const title = await (await waitForTestId('setting-title')).getValue();
    const forbidden = await (await waitForTestId('setting-forbidden-rules')).getValue();
    const expectedBody = [title.trim(), statement, forbidden ? '禁止项：' + forbidden : '']
      .filter(Boolean)
      .join('\n\n');
    const { previewText, editorMessage } = await browser.execute((id) => {
      const editor = document.querySelector('[data-testid="' + id + '"]');
      if (!editor) throw new Error('The world-rule editor is not mounted: ' + id);
      return {
        previewText:
          editor.querySelector('[data-testid="setting-change-preview"]')?.textContent ?? '',
        editorMessage:
          editor.querySelector('[data-testid="setting-editor-message"]')?.textContent?.trim() ?? '',
      };
    }, editorId);
    expect(previewText).toBe(expectedBody);
    expect(previewText).not.toContain('…');
    await expandWorldRuleGroup(editorId, 'setting-impact-fingerprint');
    const previewHash = await (await waitForTestId('setting-impact-preview-hash')).getText();
    expect(previewHash.length).toBeGreaterThan(20);
    expect(await (await waitForTestId('setting-save')).isEnabled()).toBe(false);
    expect(editorMessage).toBe('');
    await captureUxScreenshot('world-form-preview-full-text.png');

    // A bound preview never survives an edit: nothing is written without a fresh author decision.
    await fillTestId('setting-content', statement + '\n补充：例外不适用于军舰。');
    await waitForTestIdMissing('setting-impact-result');
    expect(await (await waitForTestId('setting-save')).isEnabled()).toBe(false);
    expect(await readRepairRule(project.novelId, project.ruleSystemId)).toEqual(baseline);

    await clickTestId('setting-impact-preview');
    await waitForTestId('setting-impact-result');
    const finalStatement = await (await waitForTestId('setting-content')).getValue();
    await clickTestId('setting-author-confirm');
    const save = await waitForTestId('setting-save');
    await save.waitForClickable({ timeout: 30_000 });
    await save.click();
    await waitForTestIdMissing(editorId);

    // The desktop writes through the native path; the browser-only guard never runs here.
    const updated = await readRepairRule(project.novelId, project.ruleSystemId);
    expect(updated.content).toBe(finalStatement);
    expect(updated.updatedAt).not.toBe(baseline.updatedAt);
    const savedDocument = JSON.parse(updated.structuredJson!) as WorldRuleDocument;
    expect(savedDocument.contract).toBe('world_rules_v1');
    expect(savedDocument.statement).toBe(finalStatement);
    expect(savedDocument.scope.summary).toBe('雾港渡口的普通渡船，不含军用与特许航线');
    expect(savedDocument.boundaries.cost).toBe(
      '补偿设施损坏并接受港务调查，期间不得再申请优先通行',
    );
    expect(savedDocument.identity.revision).toBeGreaterThan(
      baselineDocument?.identity.revision ?? 0,
    );
    writeUxEvidence('world-form-native-save.json', {
      storageMode: 'sqlite',
      previewHash,
      previewText,
      finalStatement,
      savedDocument,
    });
  });
});
