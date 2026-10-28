import fs from 'node:fs';
import path from 'node:path';
import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';
import { requestViewportWidth } from './interaction-world-rules-fixture';

const screenshotDirectory = path.resolve(
  import.meta.dirname,
  '../../test-results/ui-detail-refinement',
);

async function waitForComposerIdle(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const composer = await browser.$('.workbench-composer');
      const input = await browser.$('[data-testid="workbench-composer-input"]');
      return (
        (await composer.getAttribute('data-composer-state')) === 'idle' &&
        (await input.isExisting()) &&
        (await input.isEnabled())
      );
    },
    { timeout: 30000, timeoutMsg: 'Composer did not return to idle after task creation' },
  );
}

async function createGreetingTask(goal: string): Promise<string> {
  await clickTestId('workbench-create-task');
  await waitForTestId('workbench-task-creator');
  await fillTestId('workbench-new-task-goal', goal);
  const create = await waitForTestId('workbench-create-and-start');
  await create.waitForEnabled({ timeout: 30000 });
  await create.click();
  await waitForTestIdMissing('workbench-task-creator');
  await waitForComposerIdle();
  const selected = await waitForTestIdAttribute('workbench-task', 'data-selected', 'true');
  const conversationId = await selected.getAttribute('data-conversation-id');
  if (!conversationId) throw new Error('Created task did not expose a conversation id');
  return conversationId;
}

async function renameSelectedTask(title: string): Promise<void> {
  const selectedRow = await waitForTestIdAttribute('workbench-task', 'data-selected', 'true');
  const selectedConversationId = await selectedRow.getAttribute('data-conversation-id');
  if (!selectedConversationId) throw new Error('Selected task has no conversation id');
  await browser.execute((conversationId) => {
    const row = document.querySelector<HTMLElement>(
      `[data-testid="workbench-task"][data-conversation-id="${conversationId}"]`,
    );
    const trigger = row?.parentElement?.querySelector<HTMLButtonElement>(
      '.workbench-task-menu-trigger',
    );
    if (!trigger) throw new Error('Task menu trigger is unavailable');
    trigger.click();
  }, selectedConversationId);
  const rename = await browser.$('[role="menuitem"]');
  await rename.waitForClickable({ timeout: 30000 });
  await rename.click();
  const input = await browser.$('input[aria-label="任务标题"]');
  await input.waitForDisplayed({ timeout: 30000 });
  await input.setValue(title);
  await (await browser.$('button[aria-label="保存任务标题"]')).click();
  await browser.waitUntil(
    async () => !(await (await browser.$('input[aria-label="任务标题"]')).isExisting()),
    { timeout: 30000, timeoutMsg: 'Task rename did not commit' },
  );
  const selected = await browser.$('[data-testid="workbench-task"][data-selected="true"]');
  expect(await selected.getAttribute('aria-label')).toContain(title);
}

