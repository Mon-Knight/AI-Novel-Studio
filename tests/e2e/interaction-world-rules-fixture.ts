/* eslint-disable no-console -- the round-2 desktop fixture must keep resize-notice attribution visible in the runner log. */
import fs from 'node:fs';
import path from 'node:path';
import { browser, expect } from '@wdio/globals';
import type { RuleSystem } from '../../src/types/setting';
import {
  assertCleanDiagnostics,
  bridgeCall,
  bridgeClearDiagnostics,
  bridgeDiagnostics,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  seedChapterCoreAssetsForE2e,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

export interface RepairArtifactCard {
  cardId: string;
  artifactId: string;
  artifactType: string;
  /** The desktop persists a NULL card turn (the owning run carries the turn), so the causal
   * link is asserted through runId -> run.turnId instead of the card's own column. */
  turnId: string | null;
  runId: string;
  status: string;
}

export interface RepairConversationBundle {
  conversation: { conversationId: string; novelId: string; status: string };
  turns: Array<{ turnId: string; role: string; content: string; sequence: number }>;
  runs: Array<{ runId: string; turnId: string; status: string }>;
  toolEvents: Array<{
    eventId: string;
    runId: string;
    toolName: string;
    status: string;
    error?: string;
    result?: unknown;
  }>;
  artifacts: RepairArtifactCard[];
  decisions: Array<{ artifactId: string; decision: string; artifactHash: string }>;
  authorizations: Array<{ authorizationId: string; artifactId: string; status: string }>;
}

export interface RepairArtifact {
  rawContent: string;
  artifact: {
    contentHash: string;
    sourceNovelId: string;
    sourceChapterId?: string;
    parentArtifactId?: string;
    derivationType?: string;
  };
}

export interface RepairDraft {
  id: string;
  content: string;
  chapterId: string;
  novelId: string;
  isAdopted: boolean;
}

export interface RepairProject {
  novelId: string;
  chapterIds: [string, string];
  ruleSystemId: string;
}

export const repairFixture = {
  title: '交互与世界规则桌面回归',
  world: '雾港依靠人工维护的潮汐闸门调节航道，渡船是两岸之间的常用交通工具。',
  rules: '普通渡船必须等待可通航的潮位。抢渡需要有可解释的路径与代价。',
  forbidden: '不得在没有铺垫的情况下让角色瞬间抵达对岸。',
  chapterGoal: '生成第一章正文，2000字，描写雾港渡口的争执与人物抉择。',
  unsentDraft: '保留这段尚未发送的草稿：先核对渡口规则，不自动采用任何正文。',
} as const;

/** Only preconditions use the existing, marker-guarded E2E bootstrap.
 * Every interaction, decision, rule edit and review under test uses production DOM.
 */
export async function prepareRepairProject(label: string): Promise<RepairProject> {
  await waitForTestId('app-shell');
  const diagnostics = await bridgeDiagnostics();
  expect(diagnostics.enabled).toBe(true);
  expect(diagnostics.networkBlocked).toBe(true);
  expect(diagnostics.webviewNetwork?.installed).toBe(true);
  await browser.execute(() => {
    localStorage.setItem('ai_novel_studio_e2e_workbench_model', 'enabled');
  });
  const novelId = await createProjectThroughUi(repairFixture.title + ' / ' + label);
  await openWorkspace(novelId);
  const volumeId = await createVolumeThroughUi('第一卷 潮汐之约');
  const first = await createChapterThroughUi('第一章 渡口', volumeId);
  const second = await createChapterThroughUi('第二章 对岸', volumeId);
  const seed = await seedChapterCoreAssetsForE2e({
    novelId,
    worldSetting: { title: '雾港背景', content: repairFixture.world },
    ruleSystem: {
      title: '渡航规则',
      content: repairFixture.rules,
      forbiddenRules: repairFixture.forbidden,
    },
    protagonist: {
      name: '许舟',
      identity: '渡船记录员',
      personality: '谨慎但不回避责任',
      goal: '查明航道关闭的原因并保护同行者',
    },
    chapters: [
      {
        chapterId: first,
        title: '第一章 渡口',
        outline: '渡口争执与规则核对。',
        targetWordCount: 600,
      },
      {
        chapterId: second,
        title: '第二章 对岸',
        outline: '抵岸后核对上一章留下的承诺。',
        targetWordCount: 600,
      },
    ],
  });
  expect(seed.storageMode).toBe('sqlite');
  expect(seed.novelId).toBe(novelId);
  expect(seed.readiness).toHaveLength(2);
  expect(
    seed.readiness.every((chapter) => chapter.ready && chapter.missingAssets.length === 0),
  ).toBe(true);
  return { novelId, chapterIds: [first, second], ruleSystemId: seed.ruleSystemId };
}

export async function openRepairWorkbench(novelId: string): Promise<void> {
  await navigateHash('#/');
  await waitForTestId('creative-workbench');
  const treeToggle = await waitForTestId('shell-toggle-sidebar');
  if ((await treeToggle.getAttribute('aria-expanded')) !== 'true') await treeToggle.click();
  const project = await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId);
  if ((await project.getAttribute('data-selected')) !== 'true') await project.click();
  await browser.waitUntil(
    async () => {
      const selected = await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId);
      return (await selected.getAttribute('data-selected')) === 'true';
    },
    { timeout: 30_000, timeoutMsg: 'Project scope did not become active' },
  );
}

