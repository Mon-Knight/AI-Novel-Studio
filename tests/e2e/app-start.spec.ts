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
    expect(diagnostics.migrationCount).toBe(11);
    expect(diagnostics.latestMigrationId).toBe('011_artifact_validation_issues');
    expect(diagnostics.counts?.novels).toBe(0);
    expect(diagnostics.counts?.executionTasks).toBe(0);
    expect(diagnostics.counts?.resultArtifacts).toBe(0);
  });
});
