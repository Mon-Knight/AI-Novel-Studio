import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  bridgeCall,
  clickTestId,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

interface CandidateDraft {
  id: string;
  novelId: string;
  chapterId: string;
  content: string;
  source: string;
  versionNo: number;
  wordCount: number;
  isAdopted: boolean;
  aiTaskId?: string;
}

interface AiTaskView {
  id: string;
  novelId?: string;
  chapterId?: string;
  taskType: string;
  status: string;
  runtimeMode?: string;
  provider?: string;
}

function normalizeTextareaLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

describe('candidate review and adoption', () => {
  it('generates a candidate, reviews its constraints, and adopts it only after confirmation', async () => {
    const projectId = await createProjectThroughUi(E2E_FIXTURES.candidateApply.projectTitle);
    await openWorkspace(projectId);
    const chapterId = await createFirstChapterThroughUi();
    const sourceEditor = await waitForTestIdAttribute(
      'chapter-editor',
      'data-chapter-id',
      chapterId,
    );
    const sourceDraftId = await sourceEditor.getAttribute('data-draft-id');
    const sourceRevision = await sourceEditor.getAttribute('data-draft-version');
    const sourceContentHash = await sourceEditor.getAttribute('data-content-hash');
    expect(sourceDraftId).toBeTruthy();
    expect(sourceRevision).toBeTruthy();
    expect(sourceContentHash).toBeTruthy();
    await clickTestId('ai-generate');

    await clickTestId('ai-generate-submit');
    await waitForTestId('generation-preflight');
    await clickTestId('dialog-confirm');

    const review = await waitForTestIdAttribute('candidate-review', 'data-chapter-id', chapterId);
    const candidateContent = await waitForTestId('candidate-content');
    const constraints = await waitForTestId('candidate-constraints');
    const resultId = await review.getAttribute('data-result-id');
    const aiTaskId = await review.getAttribute('data-ai-task-id');
    expect(resultId).toBeTruthy();
    expect(await review.getAttribute('data-draft-id')).toBe(resultId);
    expect(await review.getAttribute('data-novel-id')).toBe(projectId);
    expect(await review.getAttribute('data-chapter-id')).toBe(chapterId);
    expect(await review.getAttribute('data-result-source')).toBe('ai_generate');
    expect(await review.getAttribute('data-source-draft-id')).toBe(sourceDraftId);
    expect(await review.getAttribute('data-source-revision')).toBe(sourceRevision);
    expect(await review.getAttribute('data-base-content-hash')).toBe(sourceContentHash);
    expect(await constraints.getAttribute('data-draft-id')).toBe(resultId);
    for (const attribute of [
      'data-outline-score',
      'data-missing-outline-count',
      'data-missing-required-count',
    ]) {
      const rawValue = await constraints.getAttribute(attribute);
      expect(rawValue).toBeTruthy();
      const numericValue = Number(rawValue);
      expect(Number.isFinite(numericValue)).toBe(true);
      expect(numericValue).toBeGreaterThanOrEqual(0);
    }

    expect(await candidateContent.getText()).toContain(
      E2E_FIXTURES.candidateApply.mockExpectedFragment,
    );
    const draftsBeforeAdoption = await bridgeCall<CandidateDraft[]>('get_drafts_by_chapter_id', {
      chapterId,
    });
    const candidate = draftsBeforeAdoption.find((draft) => draft.id === resultId);
    expect(candidate?.novelId).toBe(projectId);
    expect(candidate?.chapterId).toBe(chapterId);
    expect(candidate?.content).toContain(E2E_FIXTURES.candidateApply.mockExpectedFragment);
    expect(candidate?.source).toBe('ai_generated');
    expect(candidate?.isAdopted).toBe(false);
    expect(candidate?.aiTaskId).toBe(aiTaskId);
    if (!candidate) throw new Error('Generated candidate was not persisted');

    const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    expect(await editor.getAttribute('data-draft-id')).toBe(resultId);
    expect(await editor.getAttribute('data-adopted')).toBe('false');
    expect(Number(await editor.getAttribute('data-word-count'))).toBe(candidate.wordCount);
    expect(normalizeTextareaLineEndings(await editor.getValue())).toBe(
      normalizeTextareaLineEndings(candidate.content),
    );
    expect(await editor.getAttribute('data-dirty')).toBe('false');

    const tasks = await bridgeCall<AiTaskView[]>('get_ai_task_records_by_chapter_id', {
      chapterId,
    });
    const generationTasks = tasks.filter(
      (task) => task.chapterId === chapterId && task.taskType === 'chapter_generate',
    );
    expect(generationTasks).toHaveLength(1);
    const generationTask = generationTasks[0];
    expect(generationTask.id).toBe(aiTaskId);
    expect(generationTask?.novelId).toBe(projectId);
    expect(generationTask?.chapterId).toBe(chapterId);
    expect(generationTask?.taskType).toBe('chapter_generate');
    expect(generationTask?.status).toBe('succeeded');
    expect(generationTask?.runtimeMode).toBe('mock');
    expect(generationTask?.provider).toBe('mock');

    const applyButton = await waitForTestId('candidate-apply');
    expect(await applyButton.getAttribute('data-result-id')).toBe(resultId);
    expect(await applyButton.getAttribute('data-novel-id')).toBe(projectId);
    expect(await applyButton.getAttribute('data-chapter-id')).toBe(chapterId);
    expect(await applyButton.getAttribute('data-apply-mode')).toBe('adopt');
    await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="candidate-apply"]');
      if (!button) throw new Error('candidate-apply is unavailable');
      button.click();
      button.click();
    });
    await waitForTestId('apply-confirm');
    expect(await applyButton.isEnabled()).toBe(false);
    await clickTestId('dialog-confirm');

    await browser.waitUntil(
      async () => {
        const drafts = await bridgeCall<CandidateDraft[]>('get_drafts_by_chapter_id', {
          chapterId,
        });
        return (
          drafts.filter((draft) => draft.isAdopted).length === 1 &&
          drafts.find((draft) => draft.isAdopted)?.id === resultId
        );
      },
      { timeout: 30000, timeoutMsg: 'candidate was not adopted' },
    );
    await applyButton.waitForEnabled({ timeout: 30000 });
    await waitForTestId('success-notice');
    await browser.waitUntil(
      async () => {
        const currentEditor = await browser.$('[data-testid="chapter-editor"]');
        return (
          (await currentEditor.getAttribute('data-draft-id')) === resultId &&
          (await currentEditor.getAttribute('data-adopted')) === 'true' &&
          Number(await currentEditor.getAttribute('data-word-count')) === candidate.wordCount
        );
      },
      { timeout: 30000, timeoutMsg: 'adopted draft state did not synchronize to the editor' },
    );
    const wordCount = await waitForTestId('chapter-word-count');
    expect(Number(await wordCount.getAttribute('data-word-count'))).toBe(candidate.wordCount);

    const chapters = await bridgeCall<
      Array<{ id: string; novelId: string; adoptedDraftId?: string }>
    >('get_chapters_by_novel_id', { novelId: projectId });
    const chapter = chapters.find((item) => item.id === chapterId);
    expect(chapter?.novelId).toBe(projectId);
    expect(chapter?.adoptedDraftId).toBe(resultId);
    const draftsAfterAdoption = await bridgeCall<CandidateDraft[]>('get_drafts_by_chapter_id', {
      chapterId,
    });
    expect(draftsAfterAdoption).toHaveLength(draftsBeforeAdoption.length);
    expect(draftsAfterAdoption.filter((draft) => draft.isAdopted)).toHaveLength(1);

    await clickTestId('candidate-apply');
    await waitForTestId('apply-confirm');
    expect(await applyButton.isEnabled()).toBe(false);
    await clickTestId('dialog-confirm');
    await applyButton.waitForEnabled({ timeout: 30000 });
    const draftsAfterRepeat = await bridgeCall<CandidateDraft[]>('get_drafts_by_chapter_id', {
      chapterId,
    });
    expect(draftsAfterRepeat).toHaveLength(draftsBeforeAdoption.length);
    expect(
      draftsAfterRepeat.filter((draft) => draft.isAdopted && draft.id === resultId),
    ).toHaveLength(1);
    const tasksAfterRepeat = await bridgeCall<AiTaskView[]>('get_ai_task_records_by_chapter_id', {
      chapterId,
    });
    const generationTasksAfterRepeat = tasksAfterRepeat.filter(
      (task) => task.chapterId === chapterId && task.taskType === 'chapter_generate',
    );
    expect(generationTasksAfterRepeat).toHaveLength(1);
    expect(generationTasksAfterRepeat[0].id).toBe(aiTaskId);
    expect(generationTasksAfterRepeat[0].status).toBe('succeeded');
    const adoptedEditor = await waitForTestId('chapter-editor');
    expect(normalizeTextareaLineEndings(await adoptedEditor.getValue())).toBe(
      normalizeTextareaLineEndings(candidate.content),
    );
    expect(await adoptedEditor.getAttribute('data-adopted')).toBe('true');
    expect(Number(await adoptedEditor.getAttribute('data-word-count'))).toBe(candidate.wordCount);
  });
});
