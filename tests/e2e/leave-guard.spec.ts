import { expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  findTestIdByAttribute,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

describe('unsaved document leave guard', () => {
  it('keeps dirty content when leaving is cancelled, then allows the confirmed switch', async () => {
    const projectId = await createProjectThroughUi(E2E_FIXTURES.leaveGuard.projectTitle);
    await openWorkspace(projectId);
    const firstChapterId = await createFirstChapterThroughUi();
    const secondChapterId = await createChapterThroughUi(E2E_FIXTURES.leaveGuard.secondChapterTitle);

    const firstChapter = await findTestIdByAttribute('chapter-item', 'data-chapter-id', firstChapterId);
    await firstChapter.click();
    const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', firstChapterId);
    const content = E2E_FIXTURES.leaveGuard.unsavedContent;
    await editor.clearValue();
    await editor.setValue(content);
    expect(await editor.getAttribute('data-dirty')).toBe('true');

    const secondChapter = await findTestIdByAttribute('chapter-item', 'data-chapter-id', secondChapterId);
    await secondChapter.click();
    await waitForTestId('workspace-leave-dialog');
    await clickTestId('workspace-leave-cancel');
    await waitForTestIdMissing('workspace-leave-dialog');

    expect(await editor.getValue()).toContain(content);
    expect(await editor.getAttribute('data-dirty')).toBe('true');
    expect(await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', firstChapterId)).getAttribute('data-active')).toBe('true');

    await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', secondChapterId)).click();
    await waitForTestId('workspace-leave-dialog');
    await clickTestId('workspace-leave-save');
    await waitForTestIdMissing('workspace-leave-dialog');
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', secondChapterId);
    expect(await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', secondChapterId)).getAttribute('data-active')).toBe('true');

    const chapters = await bridgeCall<Array<{ id: string; novelId: string }>>('get_chapters_by_novel_id', { novelId: projectId });
    expect(chapters.filter((chapter) => chapter.id === firstChapterId || chapter.id === secondChapterId)).toHaveLength(2);
    expect(chapters.every((chapter) => chapter.novelId === projectId)).toBe(true);
    const firstChapterDrafts = await bridgeCall<Array<{ id: string; chapterId: string; content: string }>>('get_drafts_by_chapter_id', { chapterId: firstChapterId });
    const savedDraft = firstChapterDrafts.find((draft) => draft.chapterId === firstChapterId && draft.content === content);
    expect(savedDraft).toBeTruthy();
    expect(firstChapterDrafts.filter((draft) => draft.chapterId === firstChapterId && draft.content === content)).toHaveLength(1);

    await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', firstChapterId)).click();
    const reopenedEditor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', firstChapterId);
    expect(await reopenedEditor.getValue()).toBe(content);
    expect(await reopenedEditor.getAttribute('data-dirty')).toBe('false');

    const discardedContent = E2E_FIXTURES.leaveGuard.discardedContent;
    await reopenedEditor.clearValue();
    await reopenedEditor.setValue(discardedContent);
    expect(await reopenedEditor.getAttribute('data-dirty')).toBe('true');
    await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', secondChapterId)).click();
    await waitForTestId('workspace-leave-dialog');
    await clickTestId('workspace-leave-discard');
    await waitForTestIdMissing('workspace-leave-dialog');
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', secondChapterId);

    const draftsAfterDiscard = await bridgeCall<Array<{ id: string; chapterId: string; content: string }>>('get_drafts_by_chapter_id', { chapterId: firstChapterId });
    expect(draftsAfterDiscard).toHaveLength(firstChapterDrafts.length);
    expect(draftsAfterDiscard.find((draft) => draft.id === savedDraft?.id)?.content).toBe(content);
    expect(draftsAfterDiscard.some((draft) => draft.content === discardedContent)).toBe(false);

    await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', firstChapterId)).click();
    const editorAfterDiscard = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', firstChapterId);
    expect(await editorAfterDiscard.getValue()).toBe(content);
    expect(await editorAfterDiscard.getValue()).not.toBe(discardedContent);
    expect(await editorAfterDiscard.getAttribute('data-dirty')).toBe('false');
    await waitForTestIdMissing('error-notice', 5000);
  });
});
