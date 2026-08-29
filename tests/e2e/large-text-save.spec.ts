import { browser, expect } from '@wdio/globals';
import { createHash } from 'node:crypto';
import { createLargeTextContent, E2E_FIXTURES } from './fixtures/data';
import {
  bridgeCall,
  bridgeClearDiagnostics,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTextareaTestId,
  findTestIdByAttribute,
  goHome,
  navigateHash,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

interface LargeTextDraft {
  id: string;
  novelId: string;
  chapterId: string;
  content: string;
  wordCount: number;
  isAdopted: boolean;
  largeTextRefId?: string;
}

interface LargeTextDraftState {
  draftId: string;
  chapterId: string;
  largeTextRefId?: string;
  preview: string;
  documentCount: number;
  chunkCount: number;
  totalChars: number;
  totalBytes: number;
  contentSha256?: string;
  adopted: boolean;
}

interface CorruptLargeTextChunkResult {
  draftId: string;
  documentId: string;
  chunkIndex: number;
  affectedRows: number;
}

const normalizeTextareaLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function countWords(value: string): number {
  const cleaned = value.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) ?? []).length;
  return cjk + words;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function waitForSavedDraft(chapterId: string) {
  await browser.waitUntil(
    async () => {
      const editor = await browser.$('[data-testid="chapter-editor"]');
      return (
        (await editor.getAttribute('data-chapter-id')) === chapterId &&
        (await editor.getAttribute('data-dirty')) === 'false' &&
        (await editor.getAttribute('data-saving')) === 'false' &&
        Boolean(await editor.getAttribute('data-draft-id'))
      );
    },
    { timeout: 60000, timeoutMsg: 'large-text draft did not finish saving' },
  );
  return waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
}

async function loadChapter(chapterId: string) {
  const item = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
  await item.waitForClickable({ timeout: 30000 });
  await item.click();
  return waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId, 60000);
}

