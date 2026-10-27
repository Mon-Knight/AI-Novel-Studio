import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryIsStable, type WorkbenchGeometry } from './interaction-world-rules-fixture';

function geometry(animationTargets: string[] = []): WorkbenchGeometry {
  const rect = { top: 0, left: 0, right: 1280, bottom: 820, width: 1280, height: 820 };
  return {
    innerWidth: 1280,
    innerHeight: 820,
    pageRect: rect,
    headerRect: rect,
    panelRect: rect,
    mainRect: rect,
    treeRect: rect,
    panelPosition: 'fixed',
    panelView: 'rules',
    panelIntent: 'transient',
    panelHidden: false,
    panelTemporarilyHidden: false,
    panelInsetTop: '40px',
    treeDisplay: 'block',
    sidebarState: 'expanded',
    focusMode: 'false',
    documentScrollWidth: 1280,
    animationTargets,
  };
}

test('identical rectangles are not settled while the side panel entry animation runs', () => {
  assert.equal(
    geometryIsStable(geometry(['workbench-side-panel']), geometry(['workbench-side-panel'])),
    false,
  );
});

test('both geometry samples must be free of layout animations', () => {
  assert.equal(geometryIsStable(geometry(['workbench-side-panel']), geometry()), false);
  assert.equal(geometryIsStable(geometry(), geometry(['workbench-side-panel'])), false);
  assert.equal(geometryIsStable(geometry(), geometry()), true);
});

test('running non-layout animations do not prevent settled geometry', () => {
  assert.equal(
    geometryIsStable(geometry(['loading-spinner']), geometry(['loading-spinner'])),
    true,
  );
});

test('rectangle movement still prevents stability after animations finish', () => {
  const moved = geometry();
  moved.panelRect = { ...moved.panelRect!, left: 20 };
  assert.equal(geometryIsStable(geometry(), moved), false);
});
