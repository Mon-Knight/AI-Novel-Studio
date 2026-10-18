export interface DesktopViewport {
  width: number;
  height: number;
}

interface ViewportDriver {
  execute(script: () => DesktopViewport): Promise<DesktopViewport>;
  maximizeWindow(): Promise<unknown>;
  setWindowSize(width: number, height: number): Promise<unknown>;
  getWindowSize(): Promise<DesktopViewport>;
  waitUntil(
    predicate: () => Promise<boolean>,
    options: { timeout: number; interval: number; timeoutMsg: string },
  ): Promise<unknown>;
}

const MINIMUM_VIEWPORT = { width: 1024, height: 700 };
const REQUESTED_WINDOW = { width: 1280, height: 820 };

export function desktopViewportAvailable(viewport: DesktopViewport): boolean {
  return (
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width >= MINIMUM_VIEWPORT.width &&
    viewport.height >= MINIMUM_VIEWPORT.height
  );
}

/** Restore only an unusable isolated desktop window; all interaction remains WebDriver-driven. */
export async function ensureIsolatedDesktopViewport(
  driver: ViewportDriver,
): Promise<DesktopViewport> {
  const measure = () => driver.execute(() => ({ width: innerWidth, height: innerHeight }));
  let viewport = await measure();
  if (desktopViewportAvailable(viewport)) return viewport;

  try {
    // A minimized native window can still report displayed/enabled DOM nodes to WebDriver.
    await driver.maximizeWindow();
    viewport = await measure();
    if (desktopViewportAvailable(viewport)) return viewport;

    await driver.setWindowSize(REQUESTED_WINDOW.width, REQUESTED_WINDOW.height);
    const outer = await driver.getWindowSize();
    viewport = await measure();
    if (!desktopViewportAvailable(viewport)) {
      // Follow the desktop geometry fixture: compensate from measured client/outer sizes,
      // not an assumed DPI factor or the requested outer size.
      await driver.setWindowSize(
        outer.width + Math.max(0, REQUESTED_WINDOW.width - viewport.width),
        outer.height + Math.max(0, REQUESTED_WINDOW.height - viewport.height),
      );
    }
    await driver.waitUntil(
      async () => {
        viewport = await measure();
        return desktopViewportAvailable(viewport);
      },
      { timeout: 10_000, interval: 200, timeoutMsg: 'isolated desktop viewport unavailable' },
    );
    return viewport;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `isolated desktop viewport unavailable: measured ${viewport.width}x${viewport.height}, ` +
        `required at least ${MINIMUM_VIEWPORT.width}x${MINIMUM_VIEWPORT.height}; ${detail}`,
      { cause: error },
    );
  }
}
