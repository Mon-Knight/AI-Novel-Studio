import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopViewportAvailable,
  ensureIsolatedDesktopViewport,
  type DesktopViewport,
} from './production-carrier-viewport';

function viewportFixture(measurements: DesktopViewport[], neverAvailable = false) {
  const actions: Array<string | DesktopViewport> = [];
  let measurementIndex = 0;
  const driver = {
    async execute() {
      const viewport = measurements[Math.min(measurementIndex, measurements.length - 1)];
      measurementIndex += 1;
      return viewport;
    },
    async maximizeWindow() {
      actions.push('maximize');
    },
    async setWindowSize(width: number, height: number) {
      actions.push({ width, height });
    },
    async getWindowSize() {
      return { width: 1280, height: 820 };
    },
    async waitUntil(predicate: () => Promise<boolean>) {
      if (neverAvailable || !(await predicate())) throw new Error('fixture viewport is clamped');
    },
  };
  return { driver, actions };
}

test('usable desktop geometry is not changed between isolated scenarios', async () => {
  const fixture = viewportFixture([{ width: 1280, height: 820 }]);
  assert.deepEqual(await ensureIsolatedDesktopViewport(fixture.driver), {
    width: 1280,
    height: 820,
  });
  assert.deepEqual(fixture.actions, []);
});

test('a minimized native client area is restored before any UI click', async () => {
  const fixture = viewportFixture([
    { width: 132, height: 23 },
    { width: 1536, height: 864 },
  ]);
  assert.deepEqual(await ensureIsolatedDesktopViewport(fixture.driver), {
    width: 1536,
    height: 864,
  });
  assert.deepEqual(fixture.actions, ['maximize']);
});

test('native/client DPI differences use measured size compensation', async () => {
  const fixture = viewportFixture([
    { width: 132, height: 23 },
    { width: 900, height: 650 },
    { width: 1060, height: 678 },
    { width: 1242, height: 796 },
  ]);
  assert.deepEqual(await ensureIsolatedDesktopViewport(fixture.driver), {
    width: 1242,
    height: 796,
  });
  assert.deepEqual(fixture.actions, [
    'maximize',
    { width: 1280, height: 820 },
    { width: 1500, height: 962 },
  ]);
});

test('an unavailable viewport fails explicitly instead of bypassing real interaction', async () => {
  const fixture = viewportFixture([{ width: 132, height: 23 }], true);
  await assert.rejects(
    ensureIsolatedDesktopViewport(fixture.driver),
    /isolated desktop viewport unavailable: measured 132x23, required at least 1024x700/u,
  );
});

test('the minimum uses both measured dimensions and rejects nonfinite geometry', () => {
  assert.equal(desktopViewportAvailable({ width: 1024, height: 700 }), true);
  assert.equal(desktopViewportAvailable({ width: 1023, height: 700 }), false);
  assert.equal(desktopViewportAvailable({ width: 1024, height: 699 }), false);
  assert.equal(desktopViewportAvailable({ width: Infinity, height: 820 }), false);
  assert.equal(desktopViewportAvailable({ width: 1280, height: NaN }), false);
});
