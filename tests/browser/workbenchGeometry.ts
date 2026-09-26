import fs from 'node:fs';
import path from 'node:path';
import { browser } from '@wdio/globals';

/**
 * Round-two measurement helper for the workbench browser acceptance specs.
 *
 * The first round accepted the panel's 220ms enter animation (a 10px translateX) as layout
 * noise and widened the tolerances to 8px/17px. This helper instead waits for the real final
 * state: the measured nodes must report an identity computed transform, no running animation on
 * themselves, and two consecutive identical getBoundingClientRect reads. Only then do the specs
 * assert the final geometry with a 1-2px tolerance.
 */

/** Round-two evidence is written next to the round-one artifacts instead of overwriting them. */
export const ROUND2_VISUAL_DIRECTORY = path.resolve(
  import.meta.dirname,
  '../../reports/ux-round2-validation/visual',
);

/** Only separates "still animating" from "settled"; final assertions stay at 1-2px. */
const STABILITY_EPSILON_PX = 0.05;
const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;
const SETTLE_POLL_INTERVAL_MS = 50;

/** Shared workbench boxes. A selector that is legitimately absent is reported as found: false. */
export const WORKBENCH_SELECTORS = {
  page: '.workbench-page',
  tree: '.workbench-tree',
  main: '.workbench-main',
  header: '.workbench-task-header',
  headerInner: '.workbench-task-header-inner',
  headerActions: '.workbench-task-header-actions',
  messages: '.workbench-message-region',
  messageList: '[data-testid="workbench-message-list"]',
  composer: '.workbench-composer',
  composerSurface: '.workbench-composer-surface',
  panel: '.workbench-side-panel',
} as const;

export interface BoxMeasurement {
  name: string;
  selector: string;
  found: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  scrollWidth: number;
  clientWidth: number;
  position: string;
  display: string;
  transform: string;
  hidden: boolean;
  inert: boolean;
  runningAnimations: number;
  runningDescendantAnimations: number;
}

export type BoxSet = Record<string, BoxMeasurement>;

export interface StableBoxOptions {
  selectors: Record<string, string>;
  label: string;
  timeoutMs?: number;
  /** Require identity transforms on measured nodes; the panel enter animation must have ended. */
  requireIdentityTransform?: boolean;
  /** Set false when a missing node is part of the asserted state (for example a closed panel). */
  requireFound?: boolean;
}

export interface CenterHit {
  selector: string;
  found: boolean;
  centerX: number;
  centerY: number;
  hitTag: string;
  hitTestId: string | null;
  hitInsideTarget: boolean;
}

const IDENTITY_2D = /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*0,\s*0\s*\)$/u;
const IDENTITY_3D =
  /^matrix3d\(\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1\s*\)$/u;

export function isIdentityTransform(value: string): boolean {
  return value === '' || value === 'none' || IDENTITY_2D.test(value) || IDENTITY_3D.test(value);
}

export function boxesOverlap(first: BoxMeasurement, second: BoxMeasurement): boolean {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

export function round2VisualPath(name: string): string {
  return path.join(ROUND2_VISUAL_DIRECTORY, `${name}.png`);
}

/**
 * Makes innerWidth/innerHeight exactly match the requested viewport. The 1180px pinned/overlay
 * boundary is a media query, so an inexact outer window size would make the state ambiguous.
 */
export async function setExactViewport(width: number, height: number): Promise<void> {
  await browser.setWindowSize(width, height);
  const outer = await browser.getWindowSize();
  const inner = await browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  if (inner.width !== width || inner.height !== height) {
    await browser.setWindowSize(
      outer.width + width - inner.width,
      outer.height + height - inner.height,
    );
  }
  await browser.waitUntil(
    async () =>
      browser.execute((w, h) => window.innerWidth === w && window.innerHeight === h, width, height),
    { timeoutMsg: `Viewport did not reach ${width}x${height}; geometry would be ambiguous.` },
  );
}

/** Reads real getBoundingClientRect/computed-style values plus animation state for each node. */
export async function readBoxSet(selectors: Record<string, string>): Promise<BoxSet> {
  return (await browser.execute((definitions: Array<[string, string]>) => {
    const boxes: Record<string, Record<string, unknown>> = {};
    for (const [name, selector] of definitions) {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) {
        boxes[name] = {
          name,
          selector,
          found: false,
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          scrollWidth: 0,
          clientWidth: 0,
          position: '',
          display: '',
          transform: '',
          hidden: false,
          inert: false,
          runningAnimations: 0,
          runningDescendantAnimations: 0,
        };
        continue;
      }
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const own = typeof node.getAnimations === 'function' ? node.getAnimations() : [];
      const subtree =
        typeof node.getAnimations === 'function' ? node.getAnimations({ subtree: true }) : [];
      boxes[name] = {
        name,
        selector,
        found: true,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        position: style.position,
        display: style.display,
        transform: style.transform,
        hidden: node.hasAttribute('hidden'),
        inert: node.hasAttribute('inert'),
        runningAnimations: own.filter((animation) => animation.playState === 'running').length,
        runningDescendantAnimations: subtree.filter(
          (animation) => animation.playState === 'running',
        ).length,
      };
    }
    return boxes;
  }, Object.entries(selectors))) as BoxSet;
}

