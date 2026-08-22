import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  findTestIdByAttribute,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

interface ChapterSummaryView {
  id: string;
  novelId: string;
  chapterId: string;
  adoptedDraftId: string;
  summary: string;
  enabled: boolean;
  isExpired: boolean;
  draftVersion?: number;
}

interface ContextRecordView {
  id: string;
  novelId: string;
  chapterId?: string;
  contextType: string;
  title: string;
  content: string;
  isActive: boolean;
  isExpired: boolean;
}

interface ChapterView {
  id: string;
  novelId: string;
  adoptedDraftId?: string;
  status: string;
}

async function adoptEditorContent(
  chapterId: string,
  content: string,
  previousDraftId?: string,
): Promise<string> {
  const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
  await editor.click();
  await editor.clearValue();
  await editor.setValue(content);
  await browser.waitUntil(async () => (await editor.getAttribute('data-dirty')) === 'true', {
    timeout: 30000,
    timeoutMsg: 'chapter editor did not become dirty before adoption',
  });
  await clickTestId('chapter-adopt');
  await waitForTestId('apply-confirm');
  await clickTestId('dialog-confirm');
  await browser.waitUntil(
    async () => {
      const current = await browser.$('[data-testid="chapter-editor"]');
      const draftId = await current.getAttribute('data-draft-id');
      return (
        Boolean(draftId) &&
        draftId !== previousDraftId &&
        (await current.getAttribute('data-adopted')) === 'true' &&
        (await current.getAttribute('data-dirty')) === 'false'
      );
    },
    {
      timeout: 60000,
      interval: 100,
      timeoutMsg: 'chapter draft was not adopted',
    },
  );
  const draftId = await editor.getAttribute('data-draft-id');
  if (!draftId) throw new Error('adopted editor did not expose a draft ID');
  return draftId;
}

async function selectChapter(chapterId: string): Promise<void> {
  const chapterItem = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
  await chapterItem.click();
  await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
}