describe('large-text chapter safety', () => {
  beforeEach(async () => {
    await goHome();
  });

  it('saves, leaves, reopens, and adopts a 120 KiB+ chapter without changing its content', async () => {
    const sourceContent = createLargeTextContent();
    expect(byteLength(sourceContent)).toBeGreaterThan(120 * 1024);
    expect(sourceContent).toContain('\r\n');
    expect(sourceContent).toContain('旧城');
    expect(sourceContent).toContain('🧭');
    expect(sourceContent).toContain('🚀');

    const projectId = await createProjectThroughUi(E2E_FIXTURES.largeText.projectTitle);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(E2E_FIXTURES.largeText.volumeTitle);
    const chapterId = await createChapterThroughUi(E2E_FIXTURES.largeText.chapterTitle, volumeId);

    const canonicalContent = await fillTextareaTestId('chapter-editor', sourceContent);
    expect(canonicalContent).toBe(normalizeTextareaLineEndings(sourceContent));
    expect(byteLength(canonicalContent)).toBeGreaterThan(120 * 1024);
    await clickTestId('chapter-save');
    const savedEditor = await waitForSavedDraft(chapterId);
    expect(await savedEditor.getValue()).toBe(canonicalContent);
    expect(Number(await savedEditor.getAttribute('data-word-count'))).toBe(
      countWords(canonicalContent),
    );

    const draftId = await savedEditor.getAttribute('data-draft-id');
    if (!draftId) throw new Error('Saved large-text draft did not expose data-draft-id');
    const savedDrafts = await bridgeCall<LargeTextDraft[]>('get_drafts_by_chapter_id', {
      chapterId,
    });
    const savedDraft = savedDrafts.find((draft) => draft.id === draftId);
    expect(savedDraft?.largeTextRefId).toBeTruthy();
    expect(savedDraft?.wordCount).toBe(countWords(canonicalContent));
    expect(savedDraft?.content).not.toBe(canonicalContent);
    expect(savedDrafts.filter((draft) => draft.id === draftId)).toHaveLength(1);

    const persistedState = await bridgeCall<LargeTextDraftState>('get_e2e_large_text_draft_state', {
      draftId,
    });
    expect(persistedState.draftId).toBe(draftId);
    expect(persistedState.chapterId).toBe(chapterId);
    expect(persistedState.largeTextRefId).toBe(savedDraft?.largeTextRefId);
    expect(persistedState.documentCount).toBe(1);
    expect(persistedState.chunkCount).toBeGreaterThan(1);
    expect(persistedState.totalChars).toBe([...canonicalContent].length);
    expect(persistedState.totalBytes).toBe(byteLength(canonicalContent));
    expect(persistedState.contentSha256).toBe(sha256(canonicalContent));
    expect(persistedState.preview).not.toBe(canonicalContent);
    expect([...persistedState.preview].length).toBe(500);
    expect(persistedState.adopted).toBe(false);

    await navigateHash(`#/novels/${projectId}`);
    await waitForTestIdAttribute('project-settings', 'data-project-id', projectId);
    await openWorkspace(projectId);
    const reopenedEditor = await loadChapter(chapterId);
    expect(await reopenedEditor.getValue()).toBe(canonicalContent);
    expect(await reopenedEditor.getAttribute('data-dirty')).toBe('false');
    expect(await reopenedEditor.getAttribute('data-draft-id')).toBe(draftId);

    await clickTestId('chapter-adopt');
    await waitForTestId('apply-confirm');
    await clickTestId('dialog-confirm');
    await browser.waitUntil(
      async () => {
        const editor = await browser.$('[data-testid="chapter-editor"]');
        return (
          (await editor.getAttribute('data-draft-id')) === draftId &&
          (await editor.getAttribute('data-adopted')) === 'true' &&
          (await editor.getAttribute('data-dirty')) === 'false'
        );
      },
      { timeout: 60000, timeoutMsg: 'large-text draft was not adopted' },
    );

    const adoptedEditor = await waitForTestIdAttribute('chapter-editor', 'data-draft-id', draftId);
    expect(await adoptedEditor.getValue()).toBe(canonicalContent);
    const chapters = await bridgeCall<Array<{ id: string; adoptedDraftId?: string }>>(
      'get_chapters_by_novel_id',
      { novelId: projectId },
    );
    expect(chapters.find((chapter) => chapter.id === chapterId)?.adoptedDraftId).toBe(draftId);
    const adoptedDrafts = await bridgeCall<LargeTextDraft[]>('get_drafts_by_chapter_id', {
      chapterId,
    });
    expect(adoptedDrafts.filter((draft) => draft.id === draftId && draft.isAdopted)).toHaveLength(
      1,
    );
    const adoptedState = await bridgeCall<LargeTextDraftState>('get_e2e_large_text_draft_state', {
      draftId,
    });
    expect(adoptedState.adopted).toBe(true);
    expect(adoptedState.contentSha256).toBe(sha256(canonicalContent));
  });

  it('fails closed on a corrupted chunk without exposing its preview as editable content', async () => {
    const projectId = await createProjectThroughUi(E2E_FIXTURES.largeText.corruptionProjectTitle);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(E2E_FIXTURES.largeText.volumeTitle);
    const damagedChapterId = await createChapterThroughUi(
      E2E_FIXTURES.largeText.chapterTitle,
      volumeId,
    );
    const canonicalContent = await fillTextareaTestId('chapter-editor', createLargeTextContent());
    await clickTestId('chapter-save');
    const damagedEditor = await waitForSavedDraft(damagedChapterId);
    const draftId = await damagedEditor.getAttribute('data-draft-id');
    if (!draftId) throw new Error('Saved large-text draft did not expose data-draft-id');

    const stateBeforeCorruption = await bridgeCall<LargeTextDraftState>(
      'get_e2e_large_text_draft_state',
      { draftId },
    );
    expect(stateBeforeCorruption.chunkCount).toBeGreaterThan(1);
    expect(stateBeforeCorruption.preview).not.toBe(canonicalContent);
    expect(stateBeforeCorruption.contentSha256).toBe(sha256(canonicalContent));
    if (!stateBeforeCorruption.largeTextRefId) {
      throw new Error('Large-text diagnostic state did not expose its document reference');
    }

    const safeChapterId = await createChapterThroughUi(
      E2E_FIXTURES.largeText.safeChapterTitle,
      volumeId,
    );
    await fillTextareaTestId('chapter-editor', E2E_FIXTURES.largeText.safeContent);
    await clickTestId('chapter-save');
    await waitForSavedDraft(safeChapterId);

    const corruption = await bridgeCall<CorruptLargeTextChunkResult>(
      'corrupt_e2e_large_text_chunk',
      { draftId, chunkIndex: 0 },
    );
    expect(corruption).toEqual({
      draftId,
      documentId: stateBeforeCorruption.largeTextRefId,
      chunkIndex: 0,
      affectedRows: 1,
    });

    const damagedChapter = await findTestIdByAttribute(
      'chapter-item',
      'data-chapter-id',
      damagedChapterId,
    );
    await damagedChapter.click();
    await waitForTestId('content-unavailable-state');
    expect(
      await (
        await findTestIdByAttribute('chapter-item', 'data-chapter-id', damagedChapterId)
      ).getAttribute('data-active'),
    ).toBe('true');
    expect(
      await (
        await findTestIdByAttribute('chapter-item', 'data-chapter-id', safeChapterId)
      ).getAttribute('data-active'),
    ).not.toBe('true');
    expect(await browser.$('[data-testid="chapter-editor"]').isExisting()).toBe(false);

    await clickTestId('content-unavailable-history');
    await waitForTestIdAttribute('draft-history-item', 'data-draft-id', draftId);
    expect(await browser.$('[data-testid="chapter-editor"]').isExisting()).toBe(false);
    expect(await browser.$('textarea').isExisting()).toBe(false);
    expect((await browser.$('body').getText()).includes(stateBeforeCorruption.preview)).toBe(false);

    const stateAfterFailedLoad = await bridgeCall<LargeTextDraftState>(
      'get_e2e_large_text_draft_state',
      { draftId },
    );
    expect(stateAfterFailedLoad).toEqual(stateBeforeCorruption);

    // The unavailable state is expected in this fault-injection case. Clear any
    // captured diagnostics so the global health gate still detects later failures.
    await bridgeClearDiagnostics();
  });
});