export async function createRepairTask(
  project: RepairProject,
  goal: string = repairFixture.chapterGoal,
  chapterId = project.chapterIds[0],
): Promise<string> {
  await openRepairWorkbench(project.novelId);
  await clickTestId('workbench-create-task');
  await fillTestId('workbench-new-task-goal', goal);
  await (await waitForTestId('workbench-new-task-chapter')).selectByAttribute('value', chapterId);
  const create = await waitForTestId('workbench-create-and-start');
  await create.waitForEnabled({ timeout: 30_000 });
  await create.click();
  await waitForTestIdMissing('workbench-task-creator');
  const header = await waitForTestId('workbench-task-header');
  const conversationId = await header.getAttribute('data-conversation-id');
  if (!conversationId) throw new Error('Created task did not expose its conversation identity');
  return conversationId;
}

export const readRepairBundle = (conversationId: string) =>
  bridgeCall<RepairConversationBundle>('get_task_conversation', { conversationId });

export const readRepairArtifact = (artifactId: string) =>
  bridgeCall<RepairArtifact>('get_result_artifact', { input: { artifactId } });

export const readRepairDrafts = (chapterId: string) =>
  bridgeCall<RepairDraft[]>('get_drafts_by_chapter_id', { chapterId });

export async function openRepairRuleEditor(project: RepairProject): Promise<string> {
  await navigateHash('#/novels/' + project.novelId);
  await waitForTestId('novel-detail-rule-system');
  const edit = await findTestIdByAttribute(
    'rule-system-edit',
    'data-rule-id',
    project.ruleSystemId,
  );
  await edit.waitForClickable({ timeout: 30_000 });
  await edit.click();
  const editorId = 'setting-editor-rule-' + project.ruleSystemId;
  await waitForTestId(editorId);
  return editorId;
}

export async function previewAndSaveRepairRule(editorId: string): Promise<void> {
  await clickTestId('setting-impact-preview');
  await waitForTestId('setting-impact-result');
  const confirm = await waitForTestId('setting-author-confirm');
  expect(await confirm.isSelected()).toBe(false);
  const save = await waitForTestId('setting-save');
  expect(await save.isEnabled()).toBe(false);
  await confirm.click();
  await save.waitForClickable({ timeout: 30_000 });
  await save.click();
  await waitForTestIdMissing(editorId);
}

export async function readRepairRule(novelId: string, ruleId: string): Promise<RuleSystem> {
  const rules = await bridgeCall<RuleSystem[]>('get_rule_systems', { novelId });
  const rule = rules.find((item) => item.id === ruleId && item.novelId === novelId);
  if (!rule) throw new Error('Expected rule was not found in its isolated novel');
  return rule;
}

export async function waitForRepairArtifacts(
  conversationId: string,
  artifactType = 'chapter_text',
  count = 1,
): Promise<RepairConversationBundle> {
  await browser.waitUntil(
    async () => {
      const bundle = await readRepairBundle(conversationId);
      return (
        bundle.conversation.status === 'waiting_user' &&
        bundle.artifacts.filter((card) => card.artifactType === artifactType).length === count
      );
    },
    {
      timeout: 60_000,
      timeoutMsg: 'Expected persisted, waiting-user candidates for ' + conversationId,
    },
  );
  return readRepairBundle(conversationId);
}

export async function artifactControl(artifactId: string, testId: string) {
  const card = await findTestIdByAttribute(
    'workbench-artifact-card',
    'data-artifact-id',
    artifactId,
  );
  const control = await card.$('[data-testid="' + testId + '"]');
  await control.waitForDisplayed({ timeout: 30_000 });
  return control;
}

