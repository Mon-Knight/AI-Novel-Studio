import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  waitForTestIdAttribute,
} from './helpers';

describe('chapter editing', () => {
  it('creates a chapter, edits its draft, and persists the saved content', async () => {
    const projectId = await createProjectThroughUi(E2E_FIXTURES.chapterSave.projectTitle);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(E2E_FIXTURES.chapterSave.volumeTitle);
    const volume = await findTestIdByAttribute('volume-item', 'data-volume-id', volumeId);
    expect(await volume.getAttribute('data-volume-title')).toBe(E2E_FIXTURES.chapterSave.volumeTitle);
    const chapterId = await createChapterThroughUi(E2E_FIXTURES.chapterSave.chapterTitle, volumeId);

    const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    expect(await editor.getAttribute('data-chapter-id')).toBe(chapterId);
    const content = E2E_FIXTURES.chapterSave.content;
    await editor.click();
    await editor.clearValue();
    await editor.setValue(content);
    expect(await editor.getAttribute('data-dirty')).toBe('true');
    await clickTestId('chapter-save');
    await browser.waitUntil(async () => {
      const currentEditor = await browser.$('[data-testid="chapter-editor"]');
      return await currentEditor.getAttribute('data-dirty') === 'false'
        && await currentEditor.getAttribute('data-saving') === 'false';
    }, { timeout: 30000, timeoutMsg: 'chapter editor did not become clean after save' });
    expect(await editor.getAttribute('data-dirty')).not.toBe('true');

    const chapters = await bridgeCall<Array<{ id: string; novelId: string; volumeId?: string }>>('get_chapters_by_novel_id', { novelId: projectId });
    const chapter = chapters.find((item) => item.id === chapterId);
    expect(chapter?.novelId).toBe(projectId);
    expect(chapter?.volumeId).toBe(volumeId);
    const drafts = await bridgeCall<Array<{ id: string; novelId: string; chapterId: string; content: string }>>('get_drafts_by_chapter_id', { chapterId });
    expect(drafts.filter((draft) => draft.content === content)).toHaveLength(1);
    expect(drafts.find((draft) => draft.content === content)?.novelId).toBe(projectId);
    expect(drafts.find((draft) => draft.content === content)?.chapterId).toBe(chapterId);

    await navigateHash(`#/novels/${projectId}`);
    await waitForTestIdAttribute('project-settings', 'data-project-id', projectId);
    expect(await browser.execute(() => window.location.hash)).toBe(`#/novels/${projectId}`);
    await openWorkspace(projectId);
    const chapterItem = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
    await chapterItem.click();
    const reopenedEditor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    expect(await reopenedEditor.getValue()).toBe(content);
    expect(await reopenedEditor.getAttribute('data-dirty')).toBe('false');

    const persistedDrafts = await bridgeCall<Array<{ chapterId: string; content: string }>>('get_drafts_by_chapter_id', { chapterId });
    expect(persistedDrafts.filter((draft) => draft.chapterId === chapterId && draft.content === content)).toHaveLength(1);
  });
});