export function readWorkbenchBoxes(): Promise<BoxSet> {
  return readBoxSet({ ...WORKBENCH_SELECTORS });
}

/** Waits for identity transforms and no running animation, then two identical real rects. */
export async function waitForStableBoxSet(options: StableBoxOptions): Promise<BoxSet> {
  const {
    selectors,
    label,
    timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
    requireIdentityTransform = true,
    requireFound = false,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let previous: BoxSet | null = null;
  let current = await readBoxSet(selectors);
  for (;;) {
    const moving = Object.values(current).filter(
      (box) =>
        box.found &&
        (box.runningAnimations > 0 ||
          (requireIdentityTransform && !isIdentityTransform(box.transform))),
    );
    const missing = Object.values(current)
      .filter((box) => !box.found)
      .map((box) => box.selector);
    if (
      previous &&
      boxesMatch(previous, current) &&
      moving.length === 0 &&
      (!requireFound || missing.length === 0)
    ) {
      return current;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${label} did not reach its final geometry within ${timeoutMs}ms. ` +
          `Moving: ${moving.map((box) => `${box.name}(transform=${box.transform},animations=${box.runningAnimations})`).join('; ') || 'none'}. ` +
          `Missing: ${missing.join(', ') || 'none'}. Last measurement: ${JSON.stringify(current)}. ` +
          'A still-moving box is an animation or layout defect, never a sub-pixel difference.',
      );
    }
    previous = current;
    await browser.pause(SETTLE_POLL_INTERVAL_MS);
    current = await readBoxSet(selectors);
  }
}

function boxesMatch(previous: BoxSet, current: BoxSet): boolean {
  const names = Object.keys(current);
  if (names.length !== Object.keys(previous).length) return false;
  return names.every((name) => {
    const before = previous[name];
    const after = current[name];
    if (!before || !after || before.found !== after.found) return false;
    if (!after.found) return true;
    return (['left', 'top', 'right', 'bottom', 'width', 'height'] as const).every(
      (key) => Math.abs(before[key] - after[key]) <= STABILITY_EPSILON_PX,
    );
  });
}

export function waitForStableWorkbenchBoxes(
  label: string,
  options: { requireFound?: boolean; selectors?: Record<string, string> } = {},
): Promise<BoxSet> {
  return waitForStableBoxSet({
    selectors: { ...WORKBENCH_SELECTORS, ...(options.selectors ?? {}) },
    label,
    requireFound: options.requireFound ?? false,
  });
}

/** Real hit test at each node's centre; an overlay above a control fails here. */
export async function readCenterHits(selectors: string[]): Promise<CenterHit[]> {
  return (await browser.execute(
    (list: string[]) =>
      list.map((selector) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) {
          return {
            selector,
            found: false,
            centerX: 0,
            centerY: 0,
            hitTag: '',
            hitTestId: null,
            hitInsideTarget: false,
          };
        }
        const rect = node.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        const hitElement = hit instanceof Element ? hit : null;
        const testIdHost = hitElement?.closest<HTMLElement>('[data-testid]') ?? null;
        return {
          selector,
          found: true,
          centerX,
          centerY,
          hitTag: hitElement?.tagName.toLowerCase() ?? '',
          hitTestId: testIdHost?.dataset.testid ?? null,
          hitInsideTarget: Boolean(
            hitElement && (hitElement === node || node.contains(hitElement)),
          ),
        };
      }),
    selectors,
  )) as CenterHit[];
}

export async function takeRound2Screenshot(name: string): Promise<string> {
  fs.mkdirSync(ROUND2_VISUAL_DIRECTORY, { recursive: true });
  const target = round2VisualPath(name);
  await browser.saveScreenshot(target);
  return target;
}

/** One metrics file per spec: running the whole browser suite must not erase another spec's run. */
function metricsFileFor(specId: string): string {
  return path.join(ROUND2_VISUAL_DIRECTORY, `geometry-metrics-${specId}.json`);
}

export function resetRound2Metrics(specId: string): void {
  fs.mkdirSync(ROUND2_VISUAL_DIRECTORY, { recursive: true });
  fs.writeFileSync(
    metricsFileFor(specId),
    JSON.stringify({ specId, generatedAt: new Date().toISOString(), entries: [] }, null, 2),
  );
}

/** Appends real measurements next to the round-two screenshots so evidence stays inspectable. */
export function recordRound2Metrics(
  specId: string,
  scenario: string,
  payload: Record<string, unknown>,
): void {
  fs.mkdirSync(ROUND2_VISUAL_DIRECTORY, { recursive: true });
  const file = metricsFileFor(specId);
  let parsed: { entries?: unknown[] } = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown[] };
  } catch {
    parsed = {};
  }
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  entries.push({ scenario, recordedAt: new Date().toISOString(), ...payload });
  fs.writeFileSync(
    file,
    JSON.stringify({ specId, generatedAt: new Date().toISOString(), entries }, null, 2),
  );
}
