import { browser, expect } from '@wdio/globals';
import type { CompleteProjectBackup } from '../../src/services/backup/projectBackupSchema';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createProjectThroughUi,
  navigateHash,
  waitForTestId,
  waitForTestIdMissing,
} from './helpers';

const SOURCE_NOVEL = '35af433e-6442-45be-9a93-c7b54b57f125';
const SOURCE_CHAPTER = '52d2d938-29a9-4c85-89ed-52b4221d58f3';
const RESTORED_TITLE = 'E2E project backup attachment boundary';
const FOREIGN_OUTLINE_KEY = 'ai_novel_studio_unsaved_chapter_outline_unrelated-e2e-chapter';
const OUTLINE = '  合成的大纲第一行\r\n第二行\n';

function fixture(): CompleteProjectBackup {
  const names = [
    'world_settings',
    'rule_systems',
    'protagonists',
    'volumes',
    'chapters',
    'style_profiles',
    'output_profiles',
    'imported_assets',
    'characters',
    'ai_task_records',
    'chapter_drafts',
    'chapter_engineering_states',
    'chapter_generation_snapshots',
    'generation_jobs',
    'generation_step_results',
    'character_states',
    'chapter_characters',
    'chapter_events',
    'chapter_summaries',
    'context_records',
    'quality_check_reports',
    'quality_check_items',
    'polish_records',
    'quality_fix_runs',
    'context_read_logs',
    'master_outlines',
    'volume_outlines',
    'chapter_outlines',
    'large_text_documents',
    'large_text_chunks',
  ];
  const stamp = '2026-01-01T00:00:00Z';
  return {
    type: 'ai_novel_studio_project',
    schemaVersion: 2,
    exportedAt: stamp,
    sourceAppVersion: '2.1.2',
    novel: { id: SOURCE_NOVEL, title: RESTORED_TITLE, created_at: stamp, updated_at: stamp },
    tables: {
      ...Object.fromEntries(names.map((name) => [name, []])),
      chapters: [
        {
          id: SOURCE_CHAPTER,
          novel_id: SOURCE_NOVEL,
          title: '合成恢复章节',
          created_at: stamp,
          updated_at: stamp,
        },
      ],
    },
    localStorage: {
      version: 1,
      collections: {},
      entries: {},
      rawEntries: { [`ai_novel_studio_unsaved_chapter_outline_${SOURCE_CHAPTER}`]: OUTLINE },
    },
  };
}

async function selectBackup(backup: CompleteProjectBackup): Promise<void> {
  await clickTestId('project-import-json');
  await waitForTestId('project-import-dialog');
  // Feed the native WebView file input, then exercise the production parsing,
  // confirmation and service/IPC chain; no service or database writes are mocked.
  await browser.execute((json) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-file"]');
    if (!input) throw new Error('Project backup file input is missing');
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([json], 'isolated-project-backup.json', { type: 'application/json' }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, JSON.stringify(backup));
  await waitForTestId('project-import-confirm');
}

describe('project backup attachment boundary', () => {
  it('rejects foreign cache writes before import and still restores a safe historical backup', async () => {
    const sentinelId = await createProjectThroughUi('E2E untouched backup sentinel');
    const before = await bridgeCall<Array<{ id: string }>>('get_all_novels');
    const originalSettings = await browser.execute((outlineKey) => {
      localStorage.setItem(outlineKey, 'unrelated outline stays unchanged');
      return localStorage.getItem('ai_novel_studio_ai_settings');
    }, FOREIGN_OUTLINE_KEY);
    await navigateHash('#/import-export');
    await clickTestId('project-import-tab');
    const malicious = [fixture(), fixture(), fixture()];
    malicious[0].localStorage!.entries.ai_novel_studio_ai_settings = { runtimeMode: 'api' };
    malicious[1].localStorage!.rawEntries![FOREIGN_OUTLINE_KEY] = 'must not overwrite';
    malicious[2].localStorage!.collections.ai_novel_studio_quality_reports = [
      { id: 'foreign-report', novelId: sentinelId, chapterId: SOURCE_CHAPTER },
    ];
    for (const backup of malicious) {
      await selectBackup(backup);
      await waitForTestId('project-import-invalid');
      expect(await (await waitForTestId('project-import-confirm')).isEnabled()).toBe(false);
      const after = await bridgeCall<Array<{ id: string }>>('get_all_novels');
      expect(after.map((novel) => novel.id).sort()).toEqual(before.map((novel) => novel.id).sort());
      const caches = await browser.execute(
        (outlineKey) => ({
          settings: localStorage.getItem('ai_novel_studio_ai_settings'),
          outline: localStorage.getItem(outlineKey),
        }),
        FOREIGN_OUTLINE_KEY,
      );
      expect(caches.settings).toBe(originalSettings);
      expect(caches.outline).toBe('unrelated outline stays unchanged');
      await clickTestId('project-import-close');
      await waitForTestIdMissing('project-import-dialog');
    }

    await selectBackup(fixture());
    const confirm = await waitForTestId('project-import-confirm');
    await confirm.waitForEnabled();
    await confirm.click();
    await waitForTestId('project-import-result');
    const after = await bridgeCall<Array<{ id: string; title: string }>>('get_all_novels');
    const restored = after.find((novel) => novel.title === RESTORED_TITLE);
    expect(after).toHaveLength(before.length + 1);
    expect(restored).toBeDefined();
    expect(restored!.id).not.toBe(SOURCE_NOVEL);
    const chapters = await bridgeCall<Array<{ id: string }>>('get_chapters_by_novel_id', {
      novelId: restored!.id,
    });
    expect(chapters).toHaveLength(1);
    expect(chapters[0].id).not.toBe(SOURCE_CHAPTER);
    expect(
      await browser.execute(
        (id) => localStorage.getItem(`ai_novel_studio_unsaved_chapter_outline_${id}`),
        chapters[0].id,
      ),
    ).toBe(OUTLINE);
    await assertCleanDiagnostics();
  });
});
