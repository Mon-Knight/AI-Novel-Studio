import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  bridgeCall,
  clickTestId,
  createProjectThroughUi,
  fillTestId,
  findTestIdByAttribute,
  goHome,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

describe('project editing', () => {
  it('saves a renamed project and retains it after navigation', async () => {
    const projectId = await createProjectThroughUi(E2E_FIXTURES.projectEdit.originalTitle);
    const beforeCommit = await bridgeCall<{ rowCount: number; title?: string; updatedAt?: string }>(
      'get_e2e_novel_commit_state',
      { novelId: projectId },
    );
    expect(beforeCommit.rowCount).toBe(1);
    expect(beforeCommit.title).toBe(E2E_FIXTURES.projectEdit.originalTitle);
    expect(beforeCommit.updatedAt).toBeTruthy();
    await clickTestId('project-edit');
    const newTitle = E2E_FIXTURES.projectEdit.updatedTitle;
    await fillTestId('project-name-input', newTitle);
    const saveButton = await waitForTestId('project-save');
    expect(await saveButton.isEnabled()).toBe(true);

    const saveStartedAt = Date.now();
    await saveButton.click();
    await waitForTestId('success-notice');
    await waitForTestIdAttribute('project-settings', 'data-project-name', newTitle, 10000);
    expect(Date.now() - saveStartedAt).toBeLessThan(10000);

    const settings = await waitForTestId('project-settings');
    expect(await settings.getAttribute('data-project-id')).toBe(projectId);
    expect(await settings.getAttribute('data-saving')).toBe('false');
    expect(await settings.getAttribute('data-editing')).toBe('false');
    await waitForTestIdMissing('project-save');

    const editButton = await waitForTestId('project-edit');
    expect(await editButton.isEnabled()).toBe(true);
    await editButton.click();
    expect(await (await waitForTestId('project-save')).isEnabled()).toBe(true);

    await browser.refresh();
    await waitForTestId('app-shell');
    await waitForTestIdAttribute('project-settings', 'data-project-name', newTitle);
    const saved = await bridgeCall<{ id: string; title: string } | null>('get_novel_by_id', { id: projectId });
    expect(saved?.title).toBe(newTitle);

    const projects = await bridgeCall<Array<{ id: string; title: string }>>('get_all_novels');
    expect(projects.filter((project) => project.id === projectId)).toHaveLength(1);
    expect(projects.find((project) => project.id === projectId)?.title).toBe(newTitle);

    const committed = await bridgeCall<{ rowCount: number; title?: string; updatedAt?: string }>(
      'get_e2e_novel_commit_state',
      { novelId: projectId },
    );
    expect(committed.rowCount).toBe(1);
    expect(committed.title).toBe(newTitle);
    expect(committed.updatedAt).toBeTruthy();
    expect(committed.updatedAt).not.toBe(beforeCommit.updatedAt);

    await goHome();
    const projectCard = await findTestIdByAttribute('project-card', 'data-project-id', projectId);
    expect(await projectCard.getAttribute('data-project-name')).toBe(newTitle);
  });
});