describe('chapter context persistence', () => {
  it('keeps context stable across restart and excludes expired records after the next restart', async () => {
    const fixture = E2E_FIXTURES.chapterContextPersistence;
    const projectId = await createProjectThroughUi(fixture.projectTitle);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(fixture.volumeTitle);
    const chapterId = await createChapterThroughUi(fixture.chapterTitle, volumeId);
    const adoptedDraftId = await adoptEditorContent(chapterId, fixture.adoptedContent);

    await clickTestId('chapter-summary');
    await waitForTestIdAttribute('chapter-summary-panel', 'data-chapter-id', chapterId);
    await clickTestId('chapter-summary-generate');
    const saveButton = await waitForTestId('chapter-summary-save');
    await saveButton.waitForEnabled({ timeout: 60000 });
    await saveButton.click();
    await waitForTestId('chapter-summary-save-success');
    const savedRecord = await waitForTestId('chapter-summary-record');
    const summaryId = await savedRecord.getAttribute('data-summary-id');
    expect(summaryId).toBeTruthy();

    const [
      summaryBeforeRestart,
      summariesBeforeRestart,
      recordsBeforeRestart,
      chaptersBeforeRestart,
    ] = await Promise.all([
      bridgeCall<ChapterSummaryView | null>('get_chapter_summary', { chapterId }),
      bridgeCall<ChapterSummaryView[]>('get_chapter_summaries_by_novel', { novelId: projectId }),
      bridgeCall<ContextRecordView[]>('get_context_records', { novelId: projectId }),
      bridgeCall<ChapterView[]>('get_chapters_by_novel_id', { novelId: projectId }),
    ]);
    expect(summaryBeforeRestart).not.toBeNull();
    expect(summaryBeforeRestart?.id).toBe(summaryId);
    expect(summaryBeforeRestart?.adoptedDraftId).toBe(adoptedDraftId);
    expect(summaryBeforeRestart?.isExpired).toBe(false);
    expect(summariesBeforeRestart.filter((item) => item.chapterId === chapterId)).toHaveLength(1);
    const chapterRecordsBeforeRestart = recordsBeforeRestart.filter(
      (record) => record.chapterId === chapterId,
    );
    expect(chapterRecordsBeforeRestart.length).toBeGreaterThan(0);
    expect(
      chapterRecordsBeforeRestart.every((record) => record.isActive && !record.isExpired),
    ).toBe(true);
    expect(chaptersBeforeRestart.find((chapter) => chapter.id === chapterId)?.status).toBe(
      'summarized',
    );

    await clickTestId('ai-generate');
    const initialContextCount = await waitForTestId('generation-context-count');
    await browser.waitUntil(
      async () => Number(await initialContextCount.getAttribute('data-context-count')) > 0,
      {
        timeout: 30000,
        timeoutMsg: 'saved context was not available to generation',
      },
    );

    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    await waitForTestIdMissing('recovery-dialog', 5000);
    await openWorkspace(projectId);
    await selectChapter(chapterId);
    await clickTestId('chapter-summary');
    const reopenedSummary = await waitForTestIdAttribute(
      'chapter-summary-record',
      'data-summary-id',
      summaryId!,
    );
    expect(await reopenedSummary.getAttribute('data-summary-expired')).toBe('false');

    const [summaryAfterRestart, recordsAfterRestart] = await Promise.all([
      bridgeCall<ChapterSummaryView | null>('get_chapter_summary', { chapterId }),
      bridgeCall<ContextRecordView[]>('get_context_records', { novelId: projectId }),
    ]);
    expect(summaryAfterRestart).toEqual(summaryBeforeRestart);
    const persistedRecords = recordsAfterRestart.filter((record) => record.chapterId === chapterId);
    expect(persistedRecords).toEqual(chapterRecordsBeforeRestart);

    await clickTestId('chapter-summary');
    await waitForTestIdMissing('chapter-summary-panel');
    const revisedDraftId = await adoptEditorContent(
      chapterId,
      fixture.revisedContent,
      adoptedDraftId,
    );
    expect(revisedDraftId).not.toBe(adoptedDraftId);

    // Adoption must expire persisted context in the same SQLite transaction. Do not
    // open the summary panel before these assertions: the panel must not be required
    // to repair stale context lazily.
    const [expiredSummary, expiredRecords] = await Promise.all([
      bridgeCall<ChapterSummaryView | null>('get_chapter_summary', { chapterId }),
      bridgeCall<ContextRecordView[]>('get_context_records', { novelId: projectId }),
    ]);
    expect(expiredSummary?.id).toBe(summaryId);
    expect(expiredSummary?.isExpired).toBe(true);
    const expiredChapterRecords = expiredRecords.filter((record) => record.chapterId === chapterId);
    expect(expiredChapterRecords.map((record) => record.id).sort()).toEqual(
      chapterRecordsBeforeRestart.map((record) => record.id).sort(),
    );
    expect(expiredChapterRecords.every((record) => record.isExpired)).toBe(true);

    await clickTestId('ai-generate');
    await waitForTestIdAttribute('generation-context-count', 'data-context-count', '0');
    await clickTestId('chapter-summary');
    await waitForTestIdAttribute('chapter-summary-panel', 'data-summary-expired', 'true');

    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    await waitForTestIdMissing('recovery-dialog', 5000);
    await openWorkspace(projectId);
    await selectChapter(chapterId);
    await clickTestId('ai-generate');
    await waitForTestIdAttribute('generation-context-count', 'data-context-count', '0');
    const recordsAfterExpiryRestart = await bridgeCall<ContextRecordView[]>('get_context_records', {
      novelId: projectId,
    });
    const finalChapterRecords = recordsAfterExpiryRestart.filter(
      (record) => record.chapterId === chapterId,
    );
    expect(finalChapterRecords).toEqual(expiredChapterRecords);
    expect(finalChapterRecords.every((record) => record.isExpired)).toBe(true);
    await assertCleanDiagnostics();
  });
});
