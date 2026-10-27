/* eslint-disable no-console -- this E2E spec must keep NOT_COVERED and viewport diagnostics visible in the runner log. */
import { browser, expect } from '@wdio/globals';
import type { WorldRuleDocument } from '../../src/types/worldRules';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';
import {
  artifactControl,
  assertDiagnosticsAttributed,
  beginHarnessResize,
  captureUxScreenshot,
  clickArtifactControl,
  clickComposerOutsideSidePanel,
  closeSidePanelThroughToggle,
  createRepairTask,
  ensureSidePanelIntent,
  expectFocusedTestId,
  layoutAnimationTargets,
  openRepairRuleEditor,
  openRepairWorkbench,
  prepareRepairProject,
  previewAndSaveRepairRule,
  readCandidateFirstScreen,
  readRepairArtifact,
  readRepairBundle,
  readRepairDrafts,
  readRepairRule,
  readSidePanel,
  repairFixture,
  requestViewportWidth,
  resetDiagnosticsLedger,
  settleHarnessResize,
  waitForRepairArtifacts,
  waitForStableWorkbenchGeometry,
  writeUxEvidence,
  type RepairConversationBundle,
  type ViewportMeasurement,
} from './interaction-world-rules-fixture';

async function selectTask(conversationId: string): Promise<void> {
  await (
    await findTestIdByAttribute('workbench-task', 'data-conversation-id', conversationId)
  ).click();
  await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', conversationId);
}

const DOCK_MIN_WIDTH = 1180;

interface ViewportProbe {
  width: number;
  wide: boolean;
  measurement: ViewportMeasurement | null;
}

/** The docked reference column is only observable above the product threshold. Asking the native
 * window for a wide viewport is a harness action, so it starts only from an error-free app and
 * every notice it produces is attributed to this exact phase, never excused in general. */
async function probeDockedViewport(): Promise<ViewportProbe> {
  const initialWidth = await browser.execute(() => innerWidth);
  if (initialWidth > DOCK_MIN_WIDTH) return { width: initialWidth, wide: true, measurement: null };
  await beginHarnessResize('docked-viewport');
  const measurement = await requestViewportWidth(1600, 900);
  await settleHarnessResize('docked-viewport');
  if (measurement.innerWidth <= DOCK_MIN_WIDTH) {
    console.warn(
      '[NOT_COVERED] innerWidth=' +
        measurement.innerWidth +
        ' (requested 1600, clamped=' +
        measurement.clamped +
        ') keeps the reference panel in overlay form; the docked column stays covered by tests/browser/workbench-layout.browser.spec.ts.',
    );
  }
  return {
    width: measurement.innerWidth,
    wide: measurement.innerWidth > DOCK_MIN_WIDTH,
    measurement,
  };
}

async function settledGeometry(label: string) {
  const settled = await waitForStableWorkbenchGeometry();
  expect(layoutAnimationTargets(settled.geometry)).toEqual([]);
  writeUxEvidence('repair-geometry-' + label + '.json', settled.geometry);
  return settled.geometry;
}

async function expectSidebarState(left: boolean, right: boolean): Promise<void> {
  await waitForTestIdAttribute('app-shell', 'data-sidebar', left ? 'expanded' : 'collapsed');
  expect(await (await waitForTestId('shell-toggle-sidebar')).getAttribute('aria-expanded')).toBe(
    String(left),
  );
  expect(
    await (await waitForTestId('workbench-toggle-side-panel')).getAttribute('aria-expanded'),
  ).toBe(String(right));
  if (right) await waitForTestId('workbench-side-panel');
  else await waitForTestIdMissing('workbench-side-panel');
}

async function reviewAuthorizationFromRoute(): Promise<string> {
  const route = await browser.execute(() => location.hash);
  const id = new URLSearchParams(route.split('?')[1]).get('authorizationId');
  if (!id) throw new Error('Review route did not expose an authorization identity');
  return id;
}