export async function clickArtifactControl(artifactId: string, testId: string): Promise<void> {
  const control = await artifactControl(artifactId, testId);
  await control.waitForClickable({ timeout: 30_000 });
  await control.click();
}

/* -------------------------------------------------------------------------- */
/* Round-2 desktop UX contract helpers                                        */
/*                                                                            */
/* Everything below drives real production DOM. The E2E bridge is only used   */
/* to read facts and to verify pre-conditions that were already isolated.      */
/* -------------------------------------------------------------------------- */

export const RESIZE_OBSERVER_NOTICE =
  'ResizeObserver loop completed with undelivered notifications.';

export interface FrontEndNotices {
  unhandled: string[];
  consoleErrors: string[];
}

export async function readFrontEndNotices(): Promise<FrontEndNotices> {
  return browser.execute(() => {
    const bridge = (
      window as unknown as {
        __AI_NOVEL_STUDIO_E2E__?: {
          getUnhandledErrors?: () => unknown[];
          getConsoleLogs?: () => Array<{ level?: string; message?: string }>;
        };
      }
    ).__AI_NOVEL_STUDIO_E2E__;
    const unhandled = (bridge?.getUnhandledErrors?.() ?? []).filter(
      (message): message is string => typeof message === 'string',
    );
    const consoleErrors = (bridge?.getConsoleLogs?.() ?? [])
      .filter((entry) => entry.level === 'error')
      .map((entry) => entry.message ?? '');
    return { unhandled, consoleErrors };
  });
}

export interface NoticeCheckpoint {
  phase: string;
  unhandled: number;
  consoleErrors: number;
  resizeObserverNotices: number;
}

interface DiagnosticsLedger {
  /** True only after this test asked the harness to resize the native window. */
  resized: boolean;
  resizePhases: string[];
  /** Notice count observed once the resize phase had settled; a later notice is never excused. */
  noticesAtResizeSettle: number;
  timeline: NoticeCheckpoint[];
}

const diagnosticsLedger: DiagnosticsLedger = {
  resized: false,
  resizePhases: [],
  noticesAtResizeSettle: 0,
  timeline: [],
};

export function resetDiagnosticsLedger(): void {
  diagnosticsLedger.resized = false;
  diagnosticsLedger.resizePhases = [];
  diagnosticsLedger.noticesAtResizeSettle = 0;
  diagnosticsLedger.timeline = [];
}

export function diagnosticsLedgerSnapshot(): DiagnosticsLedger {
  return { ...diagnosticsLedger, timeline: [...diagnosticsLedger.timeline] };
}

function resizeObserverNoticeCount(notices: FrontEndNotices): number {
  return [...notices.unhandled, ...notices.consoleErrors].filter(
    (message) => message === RESIZE_OBSERVER_NOTICE,
  ).length;
}

export async function recordNoticeCheckpoint(phase: string): Promise<NoticeCheckpoint> {
  const notices = await readFrontEndNotices();
  const checkpoint: NoticeCheckpoint = {
    phase,
    unhandled: notices.unhandled.length,
    consoleErrors: notices.consoleErrors.length,
    resizeObserverNotices: resizeObserverNoticeCount(notices),
  };
  diagnosticsLedger.timeline.push(checkpoint);
  return checkpoint;
}

/** The native window API is a harness action, so it may only start from an error-free app.
 * Every notice it produces is attributed to this exact phase instead of being generalized. */
export async function beginHarnessResize(phase: string): Promise<void> {
  const notices = await readFrontEndNotices();
  const unknownUnhandled = notices.unhandled.filter(
    (message) => message !== RESIZE_OBSERVER_NOTICE,
  );
  const unknownConsole = notices.consoleErrors.filter(
    (message) => message !== RESIZE_OBSERVER_NOTICE,
  );
  expect(unknownUnhandled).toEqual([]);
  expect(unknownConsole).toEqual([]);
  const tolerated = resizeObserverNoticeCount(notices);
  if (tolerated > 0) {
    if (!diagnosticsLedger.resized) {
      throw new Error(
        'A ResizeObserver-loop notice existed before this test asked for any window resize: ' +
          JSON.stringify(diagnosticsLedger.timeline),
      );
    }
    if (tolerated > diagnosticsLedger.noticesAtResizeSettle) {
      throw new Error(
        'A ResizeObserver-loop notice appeared after the previous resize phase had settled; do not excuse it: ' +
          JSON.stringify(diagnosticsLedger.timeline),
      );
    }
  }
  diagnosticsLedger.resized = true;
  diagnosticsLedger.resizePhases.push(phase);
  await recordNoticeCheckpoint(phase + ':begin');
}

