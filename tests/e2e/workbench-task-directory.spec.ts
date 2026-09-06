import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  clickTestId,
  createProjectThroughUi,
  navigateHash,
  waitForTestId,
  waitForTestIdMissing,
} from './helpers';

describe('persisted workbench task directory', () => {
  it('reaches and restores a task beyond the first 100 rows using the production UI and SQLite', async () => {
    await createProjectThroughUi('E2E Directory Pagination');
    await navigateHash('#/');
    let oldestId = '';
    for (let index = 0; index < 101; index += 1) {
      await clickTestId('workbench-create-task');
      const creator = await waitForTestId('workbench-task-creator');
      // Local greeting creates real conversation facts without invoking a Provider.
      await (await creator.$('textarea')).setValue('你好');
      await clickTestId('workbench-create-and-start');
      await waitForTestIdMissing('workbench-task-creator');
      await browser.waitUntil(async () => {
        const input = await waitForTestId('workbench-composer-input');
        const state = await (
          await browser.$('.workbench-composer')
        ).getAttribute('data-composer-state');
        return (await input.isEnabled()) && state === 'idle';
      });
      if (index === 0) {
        oldestId = await (
          await browser.$('[data-testid="workbench-task"][data-selected="true"]')
        ).getAttribute('data-conversation-id');
        const trigger = await browser.$('.workbench-task-entry .workbench-task-menu-trigger');
        await trigger.click();
        await (await browser.$('[role="menuitem"]')).click();
        await (await browser.$('input[aria-label="任务标题"]')).setValue('最早的目录任务');
        await (await browser.$('button[aria-label="保存任务标题"]')).click();
        await browser.waitUntil(
          async () => !(await (await browser.$('input[aria-label="任务标题"]')).isExisting()),
        );
      }
    }
    expect(oldestId).not.toBe('');
    await clickTestId('workbench-load-more-tasks');
    const selector = `[data-testid="workbench-task"][data-conversation-id="${oldestId}"]`;
    await browser.waitUntil(async () => (await browser.$(selector)).isExisting());
    const search = await browser.$('input[aria-label="搜索创作任务"]');
    await search.setValue('最早的目录任务');
    await browser.waitUntil(
      async () => (await browser.$$('[data-testid="workbench-task"]')).length === 1,
    );
    await (await browser.$(selector)).click();
    await browser.reloadSession();
    await waitForTestId('creative-workbench');
    await browser.waitUntil(async () =>
      (await browser.$(selector)).getAttribute('data-selected').then((value) => value === 'true'),
    );
    await assertCleanDiagnostics();
  });
});
