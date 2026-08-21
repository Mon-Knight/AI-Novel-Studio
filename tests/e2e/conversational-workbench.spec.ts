import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  clickTestId,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

const FAILED_GOAL = '生成下一章候选，并明确报告当前 DSH 载体不可用。';

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

async function waitForFailedRunCount(expected: number): Promise<void> {
  await browser.waitUntil(
    async () => {
      const statuses = await testIdAttributes('workbench-run', 'data-status');
      return statuses.length === expected && statuses.every((status) => status === 'failed');
    },
    {
      timeout: 60000,
      timeoutMsg: `Workbench did not persist ${expected} failed run(s)`,
    },
  );
}

describe('conversational creative workbench', () => {
  it('keeps legacy routes and persists explicit DSH failures without a silent fallback', async () => {
    await waitForTestId('workbench-no-projects');
    expect(['', '#/']).toContain(await browser.execute(() => window.location.hash));
    expect(await (await waitForTestId('workbench-no-projects')).getText()).toContain(
      '还没有小说项目',
    );

    await clickTestId('workbench-open-novels');
    await waitForTestId('project-list');
    expect(await browser.execute(() => window.location.hash)).toBe('#/novels');

    const projectId = await createProjectThroughUi('E2E Conversational Workbench');
    const projectSettings = await waitForTestIdAttribute(
      'project-settings',
      'data-project-id',
      projectId,
    );
    expect(await projectSettings.getAttribute('data-project-name')).toBe(
      'E2E Conversational Workbench',
    );

    await openWorkspace(projectId);
    const chapterId = await createFirstChapterThroughUi();
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    expect(await browser.execute(() => window.location.hash)).toBe(
      `#/novels/${projectId}/workspace`,
    );

    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await findTestIdByAttribute('workbench-project', 'data-novel-id', projectId);

    await clickTestId('workbench-create-task');
    const taskHeader = await waitForTestId('workbench-task-header');
    const conversationId = await taskHeader.getAttribute('data-conversation-id');
    expect(conversationId).toBeTruthy();
    const selectedTask = await findTestIdByAttribute(
      'workbench-task',
      'data-conversation-id',
      conversationId!,
    );
    expect(await selectedTask.getAttribute('data-selected')).toBe('true');
    expect(await selectedTask.getAttribute('data-status')).toBe('idle');

    await clickTestId('workbench-create-task');
    const secondHeader = await waitForTestId('workbench-task-header');
    const secondConversationId = await secondHeader.getAttribute('data-conversation-id');
    expect(secondConversationId).toBeTruthy();
    expect(secondConversationId).not.toBe(conversationId);
    expect(await testIdCount('workbench-task')).toBeGreaterThanOrEqual(2);
    const firstTask = await findTestIdByAttribute(
      'workbench-task',
      'data-conversation-id',
      conversationId!,
    );
    await firstTask.click();
    const restoredHeader = await waitForTestId('workbench-task-header');
    expect(await restoredHeader.getAttribute('data-conversation-id')).toBe(conversationId);

    const modelSelect = await waitForTestId('workbench-model-select');
    expect(await modelSelect.getValue()).toBe('mock:Mock');
    await waitForTestId('workbench-task-templates');
    await waitForTestId('workbench-template-generate-chapter');
    await waitForTestId('workbench-template-audit-chapter');
    const chapterTarget = await waitForTestId('workbench-chapter-target');
    expect(await chapterTarget.getText()).toMatch(/章节目标|未绑定章节/);

    await clickTestId('workbench-current-plugins');
    const pluginPanel = await waitForTestId('workbench-plugin-panel');
    for (const category of ['function', 'model', 'other']) {
      await findTestIdByAttribute('workbench-plugin-group', 'data-category', category);
    }
    const functionRows = await browser.$$(
      ['[data-testid="workbench-plugin-row"]', '[data-category="function"]'].join(''),
    );
    const functionProjection = (await Promise.all(functionRows.map((row) => row.getText()))).join(
      '\n',
    );
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
    expect(pluginText).toContain('只读显示');
    expect(pluginText).toContain('不提供安装、启停、配置或市场操作');
    for (const forbidden of ['安装插件', '卸载插件', '启用插件', '禁用插件', '更新插件']) {
      expect(pluginText).not.toContain(forbidden);
    }
    await clickTestId('workbench-plugin-close');
    await waitForTestIdMissing('workbench-plugin-panel');

    await fillTestId('workbench-composer-input', FAILED_GOAL);
    const sendButton = await waitForTestId('workbench-send-task');
    await sendButton.waitForEnabled({ timeout: 30000 });
    await sendButton.click();

    await waitForTestIdAttribute('workbench-conversation-status', 'data-status', 'failed', 60000);
    await waitForFailedRunCount(1);
    const firstError = await waitForTestId('workbench-run-error');
    expect(await firstError.getText()).toMatch(
      /(DSH|载体|运行时|VERSION_MATRIX|Provider API Key|API Key)/i,
    );
    expect(await (await waitForTestId('workbench-composer-error')).getText()).toMatch(
      /(DSH|载体|运行时|VERSION_MATRIX|Provider API Key|API Key)/i,
    );
    expect(await selectedTask.getAttribute('data-status')).toBe('failed');
    expect(await testIdCount('workbench-artifact-card')).toBe(0);
    expect(await testIdCount('workbench-tool-event')).toBe(0);
    const failureTurns = await browser.$$('[data-testid="workbench-turn"][data-role="assistant"]');
    expect(failureTurns).toHaveLength(1);
    expect(await failureTurns[0].getText()).toContain('任务运行失败');
    await waitForTestIdMissing('workbench-stop-task');

    const firstRunIds = await testIdAttributes('workbench-run', 'data-run-id');
    const firstWorkerIds = await testIdAttributes('workbench-run', 'data-worker-id');
    expect(firstRunIds).toHaveLength(1);
    expect(firstWorkerIds).toHaveLength(1);
    expect(firstRunIds[0]).toBeTruthy();
    expect(firstWorkerIds[0]).toBeTruthy();

    await clickTestId('workbench-retry-turn');
    await waitForFailedRunCount(2);
    const retriedRunIds = await testIdAttributes('workbench-run', 'data-run-id');
    expect(new Set(retriedRunIds).size).toBe(2);
    expect(retriedRunIds).toContain(firstRunIds[0]);
    expect(await testIdCount('workbench-run-error')).toBe(2);
    expect(await browser.$$('[data-testid="workbench-turn"][data-role="user"]')).toHaveLength(2);
    expect(await browser.$$('[data-testid="workbench-turn"][data-role="assistant"]')).toHaveLength(
      2,
    );
    expect(await testIdCount('workbench-artifact-card')).toBe(0);

    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    await navigateHash('#/');
    const restoredHeader = await waitForTestId('workbench-task-header');
    expect(await restoredHeader.getAttribute('data-conversation-id')).toBe(conversationId);
    await waitForTestIdAttribute('workbench-conversation-status', 'data-status', 'failed');
    await waitForFailedRunCount(2);
    expect(new Set(await testIdAttributes('workbench-run', 'data-run-id'))).toEqual(
      new Set(retriedRunIds),
    );
    expect(await testIdCount('workbench-run-error')).toBe(2);
    expect(await testIdCount('workbench-artifact-card')).toBe(0);
    expect(await browser.$$('[data-testid="workbench-turn"][data-role="user"]')).toHaveLength(2);
    expect(await browser.$$('[data-testid="workbench-turn"][data-role="assistant"]')).toHaveLength(
      2,
    );
    const restoredTask = await findTestIdByAttribute(
      'workbench-task',
      'data-conversation-id',
      conversationId!,
    );
    expect(await restoredTask.getAttribute('data-status')).toBe('failed');
    await assertCleanDiagnostics();
  });
});