/** Gives WebView2 time to deliver a delayed notice, then freezes the resize budget. */
export async function settleHarnessResize(phase: string): Promise<NoticeCheckpoint> {
  await browser.pause(1000);
  const checkpoint = await recordNoticeCheckpoint(phase + ':settled');
  diagnosticsLedger.noticesAtResizeSettle = checkpoint.resizeObserverNotices;
  return checkpoint;
}

/** Unknown errors always fail. Only the exact WebView2 notice may be counted, and only while
 * this test actually resized the window and it appeared within the settled resize phase. */
export async function assertDiagnosticsAttributed(): Promise<{ tolerated: number }> {
  const notices = await readFrontEndNotices();
  const unknownUnhandled = notices.unhandled.filter(
    (message) => message !== RESIZE_OBSERVER_NOTICE,
  );
  const unknownConsole = notices.consoleErrors.filter(
    (message) => message !== RESIZE_OBSERVER_NOTICE,
  );
  expect(unknownUnhandled).toEqual([]);
  expect(unknownConsole).toEqual([]);
  const tolerated = resizeObserverNoticeCount(notices);
  if (tolerated > 0) {
    if (!diagnosticsLedger.resized) {
      throw new Error(
        'A ResizeObserver-loop notice appeared in a test that never resized the harness window: ' +
          JSON.stringify(diagnosticsLedger.timeline),
      );
    }
    if (tolerated > diagnosticsLedger.noticesAtResizeSettle) {
      throw new Error(
        'A ResizeObserver-loop notice appeared after the resize phase had settled; do not excuse it: ' +
          JSON.stringify(diagnosticsLedger.timeline),
      );
    }
    // Read the backend and network facts before clearing, so the clear cannot hide them.
    const backend = await bridgeDiagnostics();
    expect(backend.schemaReady).toBe(true);
    expect(backend.integrityCheck).toBe('ok');
    expect(backend.networkBlocked).toBe(true);
    expect(backend.webviewNetwork?.installed).toBe(true);
    expect(backend.webviewNetwork?.total).toBe(0);
    console.warn(
      '[diagnostics] ' +
        tolerated +
        ' exact WebView2 ResizeObserver-loop notice(s) were emitted by the harness resize phase(s) ' +
        diagnosticsLedger.resizePhases.join(', ') +
        '; every other front-end error stayed empty.',
    );
    await bridgeClearDiagnostics();
  }
  await assertCleanDiagnostics();
  return { tolerated };
}

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface WorkbenchGeometry {
  innerWidth: number;
  innerHeight: number;
  pageRect: Rect | null;
  headerRect: Rect | null;
  panelRect: Rect | null;
  mainRect: Rect | null;
  treeRect: Rect | null;
  panelPosition: string | null;
  panelView: string | null;
  panelIntent: string | null;
  panelHidden: boolean;
  panelTemporarilyHidden: boolean;
  panelInsetTop: string;
  treeDisplay: string | null;
  sidebarState: string | null;
  focusMode: string | null;
  documentScrollWidth: number;
  animationTargets: string[];
}

export async function readWorkbenchGeometry(): Promise<WorkbenchGeometry> {
  return browser.execute(() => {
    const toRect = (node: Element | null): Rect | null => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const shell = document.querySelector<HTMLElement>('[data-testid="app-shell"]');
    const page = document.querySelector<HTMLElement>('[data-testid="creative-workbench"]');
    const panel = document.querySelector<HTMLElement>('[data-testid="workbench-side-panel"]');
    const tree = document.querySelector<HTMLElement>('.workbench-tree');
    const animations =
      typeof document.getAnimations === 'function'
        ? document.getAnimations().filter((animation) => animation.playState === 'running')
        : [];
    const animationTargets = animations.map((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (!(target instanceof Element)) return 'non-element';
      const testId = target.getAttribute('data-testid');
      if (testId) return testId;
      if (typeof target.className === 'string' && target.className) return target.className;
      return target.tagName;
    });
    return {
      innerWidth,
      innerHeight,
      pageRect: toRect(page),
      headerRect: toRect(document.querySelector('[data-testid="workbench-task-header"]')),
      panelRect: toRect(panel),
      mainRect: toRect(document.querySelector('.workbench-main')),
      treeRect: toRect(document.querySelector('.workbench-tree')),
      panelPosition: panel ? getComputedStyle(panel).position : null,
      panelView: page?.getAttribute('data-side-panel') ?? null,
      panelIntent: page?.getAttribute('data-panel-intent') ?? null,
      panelHidden: panel ? panel.hidden : false,
      panelTemporarilyHidden: panel?.getAttribute('data-temporarily-hidden') === 'true',
      panelInsetTop: page
        ? getComputedStyle(page).getPropertyValue('--workbench-panel-top').trim()
        : '',
      treeDisplay: tree ? getComputedStyle(tree).display : null,
      sidebarState: shell?.getAttribute('data-sidebar') ?? null,
      focusMode: shell?.getAttribute('data-focus-mode') ?? null,
      documentScrollWidth: document.documentElement.scrollWidth,
      animationTargets,
    };
  });
}