async function captureAt(width: number, height: number): Promise<void> {
  const viewport = await requestViewportWidth(width, height);
  const neutral = await browser.$('.workbench-task-header');
  if (await neutral.isExisting()) {
    await neutral.moveTo();
    await browser.pause(180);
  }
  await browser.pause(300);
  if (viewport.innerWidth <= 0 || viewport.innerHeight <= 0) {
    throw new Error('Tauri viewport did not report a usable size.');
  }
  const metrics = await browser.execute(() => {
    const read = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    };
    const selectedTask = document.querySelector<HTMLElement>(
      '[data-testid="workbench-task"][data-selected="true"]',
    );
    const selectedTaskTitle = selectedTask?.querySelector<HTMLElement>('.workbench-task-title');
    const selectedTaskTime = selectedTask?.querySelector<HTMLElement>('time');
    const ordinaryTask = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="workbench-task"]'),
    ).find((node) => node.getAttribute('data-selected') !== 'true');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      heading: read('.workbench-project-heading.is-current'),
      project: read('[data-testid="workbench-project"][data-selected="true"]'),
      task: read('[data-testid="workbench-task"][data-selected="true"]'),
      taskTitle: read('[data-testid="workbench-task"][data-selected="true"] .workbench-task-title'),
      taskTime: read('[data-testid="workbench-task"][data-selected="true"] time'),
      taskTitleFullText: selectedTask?.getAttribute('aria-label') ?? '',
      taskTitleEllipsized: selectedTaskTitle
        ? selectedTaskTitle.scrollWidth > selectedTaskTitle.clientWidth
        : false,
      taskTimeInline: Boolean(
        selectedTask &&
        selectedTaskTime &&
        selectedTaskTime.getBoundingClientRect().top >= selectedTask.getBoundingClientRect().top &&
        selectedTaskTime.getBoundingClientRect().bottom <=
          selectedTask.getBoundingClientRect().bottom,
      ),
      taskHeight: selectedTask?.getBoundingClientRect().height ?? 0,
      ordinaryTaskHeight: ordinaryTask?.getBoundingClientRect().height ?? 0,
      ordinaryTaskTitleWidth:
        ordinaryTask?.querySelector<HTMLElement>('.workbench-task-title')?.getBoundingClientRect()
          .width ?? 0,
      ordinaryTaskTime: Boolean(ordinaryTask?.querySelector('time')),
      composerInput: read('[data-testid="workbench-composer-input"]'),
      goalBrief: read('[data-testid="workbench-word-preview"]'),
      surface: read('.workbench-composer-surface'),
    };
  });
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(screenshotDirectory, `tauri-${width}x${height}.json`),
    JSON.stringify({ viewport, metrics }, null, 2),
  );
  await browser.saveScreenshot(path.join(screenshotDirectory, `tauri-${width}x${height}.png`));
  return;
}

