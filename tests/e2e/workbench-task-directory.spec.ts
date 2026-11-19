import { browser, expect } from '@wdio/globals';
import { randomUUID } from 'node:crypto';
import type { CompleteProjectBackup } from '../../src/services/backup/projectBackupSchema';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createProjectThroughUi,
  findTestIdByAttribute,
  navigateHash,
  waitForTestId,
  waitForTestIdMissing,
} from './helpers';

const oldestTitle = '最早的目录任务';
const exportBackup = (novelId: string) =>
  bridgeCall<CompleteProjectBackup>('export_project_backup', { novelId });

/** Import a new test project with the real named task and 100 otherwise empty directory rows.
 * Bulk setup goes through validated native backup restore; it starts no extra model runs. */
async function restoreDirectoryFixture(sourceNovelId: string, sourceTaskId: string) {
  const backup = await exportBackup(sourceNovelId);
  expect(backup.tables.task_conversations).toHaveLength(1);
  const named = backup.tables.task_conversations[0];
  expect(named).toMatchObject({ conversation_id: sourceTaskId, title: oldestTitle });
  for (const table of [
    'chapter_drafts',
    'result_artifacts',
    'task_authorizations',
    'review_authorizations',
  ]) {
    expect(backup.tables[table]).toHaveLength(0);
  }
  const base = Date.parse(String(named.updated_at));
  for (let index = 1; index <= 100; index++) {
    const stamp = new Date(base + index * 1000).toISOString();
    backup.tables.task_conversations.push({
      scope_type: 'novel',
      conversation_id: randomUUID(),
      novel_id: sourceNovelId,
      title: `目录夹具 ${index}`,
      status: 'idle',
      created_at: stamp,
      updated_at: stamp,
    });
  }
  const before = await bridgeCall<Array<{ id: string }>>('get_all_novels');
  await navigateHash('#/import-export');
  await clickTestId('project-import-tab');
  await clickTestId('project-import-json');
  await waitForTestId('project-import-dialog');
  await browser.execute((json) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-file"]');
    if (!input) throw new Error('Project backup input is missing');
    const transfer = new DataTransfer();
    transfer.items.add(new File([json], 'directory-fixture.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, JSON.stringify(backup));
  const confirm = await waitForTestId('project-import-confirm');
  await confirm.waitForEnabled();
  await confirm.click();
  await waitForTestId('project-import-result');
  // Restore commits before its progress overlay and import dialog finish. Let the
  // normal success flow return to the workbench before clicking the project tree.
  await waitForTestIdMissing('project-import-dialog');
  await waitForTestIdMissing('loading-modal-dismiss');
  await waitForTestId('creative-workbench');
  const added = (await bridgeCall<Array<{ id: string }>>('get_all_novels')).filter(
    (novel) => !before.some((old) => old.id === novel.id),
  );
  expect(added).toHaveLength(1);
  const copyNovelId = added[0].id;
  const copied = (await exportBackup(copyNovelId)).tables.task_conversations;
  expect(copied).toHaveLength(101);
  expect(copied.every((row) => row.novel_id === copyNovelId)).toBe(true);
  const matches = copied.filter((row) => row.title === oldestTitle);
  expect(matches).toHaveLength(1);
  const oldestId = matches[0].conversation_id;
  if (typeof oldestId !== 'string' || !oldestId || oldestId === sourceTaskId)
    throw new Error('The restored task must have its own identity');
  expect((await exportBackup(sourceNovelId)).tables.task_conversations).toEqual([named]);
  return { copyNovelId, oldestId };
}

describe('persisted workbench task directory', function () {
  this.timeout(480_000);
  it('reaches and restores a task beyond the first 100 rows using the production UI and SQLite', async function () {
    this.timeout(480_000);
    const sourceNovelId = await createProjectThroughUi('E2E Directory Pagination');
    await navigateHash('#/');
    await clickTestId('workbench-create-task');
    const creator = await waitForTestId('workbench-task-creator');
    // Exercise one real creation. Populating the other 100 rows needs no generated turns.
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
    const sourceTaskId = await (
      await browser.$('[data-testid="workbench-task"][data-selected="true"]')
    ).getAttribute('data-conversation-id');
    const trigger = await browser.$('.workbench-task-entry .workbench-task-menu-trigger');
    await trigger.click();
    await (await browser.$('[role="menuitem"]')).click();
    await (await browser.$('input[aria-label="任务标题"]')).setValue(oldestTitle);
    await (await browser.$('button[aria-label="保存任务标题"]')).click();
    await browser.waitUntil(
      async () => !(await (await browser.$('input[aria-label="任务标题"]')).isExisting()),
    );
    const { copyNovelId, oldestId } = await restoreDirectoryFixture(sourceNovelId, sourceTaskId);
    const project = await findTestIdByAttribute('workbench-project', 'data-novel-id', copyNovelId);
    await project.click();
    const selector = `[data-testid="workbench-task"][data-conversation-id="${oldestId}"]`;
    await waitForTestId('workbench-load-more-tasks');
    expect(await (await browser.$(selector)).isExisting()).toBe(false);
    await clickTestId('workbench-load-more-tasks');
    await browser.waitUntil(async () => (await browser.$(selector)).isExisting());
    const search = await browser.$('input[aria-label="搜索创作任务"]');
    await search.setValue(oldestTitle);
    // Global search can also find the original project. Only the restored project's
    // exact task may satisfy selection and survive the restart.
    const copyTasks = `section.workbench-project:has([data-testid="workbench-project"][data-novel-id="${copyNovelId}"]) [data-testid="workbench-task"]`;
    await browser.waitUntil(async () => {
      const rows = await browser.$$(copyTasks);
      return rows.length === 1 && (await rows[0].getAttribute('data-conversation-id')) === oldestId;
    });
    await (await browser.$(selector)).click();
    await browser.reloadSession();
    await waitForTestId('creative-workbench');
    await browser.waitUntil(async () =>
      (await browser.$(selector)).getAttribute('data-selected').then((value) => value === 'true'),
    );
    await assertCleanDiagnostics();
  });
});