const LAYOUT_ANIMATION_TARGET =
  /workbench-page|workbench-side-panel|workbench-main|workbench-tree|workbench-task-header|app-shell/;

/** A running animation on a layout container means the measured box is not a final state yet. */
export function layoutAnimationTargets(geometry: WorkbenchGeometry): string[] {
  return geometry.animationTargets.filter((target) => LAYOUT_ANIMATION_TARGET.test(target));
}

function rectsClose(left: Rect | null, right: Rect | null, tolerance = 1): boolean {
  if (!left || !right) return left === right;
  return (
    Math.abs(left.top - right.top) <= tolerance &&
    Math.abs(left.left - right.left) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

export function geometryIsStable(left: WorkbenchGeometry, right: WorkbenchGeometry): boolean {
  return (
    left.innerWidth === right.innerWidth &&
    left.panelIntent === right.panelIntent &&
    left.panelView === right.panelView &&
    left.panelHidden === right.panelHidden &&
    left.panelTemporarilyHidden === right.panelTemporarilyHidden &&
    left.panelPosition === right.panelPosition &&
    left.sidebarState === right.sidebarState &&
    left.treeDisplay === right.treeDisplay &&
    left.focusMode === right.focusMode &&
    rectsClose(left.pageRect, right.pageRect) &&
    rectsClose(left.headerRect, right.headerRect) &&
    rectsClose(left.panelRect, right.panelRect) &&
    rectsClose(left.mainRect, right.mainRect) &&
    rectsClose(left.treeRect, right.treeRect)
  );
}

/** Waits for the measured layout to stop moving so assertions never land mid-settle. */
export async function waitForStableWorkbenchGeometry(
  timeoutMs = 8000,
): Promise<{ geometry: WorkbenchGeometry; samples: number }> {
  const deadline = Date.now() + timeoutMs;
  let previous = await readWorkbenchGeometry();
  let samples = 1;
  while (Date.now() < deadline) {
    await browser.pause(120);
    const next = await readWorkbenchGeometry();
    samples += 1;
    if (geometryIsStable(previous, next)) return { geometry: next, samples };
    previous = next;
  }
  throw new Error('Workbench geometry did not settle: ' + JSON.stringify(previous));
}

export interface ViewportMeasurement {
  requestedWidth: number;
  requestedHeight: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  /** True when the display refused the requested inner width (virtual screens clamp windows). */
  clamped: boolean;
  compensated: boolean;
}

/** Requests a real inner width through the window API, compensating for native chrome and then
 * reporting the measured innerWidth instead of assuming the request was honoured. */
export async function requestViewportWidth(
  requestedWidth: number,
  requestedHeight = 900,
): Promise<ViewportMeasurement> {
  let inner = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
  let compensated = false;
  if (inner.width !== requestedWidth || inner.height !== requestedHeight) {
    await browser.setWindowSize(requestedWidth, requestedHeight);
    const outer = await browser.getWindowSize();
    inner = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
    const targetWidth = outer.width + (requestedWidth - inner.width);
    const targetHeight = outer.height + (requestedHeight - inner.height);
    if (
      targetWidth > 0 &&
      targetHeight > 0 &&
      (targetWidth !== outer.width || targetHeight !== outer.height)
    ) {
      await browser.setWindowSize(targetWidth, targetHeight);
      compensated = true;
    }
  }
  let stable = 0;
  let previousWidth = -1;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    inner = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
    if (inner.width === previousWidth) stable += 1;
    else stable = 0;
    previousWidth = inner.width;
    if (stable >= 2) break;
    await browser.pause(120);
  }
  const outer = await browser.getWindowSize();
  return {
    requestedWidth,
    requestedHeight,
    innerWidth: inner.width,
    innerHeight: inner.height,
    outerWidth: outer.width,
    outerHeight: outer.height,
    clamped: inner.width !== requestedWidth,
    compensated,
  };
}

export interface SidePanelObservation {
  open: boolean;
  view: string | null;
  intent: string | null;
  pinned: boolean;
  position: string | null;
}

export async function readSidePanel(): Promise<SidePanelObservation> {
  return browser.execute(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="workbench-side-panel"]');
    return {
      open: Boolean(panel && !panel.hidden && panel.getClientRects().length > 0),
      view: panel?.getAttribute('data-view') ?? null,
      intent: panel?.getAttribute('data-panel-intent') ?? null,
      pinned: panel?.getAttribute('data-panel-intent') === 'pinned',
      position: panel ? getComputedStyle(panel).position : null,
    };
  });
}

