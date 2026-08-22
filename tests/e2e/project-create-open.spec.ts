import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  bridgeCall,
  bridgeDiagnostics,
  createProjectThroughUi,
  findTestIdByAttribute,
  goHome,
  openProjectFromList,
  waitForTestId,
} from './helpers';

describe('project creation and opening', () => {
  it('creates one project, persists it, and opens its detail page', async () => {
    const title = E2E_FIXTURES.projectCreate.title;
    const projectId = await createProjectThroughUi(title);
    const settings = await waitForTestId('project-settings');
    expect(await settings.getAttribute('data-project-id')).toBe(projectId);
    expect(await settings.getAttribute('data-project-name')).toBe(title);
    expect(await browser.getUrl()).toContain(`#/novels/${projectId}`);

    const projects = await bridgeCall<Array<{ id: string; title: string }>>('get_all_novels');
    expect(
      projects.filter((project) => project.id === projectId && project.title === title),
    ).toHaveLength(1);
    expect((await bridgeDiagnostics()).counts?.novels).toBe(1);

    await goHome();
    const listEntry = await findTestIdByAttribute('project-open', 'data-project-id', projectId);
    expect(await listEntry.getAttribute('data-project-name')).toBe(title);
    await openProjectFromList(projectId);

    const reopenedSettings = await waitForTestId('project-settings');
    expect(await reopenedSettings.getAttribute('data-project-id')).toBe(projectId);
    expect(await reopenedSettings.getAttribute('data-project-name')).toBe(title);
    expect(await browser.getUrl()).toContain(`#/novels/${projectId}`);

    await goHome();
    const keyboardEntry = await findTestIdByAttribute('project-open', 'data-project-id', projectId);
    await keyboardEntry.scrollIntoView();
    await browser.execute((id) => {
      const target = [
        ...document.querySelectorAll<HTMLElement>('[data-testid="project-open"]'),
      ].find((element) => element.dataset.projectId === id);
      if (!target) throw new Error(`project-open ${id} was not found`);
      target.focus();
    }, projectId);
    expect(
      await browser.execute(
        () => (document.activeElement as HTMLElement | null)?.dataset.projectId,
      ),
    ).toBe(projectId);
    await browser.keys('Enter');
    await waitForTestId('project-settings');
    expect(await browser.execute(() => window.location.hash)).toBe(`#/novels/${projectId}`);
  });
});