describe('workbench UI detail refinement', () => {
  it('keeps long tree rows, selected state and composer guidance aligned in real Tauri', async () => {
    await waitForTestId('app-shell');
    await waitForTestId('workbench-no-projects');

    const chineseTitle = '雾港纪事：潮汐、旧信与一场没有回声的审判';
    const englishTitle = 'The Cartographer of Forgotten Harbors and the Last Unwritten Letter';
    const mixedTaskTitle = 'Luna 计划：核对中英文混排标题在窄侧栏中的省略号与完整名称';
    const firstProjectId = await createProjectThroughUi(chineseTitle);
    await openWorkspace(firstProjectId);
    const volumeId = await createVolumeThroughUi('第一卷');
    const chapterId = await createChapterThroughUi('第一章：雾港来信', volumeId);

    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (
      await findTestIdByAttribute('workbench-project', 'data-novel-id', firstProjectId)
    ).click();

    const firstTaskId = await createGreetingTask('你好');
    await renameSelectedTask('推进雾港冲突与人物动机，并保留所有已经确认的线索与伏笔');
    const secondTaskId = await createGreetingTask('你好');
    await renameSelectedTask('Reconstruct the harbor conspiracy without losing the voice');
    const thirdTaskId = await createGreetingTask('你好');
    await renameSelectedTask(mixedTaskTitle);
    expect(new Set([firstTaskId, secondTaskId, thirdTaskId]).size).toBe(3);

    await createProjectThroughUi(englishTitle);
    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (
      await findTestIdByAttribute('workbench-project', 'data-novel-id', firstProjectId)
    ).click();
    const firstTask = await findTestIdByAttribute(
      'workbench-task',
      'data-conversation-id',
      firstTaskId,
    );
    await firstTask.click();
    await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', firstTaskId);

    const chapterSelect = await waitForTestId('workbench-chapter-select');
    await chapterSelect.selectByAttribute('value', chapterId);
    await fillTestId(
      'workbench-composer-input',
      '根据当前章节目标推进雾港来信，保留人物动机与已确认线索。',
    );
    await waitForTestId('workbench-word-preview');

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 700 },
    ]) {
      await captureAt(viewport.width, viewport.height);
      const metrics = JSON.parse(
        fs.readFileSync(
          path.join(screenshotDirectory, `tauri-${viewport.width}x${viewport.height}.json`),
          'utf8',
        ),
      ) as {
        metrics: {
          documentWidth: number;
          heading: { left: number; width: number } | null;
          project: { left: number; width: number } | null;
          task: { left: number } | null;
          taskTitle: { width: number } | null;
          taskTitleEllipsized: boolean;
          taskTitleFullText: string;
          taskTimeInline: boolean;
          taskHeight: number;
          ordinaryTaskHeight: number;
          ordinaryTaskTitleWidth: number;
          ordinaryTaskTime: boolean;
          composerInput: { left: number; paddingLeft: string } | null;
          goalBrief: { left: number } | null;
        };
      };
      const { metrics: layout } = metrics;
      expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(layout.heading).not.toBeNull();
      expect(layout.project).not.toBeNull();
      expect(layout.task).not.toBeNull();
      expect(layout.taskTitle).not.toBeNull();
      expect(layout.goalBrief).not.toBeNull();
      if (
        !layout.heading ||
        !layout.project ||
        !layout.task ||
        !layout.taskTitle ||
        !layout.composerInput ||
        !layout.goalBrief
      ) {
        throw new Error('Required workbench geometry is missing');
      }
      expect(Math.abs(layout.project.left - layout.task.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.project.width - layout.heading.width)).toBeLessThanOrEqual(1);
      expect(layout.taskTitle.width).toBeGreaterThan(60);
      expect(layout.ordinaryTaskTitleWidth).toBeGreaterThan(120);
      expect(layout.taskTimeInline).toBe(true);
      expect(layout.taskHeight).toBeLessThanOrEqual(37);
      expect(Math.abs(layout.taskHeight - layout.ordinaryTaskHeight)).toBeLessThanOrEqual(1);
      expect(layout.ordinaryTaskTime).toBe(false);
      if (layout.taskTitleEllipsized) expect(layout.taskTitleFullText).toContain('推进雾港冲突');
      const inputContentLeft =
        layout.composerInput.left + Number.parseFloat(layout.composerInput.paddingLeft);
      expect(Math.abs(layout.goalBrief.left - inputContentLeft)).toBeLessThanOrEqual(1);
    }

    await browser.execute((conversationId) => {
      document
        .querySelector<HTMLElement>(
          `[data-testid="workbench-task"][data-conversation-id="${conversationId}"]`,
        )
        ?.focus();
    }, secondTaskId);
    await browser.pause(300);
    const tooltip = await browser.$('[data-testid="ui-tooltip"]');
    await tooltip.waitForDisplayed({ timeout: 5000 });
    const tooltipLayout = await browser.execute(() => {
      const tip = document.querySelector<HTMLElement>('[data-testid="ui-tooltip"]');
      const tree = document.querySelector<HTMLElement>('.workbench-tree');
      if (!tip || !tree) return null;
      const tipRect = tip.getBoundingClientRect();
      const treeRect = tree.getBoundingClientRect();
      const overlapsTaskRows = Array.from(
        document.querySelectorAll<HTMLElement>('.workbench-task-entry'),
      ).some((row) => {
        const rowRect = row.getBoundingClientRect();
        return (
          tipRect.left < rowRect.right &&
          tipRect.right > rowRect.left &&
          tipRect.top < rowRect.bottom &&
          tipRect.bottom > rowRect.top
        );
      });
      return {
        left: tipRect.left,
        treeRight: treeRect.right,
        overlapsTaskRows,
        text: tip.textContent ?? '',
      };
    });
    expect(tooltipLayout).not.toBeNull();
    expect(tooltipLayout!.left).toBeGreaterThanOrEqual(tooltipLayout!.treeRight);
    expect(tooltipLayout!.overlapsTaskRows).toBe(false);
    expect(tooltipLayout!.text).toContain('Reconstruct the harbor conspiracy');
    expect(tooltipLayout!.text).toContain('更新于');
    await browser.saveScreenshot(
      path.join(screenshotDirectory, 'tauri-tooltip-focus-1024x700.png'),
    );

    await assertCleanDiagnostics();
  });
});