/** Opens the reference panel through its real header entry when it is closed. */
export async function ensureSidePanelOpen(): Promise<void> {
  if ((await readSidePanel()).open) return;
  await clickTestId('workbench-toggle-side-panel');
  await waitForTestId('workbench-side-panel');
}

/** Focus is a session preference: every test states the intent it needs through the pin control. */
export async function ensureSidePanelIntent(
  intent: 'transient' | 'pinned',
): Promise<SidePanelObservation> {
  await ensureSidePanelOpen();
  if ((await readSidePanel()).intent !== intent) {
    await clickTestId('workbench-side-pin');
    await waitForTestIdAttribute('workbench-side-panel', 'data-panel-intent', intent);
  }
  return readSidePanel();
}

export async function closeSidePanelThroughToggle(): Promise<void> {
  if (!(await readSidePanel()).open) return;
  await clickTestId('workbench-toggle-side-panel');
  await waitForTestIdMissing('workbench-side-panel');
}

export const SIDEBAR_PREFERENCE_KEYS = [
  'ai_novel_studio_sidebar_collapsed',
  'ai_novel_studio_sidebar_collapsed:standard',
  'ai_novel_studio_sidebar_collapsed:writing',
  'ai_novel_studio_sidebar_collapsed:workbench',
  'ai_novel_studio_sidebar_collapsed:hub',
];

/** Session-only focus must never rewrite the persisted sidebar preference. */
export async function readSidebarPreferences(): Promise<Record<string, string | null>> {
  return browser.execute((keys) => {
    const snapshot: Record<string, string | null> = {};
    for (const key of keys) snapshot[key] = localStorage.getItem(key);
    return snapshot;
  }, SIDEBAR_PREFERENCE_KEYS);
}

export async function expectFocusedTestId(testId: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((id) => document.activeElement?.getAttribute('data-testid') === id, testId),
    { timeout: 5000, timeoutMsg: 'Focus was not restored to ' + testId },
  );
}

export async function expectFocusedAriaLabel(label: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (expected) => document.activeElement?.getAttribute('aria-label') === expected,
        label,
      ),
    { timeout: 5000, timeoutMsg: 'Focus did not move to the control labelled ' + label },
  );
}

export const UX_EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'reports',
  'ux-round2-validation',
  'desktop-ux-round2',
);

function ensureEvidenceDirectory(): string {
  fs.mkdirSync(UX_EVIDENCE_DIR, { recursive: true });
  return UX_EVIDENCE_DIR;
}

export function writeUxEvidence(fileName: string, value: unknown): string {
  const target = path.join(ensureEvidenceDirectory(), fileName);
  fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf8');
  return target;
}

export async function captureUxScreenshot(fileName: string): Promise<string> {
  const target = path.join(
    ensureEvidenceDirectory(),
    fileName.endsWith('.png') ? fileName : fileName + '.png',
  );
  await browser.saveScreenshot(target);
  return target;
}

export interface ComposerClickPoint {
  /** Offsets are relative to the composer's centre, which is what the element click API uses. */
  offsetX: number;
  offsetY: number;
  viewportX: number;
  viewportY: number;
  /** True when the chosen point is inside the composer but outside an open overlay panel. */
  outsidePanel: boolean;
  composerRect: Rect | null;
  panelRect: Rect | null;
}

/** Clicks a point that is genuinely inside the composer and not covered by the reference
 * overlay, so an outside-dismiss assertion is a real user click instead of a covered centre. */