async function expectCandidateCausality(bundle: RepairConversationBundle): Promise<void> {
  for (const card of bundle.artifacts) {
    expect(card.runId).toBeTruthy();
    const run = bundle.runs.find((item) => item.runId === card.runId);
    expect(run).toBeDefined();
    if (!run) throw new Error('Candidate did not resolve to its persisted run: ' + card.artifactId);
    expect(run.turnId).toBeTruthy();
    if (!run.turnId) throw new Error('Candidate run has no persisted turn: ' + run.runId);
    const sourceTurnId = run.turnId;
    // The card's own turn column stays NULL on the desktop; when it is present it must agree.
    if (card.turnId) expect(card.turnId).toBe(sourceTurnId);
    expect(bundle.turns.some((turn) => turn.turnId === sourceTurnId && turn.role === 'user')).toBe(
      true,
    );
    await findTestIdByAttribute('workbench-artifact-card', 'data-artifact-id', card.artifactId);
    const projection = await browser.execute(
      (conversationId, turnId, runId, artifactId) => {
        const entries = Array.from(
          document.querySelectorAll<HTMLElement>('[data-presentation-id]'),
        ).filter((node) => node.dataset.conversationId === conversationId);
        const candidate = document.querySelector<HTMLElement>(
          '[data-testid="workbench-artifact-card"][data-artifact-id="' + artifactId + '"]',
        );
        const source = document.querySelector<HTMLElement>(
          '[data-testid="workbench-turn"][data-turn-id="' + turnId + '"]',
        );
        const candidateEntry = candidate?.closest<HTMLElement>('[data-presentation-id]');
        const candidateIndex = candidateEntry ? entries.indexOf(candidateEntry) : -1;
        const toolIndexes = entries.flatMap((node, index) => {
          const containsTool =
            node.matches('[data-testid="workbench-tool-event"]') ||
            node.querySelector('[data-testid="workbench-tool-event"]') !== null;
          return node.dataset.runId === runId && containsTool ? [index] : [];
        });
        return {
          ids: entries.map((node) => node.dataset.presentationId),
          candidateIndex,
          toolIndexes,
          candidateTurn: candidateEntry?.dataset.turnId,
          candidateRun: candidateEntry?.dataset.runId,
          sourceBeforeCandidate: Boolean(
            source &&
            candidate &&
            source.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        };
      },
      bundle.conversation.conversationId,
      sourceTurnId,
      card.runId,
      card.artifactId,
    );
    expect(projection.ids.length).toBeGreaterThan(0);
    expect(new Set(projection.ids).size).toBe(projection.ids.length);
    expect(projection.candidateIndex).toBeGreaterThanOrEqual(0);
    expect(projection.candidateTurn).toBe(sourceTurnId);
    expect(projection.candidateRun).toBe(card.runId);
    expect(projection.sourceBeforeCandidate).toBe(true);
    expect(projection.toolIndexes.length).toBeGreaterThan(0);
    expect(projection.toolIndexes.every((index) => index < projection.candidateIndex)).toBe(true);
  }
}

// This file runs only through the isolated desktop runner. No test writes a
// conversation, decision, authorization, rule change or adoption through the bridge.
describe('production interaction and world-rule repairs', () => {
  beforeEach(resetDiagnosticsLedger);
  afterEach(assertDiagnosticsAttributed);

  it('closes temporary insertion menus, retains docked references, and keeps the current task and draft', async function () {
    const project = await prepareRepairProject('临时面板与当前项目');
    const taskA = await createRepairTask(project, '你好');
    const taskB = await createRepairTask(project, '你好');
    expect(taskB).not.toBe(taskA);
    await selectTask(taskA);
    await browser.waitUntil(
      async () => {
        const bundle = await readRepairBundle(taskA);
        return bundle.turns.some((turn) => turn.role === 'assistant');
      },
      { timeout: 30_000, timeoutMsg: 'Local greeting did not settle' },
    );
    await fillTestId('workbench-composer-input', repairFixture.unsentDraft);
    const before = await readRepairBundle(taskA);

    await (
      await findTestIdByAttribute('workbench-project', 'data-novel-id', project.novelId)
    ).click();
    await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', taskA);
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
      repairFixture.unsentDraft,
    );

    await clickTestId('workbench-composer-attach');
    await waitForTestId('workbench-composer-attach-menu');
    await clickTestId('workbench-composer-attach');
    await waitForTestIdMissing('workbench-composer-attach-menu');
    await clickTestId('workbench-composer-attach');
    await waitForTestId('workbench-composer-attach-menu');
    await clickTestId('workbench-composer-input');
    await waitForTestIdMissing('workbench-composer-attach-menu');
    await expectFocusedTestId('workbench-composer-input');
    await clickTestId('workbench-composer-attach');
    await waitForTestId('workbench-composer-attach-menu');
    await browser.keys('Escape');
    await waitForTestIdMissing('workbench-composer-attach-menu');
    await expectFocusedTestId('workbench-composer-attach');

    const viewport = await probeDockedViewport();
    if (!viewport.wide) expect(viewport.width).toBeLessThanOrEqual(DOCK_MIN_WIDTH);

    // The header entry opens the panel; the panel's own control closes it again.
    await clickTestId('workbench-current-plugins');
    await waitForTestId('workbench-plugin-panel');
    await clickTestId('workbench-plugin-close');
    await waitForTestIdMissing('workbench-plugin-panel');

    // Round-2 contract: a reference panel opens transient, so clicking the composer dismisses it
    // at every width, and neither the draft nor the composer focus is taken away.
    await ensureSidePanelIntent('transient');
    const transientClick = await clickComposerOutsideSidePanel();
    expect(transientClick.outsidePanel).toBe(true);
    await waitForTestIdMissing('workbench-side-panel');
    await expectFocusedTestId('workbench-composer-input');

    // The overlay starts below the live task header, so the same header entry closes it again.
    await clickTestId('workbench-current-plugins');
    await waitForTestId('workbench-plugin-panel');
    const overlay = await settledGeometry('transient-overlay');
    expect(overlay.panelPosition).toBe('absolute');
    expect(overlay.headerRect).not.toBeNull();
    expect(overlay.panelRect).not.toBeNull();
    expect(overlay.panelRect!.top).toBeGreaterThanOrEqual(overlay.headerRect!.bottom - 2);
    expect(Math.abs(overlay.panelRect!.right - overlay.innerWidth)).toBeLessThanOrEqual(1);
    await clickTestId('workbench-current-plugins');
    await waitForTestIdMissing('workbench-plugin-panel');

    // Only an explicit pin keeps the reference panel open while the author keeps writing.
    await ensureSidePanelIntent('pinned');
    const pinnedClick = await clickComposerOutsideSidePanel();
    expect(pinnedClick.outsidePanel).toBe(true);
    let pinned: Awaited<ReturnType<typeof settledGeometry>> | null = null;
    if (viewport.wide) {
      await waitForTestId('workbench-side-panel');
      pinned = await settledGeometry('pinned-dock');
      expect(pinned.panelPosition).toBe('static');
      expect(Math.abs(pinned.mainRect!.right - pinned.panelRect!.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(pinned.panelRect!.right - pinned.innerWidth)).toBeLessThanOrEqual(1);
      await captureUxScreenshot('repair-pinned-dock.png');
    } else {
      // Below the dock threshold a pinned panel is still an overlay, so the outside click
      // dismisses it; that narrow contract is asserted instead of guessed away.
      await waitForTestIdMissing('workbench-side-panel');
      console.warn(
        '[NOT_COVERED] innerWidth=' +
          viewport.width +
          ' cannot show the docked reference column; the pinned overlay still dismissed on an outside click.',
      );
    }
    await expectFocusedTestId('workbench-composer-input');
    expect(await readSidePanel()).toMatchObject(
      viewport.wide ? { open: true, pinned: true } : { open: false },
    );
    writeUxEvidence('repair-panel-states.json', {
      viewport,
      transientClick,
      overlay,
      pinnedClick,
      pinned,
    });
    // Restore the documented defaults so the next scenario starts from a transient panel.
    await ensureSidePanelIntent('transient');
    await closeSidePanelThroughToggle();

    // Escape owns the panel that currently holds focus and hands focus back to its entry.
    await clickTestId('workbench-current-plugins');
    await waitForTestId('workbench-plugin-panel');
    await browser.keys('Escape');
    await waitForTestIdMissing('workbench-plugin-panel');
    await expectFocusedTestId('workbench-current-plugins');
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
      repairFixture.unsentDraft,
    );
    await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', taskA);
    const after = await readRepairBundle(taskA);
    expect(after.turns).toEqual(before.turns);
    expect(after.runs).toEqual(before.runs);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.artifacts).toEqual(before.artifacts);
  });

  it('keeps revision sources and unsent text isolated between tasks A and B without adopting either candidate', async () => {
    const project = await prepareRepairProject('修订来源与草稿隔离');
    const taskA = await createRepairTask(project);
    const bundleA = await waitForRepairArtifacts(taskA);
    await expectCandidateCausality(bundleA);
    const artifactA = bundleA.artifacts.find((card) => card.artifactType === 'chapter_text')!;
    const originalA = await readRepairArtifact(artifactA.artifactId);
    await fillTestId('workbench-composer-input', repairFixture.unsentDraft);
    await clickArtifactControl(artifactA.artifactId, 'workbench-artifact-revise');
    const sourceA = await waitForTestId('workbench-revision-source');
    const sourceLabel = await sourceA.getText();
    const draftA = await (await waitForTestId('workbench-composer-input')).getValue();
    expect(draftA).toContain(repairFixture.unsentDraft);
    for (const id of [artifactA.artifactId, taskA, project.novelId, project.chapterIds[0]]) {
      expect(draftA).not.toContain(id);
    }
    const afterRevision = await readRepairBundle(taskA);
    expect(afterRevision.runs).toEqual(bundleA.runs);
    expect(
      afterRevision.decisions.filter(
        (decision) =>
          decision.artifactId === artifactA.artifactId && decision.decision === 'request_revision',
      ),
    ).toHaveLength(1);

    // A later chapter stays blocked until the previous one is adopted (product rule), and this
    // scenario must not adopt anything, so the second task keeps the same chapter target.
    const taskB = await createRepairTask(
      project,
      '生成本章正文，2000字，改用更克制的叙述；第二条任务与任务A互不共享草稿。',
      project.chapterIds[0],
    );
    const bundleB = await waitForRepairArtifacts(taskB);
    await expectCandidateCausality(bundleB);
    const artifactB = bundleB.artifacts.find((card) => card.artifactType === 'chapter_text')!;
    const draftB = '任务B尚未发送的意见：保留对岸居民的不同说法。';
    await fillTestId('workbench-composer-input', draftB);
    await waitForTestIdMissing('workbench-revision-source');

    await selectTask(taskA);
    expect(await (await waitForTestId('workbench-revision-source')).getText()).toBe(sourceLabel);
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(draftA);
    await clickTestId('workbench-clear-revision-source');
    await waitForTestIdMissing('workbench-revision-source');
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(draftA);
    expect((await readRepairBundle(taskA)).runs).toEqual(bundleA.runs);

    await selectTask(taskB);
    await waitForTestIdMissing('workbench-revision-source');
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(draftB);
    expect((await readRepairBundle(taskB)).decisions).toEqual(bundleB.decisions);
    const preservedA = await readRepairArtifact(artifactA.artifactId);
    expect(preservedA.rawContent).toBe(originalA.rawContent);
    expect(preservedA.artifact.contentHash).toBe(originalA.artifact.contentHash);
    expect((await readRepairArtifact(artifactB.artifactId)).artifact.sourceChapterId).toBe(
      project.chapterIds[0],
    );
    expect(artifactB.artifactId).not.toBe(artifactA.artifactId);
    expect((await readRepairDrafts(project.chapterIds[0])).some((draft) => draft.isAdopted)).toBe(
      false,
    );
    expect((await readRepairDrafts(project.chapterIds[1])).some((draft) => draft.isAdopted)).toBe(
      false,
    );
  });

  it('revises an explicitly chosen older pending candidate rather than silently using the newest candidate', async function () {
    this.timeout(240_000);
    const project = await prepareRepairProject('同任务旧候选来源');
    const conversationId = await createRepairTask(project);
    const first = await waitForRepairArtifacts(conversationId);
    const candidateA = first.artifacts.find((card) => card.artifactType === 'chapter_text')!;
    const sourceA = await readRepairArtifact(candidateA.artifactId);

    await fillTestId('workbench-composer-input', '生成本章正文，2000字。');
    await waitForTestIdMissing('workbench-revision-source');
    await clickTestId('workbench-send-task');
    const second = await waitForRepairArtifacts(conversationId, 'chapter_text', 2);
    const candidateB = second.artifacts.find(
      (card) => card.artifactType === 'chapter_text' && card.artifactId !== candidateA.artifactId,
    )!;
    expect(candidateB).toBeDefined();
    expect(second.decisions).toEqual(first.decisions);
    await expectCandidateCausality(second);

    await clickArtifactControl(candidateA.artifactId, 'workbench-artifact-revise');
    await waitForTestId('workbench-revision-source');
    await fillTestId(
      'workbench-composer-input',
      '重新修改这一版正文，节奏放慢，着重渲染风雨交加与心理压迫感',
    );
    const requestText = await (await waitForTestId('workbench-composer-input')).getValue();
    expect(requestText).not.toContain(candidateA.artifactId);
    expect(requestText).not.toContain(candidateB.artifactId);
    await clickTestId('workbench-send-task');
    const third = await waitForRepairArtifacts(conversationId, 'chapter_text', 3);
    const revised = third.artifacts.find(
      (card) =>
        card.artifactType === 'chapter_text' &&
        ![candidateA.artifactId, candidateB.artifactId].includes(card.artifactId),
    )!;
    expect(revised).toBeDefined();
    const revisedContent = await readRepairArtifact(revised.artifactId);
    expect(revisedContent.artifact.parentArtifactId).toBe(candidateA.artifactId);
    expect(revisedContent.artifact.parentArtifactId).not.toBe(candidateB.artifactId);
    expect(revisedContent.artifact.derivationType).toBe('revision');

    // Author-facing identity is asserted on the candidate's own DOM, never on guessed ids.
    const originalScreen = await readCandidateFirstScreen(candidateA.artifactId);
    expect(originalScreen.number).toBe('候选 01');
    expect(originalScreen.target).toContain(repairFixture.title + ' / 同任务旧候选来源');
    expect(originalScreen.target).toContain('第一章 渡口');
    expect(originalScreen.target).not.toContain(candidateA.artifactId);
    expect(originalScreen.target).not.toContain(project.chapterIds[0]);
    expect(originalScreen.revisionSource).toBeNull();
    expect(originalScreen.nextStep).toBe('下一步：发送修订意见以生成新候选');
    const revisedScreen = await readCandidateFirstScreen(revised.artifactId);
    expect(revisedScreen.number).toBe('候选 03');
    expect(revisedScreen.revisionSource).toBe('修订自候选 01');
    expect(revisedScreen.target).toBe(originalScreen.target);
    expect(revisedScreen.nextStep).toBe('下一步：查看候选并决定下一步');
    expect(revisedScreen.model).toMatch(/^来源：\S/u);
    expect(revisedScreen.model).not.toContain(revised.artifactId);
    await captureUxScreenshot('repair-candidate-first-screen.png');
    expect(
      third.decisions
        .filter((decision) => decision.decision === 'request_revision')
        .map((decision) => decision.artifactId),
    ).toEqual([candidateA.artifactId]);
    const preserved = await readRepairArtifact(candidateA.artifactId);
    expect(preserved.rawContent).toBe(sourceA.rawContent);
    expect(preserved.artifact.contentHash).toBe(sourceA.artifact.contentHash);
    expect((await readRepairDrafts(project.chapterIds[0])).some((draft) => draft.isAdopted)).toBe(
      false,
    );
    await expectCandidateCausality(third);
  });

  it('supports all four independent sidebar states and returns every reference view to its launcher', async function () {
    const project = await prepareRepairProject('左右栏独立四态');
    const conversationId = await createRepairTask(project, '你好');
    const viewport = await probeDockedViewport();
    await fillTestId('workbench-composer-input', repairFixture.unsentDraft);
    // Round-2 contract: the panel opens as an overlay below the task header at every width, so the
    // header entry is the reachable way to close it and the four left/right states stay independent.
    const closeRightPanel = () => closeSidePanelThroughToggle();
    const rightToggle = await waitForTestId('workbench-toggle-side-panel');
    if ((await rightToggle.getAttribute('aria-expanded')) === 'true') await closeRightPanel();
    const leftToggle = await waitForTestId('shell-toggle-sidebar');
    if ((await leftToggle.getAttribute('aria-expanded')) === 'true') await leftToggle.click();
    await expectSidebarState(false, false);
    await clickTestId('shell-toggle-sidebar');
    await expectSidebarState(true, false);
    await clickTestId('workbench-toggle-side-panel');
    await expectSidebarState(true, true);
    await clickTestId('shell-toggle-sidebar');
    await expectSidebarState(false, true);
    await closeRightPanel();
    await expectSidebarState(false, false);
    await clickTestId('shell-toggle-sidebar');
    await expectSidebarState(true, false);

    await clickTestId('workbench-toggle-side-panel');
    // Only an explicit pin may claim the reference column; the dock itself is width dependent.
    await ensureSidePanelIntent('pinned');
    const pinnedStates = await settledGeometry('four-states-pinned');
    expect(pinnedStates.panelPosition).toBe(viewport.wide ? 'static' : 'absolute');
    writeUxEvidence('repair-four-states.json', { viewport, pinned: pinnedStates });
    for (const view of ['context', 'artifacts', 'events', 'plugins']) {
      await waitForTestIdAttribute('workbench-side-panel', 'data-view', 'launcher');
      await clickTestId('workbench-side-open-' + view);
      await waitForTestIdAttribute('workbench-side-panel', 'data-view', view);
      await clickTestId('workbench-side-back');
    }
    await waitForTestIdAttribute('workbench-side-panel', 'data-view', 'launcher');
    await closeRightPanel();
    await expectSidebarState(true, false);
    await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', conversationId);
    expect(await (await waitForTestId('workbench-composer-input')).getValue()).toBe(
      repairFixture.unsentDraft,
    );
  });

  it('resumes the same issued review after navigation and a real process restart without saving or adopting', async function () {
    this.timeout(180_000);
    const project = await prepareRepairProject('已确认候选恢复审阅');
    const conversationId = await createRepairTask(project);
    const initial = await waitForRepairArtifacts(conversationId);
    const candidate = initial.artifacts.find((card) => card.artifactType === 'chapter_text')!;
    const content = await readRepairArtifact(candidate.artifactId);
    const draftsBefore = await readRepairDrafts(project.chapterIds[0]);
    await clickArtifactControl(candidate.artifactId, 'workbench-artifact-confirm-review');
    await waitForTestId('chapter-review-lock');
    const authorizationId = await reviewAuthorizationFromRoute();
    const readGrant = () =>
      bridgeCall<{
        authorizationId: string;
        artifactId: string;
        novelId: string;
        chapterId: string;
        status: string;
      }>('get_review_authorization', { authorizationId });
    expect(await readGrant()).toMatchObject({
      artifactId: candidate.artifactId,
      novelId: project.novelId,
      chapterId: project.chapterIds[0],
      status: 'issued',
    });

    await openRepairWorkbench(project.novelId);
    await selectTask(conversationId);
    await findTestIdByAttribute('workbench-artifact-card', 'data-review-status', 'issued');
    await clickArtifactControl(candidate.artifactId, 'workbench-artifact-continue-review');
    await waitForTestId('chapter-review-lock');
    expect(await reviewAuthorizationFromRoute()).toBe(authorizationId);
    expect(await (await waitForTestId('chapter-editor')).getValue()).toBe(content.rawContent);
    expect(await readRepairDrafts(project.chapterIds[0])).toEqual(draftsBefore);

    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    const before = await bridgeCall<{ processId: number }>('get_e2e_agent_closed_loop_state');
    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    const after = await bridgeCall<{ processId: number }>('get_e2e_agent_closed_loop_state');
    expect(after.processId).toBeGreaterThan(0);
    expect(after.processId).not.toBe(before.processId);
    await openRepairWorkbench(project.novelId);
    await selectTask(conversationId);
    const restored = await readRepairBundle(conversationId);
    expect(restored.artifacts).toHaveLength(initial.artifacts.length);
    expect(restored.runs).toEqual(initial.runs);
    expect(
      restored.authorizations.filter((grant) => grant.artifactId === candidate.artifactId),
    ).toHaveLength(1);
    await expectCandidateCausality(restored);
    await clickArtifactControl(candidate.artifactId, 'workbench-artifact-continue-review');
    await waitForTestId('chapter-review-lock');
    expect(await reviewAuthorizationFromRoute()).toBe(authorizationId);
    expect(await (await waitForTestId('chapter-editor')).getValue()).toBe(content.rawContent);
    expect((await readGrant()).status).toBe('issued');
    expect(await readRepairDrafts(project.chapterIds[0])).toEqual(draftsBefore);
  });

  it('edits structured rules through preview-bound author decisions, expires old review grants, and separately approves exceptions', async function () {
    this.timeout(240_000);
    const project = await prepareRepairProject('规则结构、失效与有限例外');
    const conversationId = await createRepairTask(project);
    const bundle = await waitForRepairArtifacts(conversationId);
    const candidate = bundle.artifacts.find((card) => card.artifactType === 'chapter_text')!;
    const originalCandidate = await readRepairArtifact(candidate.artifactId);
    const draftsBefore = await readRepairDrafts(project.chapterIds[0]);
    const otherDraftsBefore = await readRepairDrafts(project.chapterIds[1]);
    await clickArtifactControl(candidate.artifactId, 'workbench-artifact-confirm-review');
    await waitForTestId('chapter-review-lock');
    const authorizationId = await reviewAuthorizationFromRoute();
    const readGrant = () =>
      bridgeCall<{ status: string }>('get_review_authorization', { authorizationId });
    expect((await readGrant()).status).toBe('issued');
    const baseline = await readRepairRule(project.novelId, project.ruleSystemId);

    const editorId = await openRepairRuleEditor(project);
    const statement = repairFixture.rules + ' 港务局负责执行通航规范，但人物可以违令并承担后果。';
    await fillTestId('setting-content', statement);
    await (await waitForTestId('world-rule-kind')).selectByAttribute('value', 'social_norm');
    await (await waitForTestId('world-rule-strength')).selectByAttribute('value', 'hard');
    await fillTestId('world-rule-scope', '雾港渡口的普通渡船');
    await fillTestId('world-rule-conditions', '闸门关闭且潮位尚未进入通航区间');
    await clickTestId('world-rule-timing-toggle');
    await fillTestId('world-rule-effective-from', '故事第一年秋季，非章节编号');
    await fillTestId('world-rule-reveal-at', '第二章向读者揭示');
    await fillTestId('world-rule-cost', '补偿设施损坏并接受港务调查');
    await clickTestId('world-rule-knowledge-toggle');
    await fillTestId('world-rule-knowledge-known-by', '许舟');
    await clickTestId('setting-close');
    await waitForTestIdMissing(editorId);
    await openRepairRuleEditor(project);
    expect(await (await waitForTestId('setting-content')).getValue()).toBe(statement);
    expect(await readRepairRule(project.novelId, project.ruleSystemId)).toEqual(baseline);
    expect((await readGrant()).status).toBe('issued');

    await clickTestId('setting-impact-preview');
    await waitForTestId('setting-impact-result');
    expect(await (await waitForTestId('setting-save')).isEnabled()).toBe(false);
    await clickTestId('setting-author-confirm');
    const finalStatement = statement + ' 救援船需要单独审批，不从传闻推导自动豁免。';
    await fillTestId('setting-content', finalStatement);
    await waitForTestIdMissing('setting-impact-result');
    expect(await (await waitForTestId('setting-save')).isEnabled()).toBe(false);
    expect(await readRepairRule(project.novelId, project.ruleSystemId)).toEqual(baseline);
    await previewAndSaveRepairRule(editorId);
    const updated = await readRepairRule(project.novelId, project.ruleSystemId);
    const document = JSON.parse(updated.structuredJson!) as WorldRuleDocument;
    expect(updated.content).toBe(finalStatement);
    expect(updated.forbiddenRules).toBe(baseline.forbiddenRules);
    expect(updated.updatedAt).not.toBe(baseline.updatedAt);
    expect(document).toMatchObject({
      contract: 'world_rules_v1',
      schemaVersion: 1,
      authority: 'confirmed',
      kind: 'social_norm',
      strength: 'hard',
      statement: finalStatement,
      scope: { summary: '雾港渡口的普通渡船' },
      chronology: { effectiveFrom: '故事第一年秋季，非章节编号', revealAt: '第二章向读者揭示' },
      epistemic: { status: 'uncertain', knownBy: ['许舟'] },
      boundaries: { cost: '补偿设施损坏并接受港务调查' },
    });
    await browser.waitUntil(async () => (await readGrant()).status === 'expired', {
      timeout: 30_000,
      timeoutMsg: 'Confirmed rule change did not expire the old review grant',
    });
    expect(await readRepairDrafts(project.chapterIds[0])).toEqual(draftsBefore);
    expect(await readRepairDrafts(project.chapterIds[1])).toEqual(otherDraftsBefore);
    const preserved = await readRepairArtifact(candidate.artifactId);
    expect(preserved.rawContent).toBe(originalCandidate.rawContent);
    expect(preserved.artifact.contentHash).toBe(originalCandidate.artifact.contentHash);
    await openRepairWorkbench(project.novelId);
    await selectTask(conversationId);
    const oldCard = await findTestIdByAttribute(
      'workbench-artifact-card',
      'data-artifact-id',
      candidate.artifactId,
    );
    await browser.waitUntil(
      async () => (await oldCard.getAttribute('data-review-status')) === 'expired',
    );
    expect(
      await (
        await artifactControl(candidate.artifactId, 'workbench-artifact-continue-review')
      ).isEnabled(),
    ).toBe(false);

    await openRepairRuleEditor(project);
    await clickTestId('world-rule-exceptions-toggle');
    await clickTestId('world-rule-exception-add');
    const exception = {
      condition: '仅救援当日、经港务人员见证且备妥补偿资源',
      effect: '允许一艘救援船缓速通过备用航道',
      reason: '救援紧迫且已在前文说明备用航道及损耗',
    };
    await fillTestId('world-rule-exception-condition', exception.condition);
    await fillTestId('world-rule-exception-effect', exception.effect);
    await fillTestId('world-rule-exception-reason', exception.reason);
    await (
      await waitForTestId('setting-change-intent')
    ).selectByAttribute('value', 'approve_exception');
    await clickTestId('setting-impact-preview');
    const message = await waitForTestId('setting-editor-message');
    expect(await message.getText()).toContain('理由');
    await waitForTestIdMissing('setting-impact-result');
    expect(await (await waitForTestId('setting-save')).isEnabled()).toBe(false);
    expect(await readRepairRule(project.novelId, project.ruleSystemId)).toEqual(updated);
    await fillTestId(
      'setting-change-notes',
      '作者批准有限救援例外，保留损耗与调查，不扩展到其他船只。',
    );
    await previewAndSaveRepairRule(editorId);
    const approved = await readRepairRule(project.novelId, project.ruleSystemId);
    const approvedDocument = JSON.parse(approved.structuredJson!) as WorldRuleDocument;
    expect(approvedDocument.exceptions).toEqual([{ ...exception, approval: 'author_approved' }]);
    expect(approvedDocument.identity.id).toBe(document.identity.id);
    expect(approvedDocument.identity.revision).toBeGreaterThan(document.identity.revision);
    expect(approvedDocument.epistemic).toEqual(document.epistemic);
    expect(approvedDocument.boundaries).toEqual(document.boundaries);

    await openRepairRuleEditor(project);
    await clickTestId('setting-active');
    await (
      await waitForTestId('setting-change-intent')
    ).selectByAttribute('value', 'confirm_change');
    await previewAndSaveRepairRule(editorId);
    const inactive = await readRepairRule(project.novelId, project.ruleSystemId);
    expect(inactive.isActive).toBe(false);
    expect(inactive.content).toBe(approved.content);
    expect(JSON.parse(inactive.structuredJson!).exceptions).toEqual(approvedDocument.exceptions);
    expect((await readGrant()).status).toBe('expired');
    expect(await readRepairDrafts(project.chapterIds[0])).toEqual(draftsBefore);
    expect(await readRepairDrafts(project.chapterIds[1])).toEqual(otherDraftsBefore);
  });
});
