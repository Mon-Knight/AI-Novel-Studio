import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  clickTestId,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

async function testIdCount(testId: string): Promise<number> {
  const elements = await browser.$$(`[data-testid="${testId}"]`);
  let count = 0;
  for (const element of elements) {
    if (await element.isDisplayed()) count += 1;
  }
  return count;
}

async function testIdAttributes(testId: string, attribute: string): Promise<string[]> {
  const elements = await browser.$$(`[data-testid="${testId}"]`);
  const values: string[] = [];
  for (const element of elements) {
    if (!(await element.isDisplayed())) continue;
    const value = await element.getAttribute(attribute);
    if (value) values.push(value);
  }
  return values;
}

describe('conversational creative workbench', () => {
  it('keeps legacy routes and blocks empty tasks when the Runtime model is unavailable', async () => {
    await waitForTestId('workbench-no-projects');
    expect(['', '#/']).toContain(await browser.execute(() => window.location.hash));

    await clickTestId('workbench-open-novels');
    await waitForTestId('project-list');
    const projectId = await createProjectThroughUi('E2E Conversational Workbench');

    await openWorkspace(projectId);
    const chapterId = await createFirstChapterThroughUi();
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);

    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    const project = await findTestIdByAttribute('workbench-project', 'data-novel-id', projectId);
    expect(await project.getAttribute('data-selected')).toBe('true');
    await waitForTestId('workbench-create-empty-task');
    expect(await testIdCount('workbench-task')).toBe(0);

    await clickTestId('workbench-create-task');
    const creator = await waitForTestId('workbench-task-creator');
    const goal = await creator.$('textarea');
    await goal.setValue('读取当前小说上下文，并核对本章的推进条件。');
    expect(await goal.getValue()).toContain('核对本章');

    const model = await waitForTestId('workbench-new-task-model-select');
    expect(await model.getValue()).toBe('mock:Mock');
    const modelStatus = await waitForTestId('workbench-new-task-model-status');
    expect(await modelStatus.getText()).toMatch(/Runtime|模型目录|所选模型/);
    const createAndStart = await waitForTestId('workbench-create-and-start');
    expect(await createAndStart.isEnabled()).toBe(false);
    expect(await testIdCount('workbench-task')).toBe(0);

    const closeCreator = await creator.$('button[aria-label="关闭新建任务"]');
    await closeCreator.click();
    await waitForTestIdMissing('workbench-task-creator');
    await waitForTestId('workbench-create-empty-task');

    await clickTestId('workbench-current-plugins');
    const pluginPanel = await waitForTestId('workbench-plugin-panel');
    for (const category of ['function', 'model', 'other']) {
      await findTestIdByAttribute('workbench-plugin-group', 'data-category', category);
    }
    const functionRows = await browser.$$(
      '[data-testid="workbench-plugin-row"][data-category="function"]',
    );
    const functionTexts: string[] = [];
    for (const row of functionRows) functionTexts.push(await row.getText());
    const functionProjection = functionTexts.join('\n');
    for (const tool of [
      'novel.read_context',
      'chapter.read_outline',
      'search_memory',
      'generate_chapter',
      'generate_outline',
      'generate_characters',
      'suggest_events',
      'expand_settings',
      'polish_chapter',
      'check_quality',
      'summarize_chapter',
    ]) {
      expect(functionProjection).toContain(tool);
    }
    const pluginStatuses = await testIdAttributes('workbench-plugin-row', 'data-status');
    expect(pluginStatuses.length).toBeGreaterThan(0);
    expect(
      pluginStatuses.every((status) => ['loaded', 'failed', 'unavailable'].includes(status)),
    ).toBe(true);
    const pluginButtons = await pluginPanel.$$('button');
    expect(pluginButtons).toHaveLength(1);
    expect(await pluginButtons[0].getAttribute('aria-label')).toBe('关闭当前插件');
    const pluginText = await pluginPanel.getText();
    for (const forbidden of ['安装插件', '卸载插件', '启用插件', '禁用插件', '更新插件']) {
      expect(pluginText).not.toContain(forbidden);
    }
    await clickTestId('workbench-plugin-close');
    await waitForTestIdMissing('workbench-plugin-panel');

    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    await navigateHash('#/');
    const restoredProject = await findTestIdByAttribute(
      'workbench-project',
      'data-novel-id',
      projectId,
    );
    expect(await restoredProject.getAttribute('data-selected')).toBe('true');
    await waitForTestId('workbench-create-empty-task');
    expect(await testIdCount('workbench-task')).toBe(0);
    await assertCleanDiagnostics();
  });
});