export async function clickComposerOutsideSidePanel(): Promise<ComposerClickPoint> {
  const point = await browser.execute(() => {
    const composer = document.querySelector<HTMLElement>(
      '[data-testid="workbench-composer-input"]',
    );
    if (!composer) throw new Error('The composer input is not mounted');
    const panel = document.querySelector<HTMLElement>('[data-testid="workbench-side-panel"]');
    const toRect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const composerRect = toRect(composer);
    const panelRect = panel ? toRect(panel) : null;
    const centerX = composerRect.left + composerRect.width / 2;
    const centerY = composerRect.top + composerRect.height / 2;
    const outside = (x: number, y: number) =>
      !panelRect ||
      x < panelRect.left ||
      x > panelRect.right ||
      y < panelRect.top ||
      y > panelRect.bottom;
    const candidates = [
      { x: composerRect.left + Math.min(12, composerRect.width / 4), y: centerY },
      { x: centerX, y: centerY },
    ];
    const chosen =
      candidates.find((candidate) => outside(candidate.x, candidate.y)) ?? candidates[0];
    return {
      offsetX: Math.round(chosen.x - centerX),
      offsetY: Math.round(chosen.y - centerY),
      viewportX: Math.round(chosen.x),
      viewportY: Math.round(chosen.y),
      outsidePanel: outside(chosen.x, chosen.y),
      composerRect,
      panelRect,
    };
  });
  const composer = await waitForTestId('workbench-composer-input');
  await composer.click({ x: point.offsetX, y: point.offsetY });
  return point;
}

export interface ReadGroupObservation {
  groupCount: number;
  groupReadEventIds: string[][];
  groupDetailsOpen: boolean[];
  groupToolEvents: number[];
  groupToolStatuses: string[][];
  errorsInsideGroups: number;
  externalErrorTexts: string[];
  toolEvents: Array<{
    presentationId: string;
    runId: string;
    toolName: string;
    status: string;
  }>;
  presentationIds: string[];
}

export async function readWorkbenchReadGroups(): Promise<ReadGroupObservation> {
  return browser.execute(() => {
    const groups = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="workbench-completed-read"]'),
    ];
    const presentationOf = (node: Element): HTMLElement | null =>
      node.closest<HTMLElement>('[data-presentation-id]');
    return {
      groupCount: groups.length,
      groupReadEventIds: groups.map((group) =>
        (group.dataset.readEventIds ?? '').split(',').filter(Boolean),
      ),
      groupDetailsOpen: groups.map((group) => group.querySelector('details')?.open ?? false),
      groupToolEvents: groups.map(
        (group) => group.querySelectorAll('[data-testid="workbench-tool-event"]').length,
      ),
      groupToolStatuses: groups.map((group) =>
        [...group.querySelectorAll<HTMLElement>('[data-testid="workbench-tool-event"]')].map(
          (node) => node.dataset.status ?? '',
        ),
      ),
      errorsInsideGroups: groups.reduce(
        (count, group) =>
          count +
          group.querySelectorAll(
            '[data-testid="workbench-tool-public-error"], [data-testid="workbench-run-error"]',
          ).length,
        0,
      ),
      externalErrorTexts: [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="workbench-tool-public-error"], [data-testid="workbench-run-error"]',
        ),
      ].map((node) => node.textContent?.trim() ?? ''),
      toolEvents: [
        ...document.querySelectorAll<HTMLElement>('[data-testid="workbench-tool-event"]'),
      ].map((node) => ({
        presentationId: presentationOf(node)?.dataset.presentationId ?? '',
        runId: presentationOf(node)?.dataset.runId ?? '',
        toolName: node.dataset.toolName ?? '',
        status: node.dataset.status ?? '',
      })),
      presentationIds: [...document.querySelectorAll<HTMLElement>('[data-presentation-id]')].map(
        (node) => node.dataset.presentationId ?? '',
      ),
    };
  });
}

export async function expandFirstReadGroup(): Promise<void> {
  const summary = await browser.$('[data-testid="workbench-completed-read"] details > summary');
  await summary.waitForClickable({ timeout: 15_000 });
  await summary.click();
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const details = document.querySelector('[data-testid="workbench-completed-read"] details');
        return details instanceof HTMLDetailsElement && details.open;
      }),
    { timeout: 5000, timeoutMsg: 'The completed-read disclosure did not expand' },
  );
}

