import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  bridgeDiagnostics,
  EXPECTED_SQLITE_SOURCE_ID,
  EXPECTED_SQLITE_VERSION,
  waitForTestId,
} from './helpers';

describe('desktop startup', () => {
  it('opens a healthy isolated Tauri workspace', async () => {
    await waitForTestId('app-shell');
    await waitForTestId('workbench-no-projects');
    const bridgeProbe = await browser.execute(() => {
      const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: unknown })
        .__AI_NOVEL_STUDIO_E2E__;
      return {
        type: typeof bridge,
        invoke: typeof (bridge as { invoke?: unknown } | undefined)?.invoke,
      };
    });
    expect(bridgeProbe).toEqual({ type: 'object', invoke: 'function' });
    await assertCleanDiagnostics();
    const diagnostics = await bridgeDiagnostics();
    expect(diagnostics.databasePath).toContain('ai-novel-studio.db');
    expect(diagnostics.sqliteVersion).toBe(EXPECTED_SQLITE_VERSION);
    expect(diagnostics.sqliteSourceId).toBe(EXPECTED_SQLITE_SOURCE_ID);
    expect(diagnostics.journalMode).toBe('wal');
    expect(diagnostics.foreignKeysEnabled).toBe(true);
    expect(diagnostics.busyTimeoutMs).toBe(5000);
    expect(diagnostics.synchronous).toBe('full');
    expect(diagnostics.compileOptions).toEqual([...(diagnostics.compileOptions ?? [])].sort());
    expect(diagnostics.compileOptions).toContain('ENABLE_FTS5');
    expect(diagnostics.jsonEnabled).toBe(true);
    expect(diagnostics.migrationCount).toBeGreaterThanOrEqual(31);
    expect(diagnostics.latestMigrationId).toMatch(/^\d{3}_[a-z0-9_]+$/);
    expect(diagnostics.counts?.novels).toBe(0);
    expect(diagnostics.counts?.executionTasks).toBe(0);
    expect(diagnostics.counts?.resultArtifacts).toBe(0);
    expect(diagnostics.counts?.placementProposals).toBe(0);
    expect(diagnostics.counts?.applyPlans).toBe(0);
    expect(diagnostics.counts?.artifactTargetLinks).toBe(0);
  });
});
