import { browser, expect } from '@wdio/globals';
import { assertCleanDiagnostics, bridgeDiagnostics, waitForTestId } from './helpers';

describe('desktop startup', () => {
  it('opens a healthy isolated Tauri workspace', async () => {
    await waitForTestId('app-shell');
    await waitForTestId('project-list');
    const bridgeProbe = await browser.execute(() => {
      const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: unknown }).__AI_NOVEL_STUDIO_E2E__;
      return { type: typeof bridge, invoke: typeof (bridge as { invoke?: unknown } | undefined)?.invoke };
    });
    expect(bridgeProbe).toEqual({ type: 'object', invoke: 'function' });
    await assertCleanDiagnostics();
    const diagnostics = await bridgeDiagnostics();
    expect(diagnostics.databasePath).toContain('ai-novel-studio.db');
    expect(diagnostics.counts?.novels).toBe(0);
  });
});
