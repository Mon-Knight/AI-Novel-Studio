import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  bridgeCall,
  bridgeDiagnostics,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  findTestIdByAttribute,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

interface MemorySnapshotRecord {
  snapshotId: string;
  targetChapterId: string;
  candidateCount: number;
  includedCount: number;
  omittedCount: number;
  memoryHash: string;
}

interface MemorySnapshotBundle {
  snapshot: MemorySnapshotRecord;
  sources: Array<{
    sourceType: string;
    sourceId: string;
    chapterId?: string | null;
    included: boolean;
  }>;
}

interface MemoryVerification {
  snapshotId: string;
  valid: boolean;
  drift: unknown[];
}

async function adoptEditorContent(chapterId: string, content: string): Promise<void> {
  const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
  await editor.click();
  await editor.clearValue();
  await editor.setValue(content);
  await browser.waitUntil(async () => await editor.getAttribute('data-dirty') === 'true', {
    timeout: 30000,
    timeoutMsg: 'memory fixture editor did not become dirty',
  });
  await clickTestId('chapter-adopt');
  await waitForTestId('apply-confirm');
  await clickTestId('dialog-confirm');
  await browser.waitUntil(async () => {
    const current = await browser.$('[data-testid="chapter-editor"]');
    return await current.getAttribute('data-adopted') === 'true'
      && await current.getAttribute('data-dirty') === 'false';
  }, {
    timeout: 60000,
    timeoutMsg: 'memory fixture draft was not adopted',
  });
}

async function selectChapter(chapterId: string): Promise<void> {
  const chapter = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
  await chapter.click();
  await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
}

describe('chapter continuity memory facts', () => {
  it('freezes prior continuity sources, verifies them, and reopens the same snapshot after restart', async () => {
    const projectId = await createProjectThroughUi('E2E Chapter Continuity Memory');
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi('E2E Memory Volume');
    const sourceChapterId = await createChapterThroughUi('E2E Memory Source Chapter', volumeId);
    await adoptEditorContent(
      sourceChapterId,
      '主角在旧塔发现铜钥匙，与同伴约定下一章前往北门。铜钥匙和北门约定必须持续记忆。',
    );
    await clickTestId('chapter-summary');
    await waitForTestIdAttribute('chapter-summary-panel', 'data-chapter-id', sourceChapterId);
    await clickTestId('chapter-summary-generate');
    const save = await waitForTestId('chapter-summary-save');
    await save.waitForEnabled({ timeout: 60000 });
    await save.click();
    await waitForTestId('chapter-summary-save-success');
    await clickTestId('chapter-summary');

    const targetChapterId = await createChapterThroughUi('E2E Memory Target Chapter', volumeId);
    await clickTestId('ai-generate');
    await waitForTestIdAttribute('chapter-continuity-memory', 'data-memory-status', 'none');
    await clickTestId('chapter-memory-create');
    const card = await waitForTestIdAttribute(
      'chapter-continuity-memory',
      'data-memory-status',
      'ready',
      60000,
    );
    await browser.waitUntil(async () => await card.getAttribute('data-memory-valid') === 'true', {
      timeout: 60000,
      timeoutMsg: 'new memory snapshot did not verify',
    });
    const snapshotId = await card.getAttribute('data-memory-snapshot-id');
    expect(snapshotId).toBeTruthy();

    const listed = await bridgeCall<MemorySnapshotRecord[]>('list_memory_snapshots_by_chapter', {
      input: { chapterId: targetChapterId, limit: 20 },
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].snapshotId).toBe(snapshotId);
    expect(listed[0].targetChapterId).toBe(targetChapterId);
    expect(listed[0].candidateCount).toBeGreaterThan(0);
    expect(listed[0].includedCount).toBeGreaterThan(0);
    expect(listed[0].omittedCount).toBe(0);

    const beforeRestart = await bridgeCall<MemorySnapshotBundle>('get_memory_snapshot', {
      input: { snapshotId },
    });
    expect(beforeRestart.sources.length).toBeGreaterThan(0);
    expect(beforeRestart.sources.every((source) => source.included)).toBe(true);
    expect(beforeRestart.sources.some((source) => source.chapterId === sourceChapterId)).toBe(true);
    expect(beforeRestart.sources.some((source) => source.chapterId === targetChapterId)).toBe(false);
    const verification = await bridgeCall<MemoryVerification>('verify_memory_snapshot', {
      input: { snapshotId },
    });
    expect(verification.valid).toBe(true);
    expect(verification.drift).toEqual([]);

    const diagnostics = await bridgeDiagnostics();
    expect(diagnostics.counts?.memorySnapshots).toBe(1);
    expect(diagnostics.counts?.memorySnapshotSources).toBe(beforeRestart.sources.length);
    await assertCleanDiagnostics();

    await browser.reloadSession();
    await waitForTestId('app-shell');
    await openWorkspace(projectId);
    await selectChapter(targetChapterId);
    await clickTestId('ai-generate');
    const reopened = await waitForTestIdAttribute(
      'chapter-continuity-memory',
      'data-memory-snapshot-id',
      snapshotId!,
    );
    await clickTestId('chapter-memory-verify');
    await browser.waitUntil(async () => await reopened.getAttribute('data-memory-valid') === 'true', {
      timeout: 60000,
      timeoutMsg: 'reopened memory snapshot did not verify',
    });
    const afterRestart = await bridgeCall<MemorySnapshotBundle>('get_memory_snapshot', {
      input: { snapshotId },
    });
    expect(afterRestart).toEqual(beforeRestart);
    await assertCleanDiagnostics();
  });
});