export interface CandidateFirstScreen {
  artifactId: string | null;
  number: string | null;
  target: string | null;
  model: string | null;
  nextStep: string | null;
  revisionSource: string | null;
  status: string | null;
  decision: string | null;
  reviewStatus: string | null;
}

/** Reads the author-facing identity block of a candidate card straight from its own DOM. */
export async function readCandidateFirstScreen(artifactId: string): Promise<CandidateFirstScreen> {
  return browser.execute((id) => {
    const card = document.querySelector<HTMLElement>(
      '[data-testid="workbench-artifact-card"][data-artifact-id="' + id + '"]',
    );
    if (!card) throw new Error('Candidate card is not mounted: ' + id);
    const readText = (selector: string) =>
      card.querySelector<HTMLElement>(selector)?.textContent?.trim() ?? null;
    return {
      artifactId: card.getAttribute('data-artifact-id'),
      number: readText('[data-testid="workbench-artifact-number"]'),
      target: readText('[data-testid="workbench-artifact-target"]'),
      model: readText('[data-testid="workbench-artifact-model"]'),
      nextStep: readText('[data-testid="workbench-artifact-next-step"]'),
      revisionSource: readText('[data-testid="workbench-artifact-revision-source"]'),
      status: card.getAttribute('data-status'),
      decision: card.getAttribute('data-decision'),
      reviewStatus: card.getAttribute('data-review-status'),
    };
  }, artifactId);
}

export interface WorldRuleFormFirstScreen {
  scopeVisible: boolean;
  costVisible: boolean;
  contentVisible: boolean;
  beliefHintVisible: boolean;
  detailsOpen: Record<string, boolean>;
  groupTexts: Record<string, string>;
}

const WORLD_RULE_GROUPS = [
  'world-rule-group-world',
  'world-rule-timing-toggle',
  'world-rule-knowledge-toggle',
  'world-rule-group-source',
  'world-rule-exceptions-toggle',
];

/** What an author can see before expanding anything in the progressive world-rule form. */
export async function readWorldRuleFormFirstScreen(
  editorId: string,
): Promise<WorldRuleFormFirstScreen> {
  return browser.execute(
    (id, groups) => {
      const editor = document.querySelector<HTMLElement>('[data-testid="' + id + '"]');
      if (!editor) throw new Error('The world-rule editor is not mounted: ' + id);
      const visible = (testId: string) => {
        const node = editor.querySelector<HTMLElement>('[data-testid="' + testId + '"]');
        return Boolean(node && node.getClientRects().length > 0);
      };
      const detailsOpen: Record<string, boolean> = {};
      const groupTexts: Record<string, string> = {};
      for (const testId of groups) {
        const summary = editor.querySelector<HTMLElement>('[data-testid="' + testId + '"]');
        const details = summary?.closest('details') ?? null;
        detailsOpen[testId] = details instanceof HTMLDetailsElement ? details.open : false;
        groupTexts[testId] = details?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
      }
      return {
        scopeVisible: visible('world-rule-scope'),
        costVisible: visible('world-rule-cost'),
        contentVisible: visible('setting-content'),
        beliefHintVisible: visible('world-rule-belief-hint'),
        detailsOpen,
        groupTexts,
      };
    },
    editorId,
    WORLD_RULE_GROUPS,
  );
}

export async function expandWorldRuleGroup(editorId: string, testId: string): Promise<void> {
  // Closed editors stay mounted with the same field IDs; never select their hidden summaries.
  const editor = await waitForTestId(editorId);
  const group = await editor.$('[data-testid="' + testId + '"]');
  const summary = (await group.getTagName()) === 'details' ? await group.$('summary') : group;
  await summary.scrollIntoView({ block: 'center', inline: 'nearest' });
  await summary.waitForClickable({ timeout: 15_000 });
  await summary.click();
  await browser.waitUntil(
    async () =>
      browser.execute(
        (editorTestId, groupTestId) => {
          const editor = document.querySelector('[data-testid="' + editorTestId + '"]');
          const group = editor?.querySelector('[data-testid="' + groupTestId + '"]');
          const details = group?.closest('details') ?? null;
          return details instanceof HTMLDetailsElement && details.open;
        },
        editorId,
        testId,
      ),
    { timeout: 5000, timeoutMsg: 'The world-rule group did not expand: ' + testId },
  );
}

export async function readRuleEditorPreview(): Promise<string> {
  const preview = await waitForTestId('setting-change-preview');
  return preview.getText();
}
