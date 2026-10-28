import fs from 'node:fs';
import path from 'node:path';
import { $, browser } from '@wdio/globals';
import { setExactViewport } from '../../tests/browser/workbenchGeometry';

const outputDirectory = path.resolve(import.meta.dirname);
const phase = process.env.UI_REFINEMENT_PHASE === 'after' ? 'after' : 'baseline';

async function waitForWorkbench(): Promise<void> {
  await (await $('[data-testid="creative-workbench"]')).waitForDisplayed({ timeout: 60_000 });
  await (await $('#startup-splash')).waitForExist({ reverse: true, timeout: 60_000 });
  await (await $('[data-testid="workbench-tree-loading"]')).waitForExist({ reverse: true });
  await (await $('[data-testid="workbench-loading"]')).waitForExist({ reverse: true });
}

async function seedFixture(): Promise<void> {
  await browser.url('/#/');
  await browser.execute(() => window.localStorage.clear());
  await browser.refresh();
  await waitForWorkbench();

  await browser.execute(() => {
    const now = '2026-10-28T08:00:00.000Z';
    const model = {
      providerId: 'mock',
      modelId: 'Mock',
      runtimeMode: 'mock',
      capabilities: ['chat'],
      options: {},
      capturedAt: now,
    };
    const novelA = {
      id: 'ui-refine-novel-a',
      title: '雾港纪事：潮汐、旧信与一场没有回声的审判',
      genre: '悬疑',
      description: '用于侧栏长标题与父子层级验证。',
      status: 'writing',
      currentVolumeId: 'ui-refine-volume-a',
      currentChapterId: 'ui-refine-chapter-a',
      totalWords: 182000,
      targetWords: 800000,
      createdAt: now,
      updatedAt: now,
    };
    const novelB = {
      id: 'ui-refine-novel-b',
      title: 'The Cartographer of Forgotten Harbors and the Last Unwritten Letter',
      genre: 'Literary mystery',
      description: 'Long English title fixture.',
      status: 'planning',
      currentVolumeId: 'ui-refine-volume-b',
      currentChapterId: 'ui-refine-chapter-b',
      totalWords: 0,
      targetWords: 500000,
      createdAt: now,
      updatedAt: now,
    };
    const novelC = {
      id: 'ui-refine-novel-c',
      title: 'Project Luna：月球背面最后一封家书 Project Luna',
      genre: '科幻',
      description: 'Mixed title fixture.',
      status: 'planning',
      currentVolumeId: 'ui-refine-volume-c',
      currentChapterId: 'ui-refine-chapter-c',
      totalWords: 32000,
      targetWords: 300000,
      createdAt: now,
      updatedAt: now,
    };
    const chapter = (id: string, novelId: string, volumeId: string, title: string) => ({
      id,
      novelId,
      volumeId,
      title,
      chapterNumber: 1,
      orderIndex: 0,
      sortOrder: 0,
      status: 'outline_ready',
      wordCount: 0,
      currentWords: 0,
      targetWords: 3200,
      drafts: [],
      createdAt: now,
      updatedAt: now,
    });
    const conversation = (
      conversationId: string,
      novelId: string,
      title: string,
      updatedAt: string,
    ) => ({
      conversation: {
        conversationId,
        novelId,
        title,
        status: 'waiting_user',
        defaultModel: model,
        createdAt: now,
        updatedAt,
      },
      turns: [
        {
          turnId: `${conversationId}-turn`,
          conversationId,
          sequence: 0,
          role: 'user',
          content: '保留当前目标并检查章节上下文。',
          createdAt: now,
        },
      ],
      runs: [
        {
          runId: `${conversationId}-run`,
          turnId: `${conversationId}-turn`,
          conversationId,
          workerId: 'ui-refinement-fixture',
          status: 'completed',
          modelSnapshot: model,
          createdAt: now,
          updatedAt,
          startedAt: now,
          finishedAt: updatedAt,
        },
      ],
      toolEvents: [],
      artifacts: [],
      decisions: [],
      authorizations: [],
    });

    window.localStorage.setItem(
      'ai_novel_studio_novels',
      JSON.stringify([novelA, novelB, novelC]),
    );
    window.localStorage.setItem(
      'ai_novel_studio_volumes',
      JSON.stringify([
        {
          id: 'ui-refine-volume-a',
          novelId: novelA.id,
          title: '第一卷',
          volumeNumber: 1,
          orderIndex: 0,
          sortOrder: 0,
          status: 'writing',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'ui-refine-volume-b',
          novelId: novelB.id,
          title: 'Volume I',
          volumeNumber: 1,
          orderIndex: 0,
          sortOrder: 0,
          status: 'planned',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'ui-refine-volume-c',
          novelId: novelC.id,
          title: '第一卷',
          volumeNumber: 1,
          orderIndex: 0,
          sortOrder: 0,
          status: 'planned',
          createdAt: now,
          updatedAt: now,
        },
      ]),
    );
    window.localStorage.setItem(
      'ai_novel_studio_chapters',
      JSON.stringify([
        chapter(
          'ui-refine-chapter-a',
          novelA.id,
          'ui-refine-volume-a',
          '第一章：雾港来信',
        ),
        chapter(
          'ui-refine-chapter-b',
          novelB.id,
          'ui-refine-volume-b',
          'Chapter 1: The Unwritten Letter',
        ),
        chapter(
          'ui-refine-chapter-c',
          novelC.id,
          'ui-refine-volume-c',
          '第一章：月背来客',
        ),
      ]),
    );
    window.localStorage.setItem(
      'ai_novel_studio_task_conversations',
      JSON.stringify({
        bundles: [
          conversation(
            'ui-refine-task-a',
            novelA.id,
            '推进雾港冲突与人物动机，并保留所有已经确认的线索与伏笔',
            '2026-10-28T08:10:00.000Z',
          ),
          conversation(
            'ui-refine-task-b',
            novelA.id,
            'Reconstruct the harbor conspiracy without losing the established voice',
            '2026-10-27T08:10:00.000Z',
          ),
          conversation(
            'ui-refine-task-c',
            novelA.id,
            'Luna 计划：核对中英文混排标题在窄侧栏中的省略号与完整名称',
            '2026-10-26T08:10:00.000Z',
          ),
          conversation(
            'ui-refine-task-d',
            novelA.id,
            '短任务',
            '2026-10-25T08:10:00.000Z',
          ),
          conversation(
            'ui-refine-task-e',
            novelB.id,
            'Map the final chapter',
            '2026-10-24T08:10:00.000Z',
          ),
          conversation(
            'ui-refine-task-f',
            novelC.id,
            '月背来客',
            '2026-10-23T08:10:00.000Z',
          ),
        ],
      }),
    );
    window.localStorage.setItem(
      'ai_novel_studio_workbench_selection',
      JSON.stringify({
        version: 1,
        novelId: novelA.id,
        conversationId: 'ui-refine-task-a',
      }),
    );
    window.localStorage.setItem('ai_novel_studio_theme_preference', 'dark');
  });

  await browser.refresh();
  await waitForWorkbench();
  await (await $('[data-testid="workbench-task-header"]')).waitForDisplayed();
  await (await $('[data-testid="workbench-composer-input"]')).waitForDisplayed();
}

describe('UI detail refinement baseline', () => {
  before(() => {
    fs.mkdirSync(outputDirectory, { recursive: true });
  });

  for (const viewport of [
    { width: 1440, height: 900, name: '1440x900' },
    { width: 1024, height: 700, name: '1024x700' },
  ]) {
    it(`captures the current workbench at ${viewport.name}`, async () => {
      await seedFixture();
      await setExactViewport(viewport.width, viewport.height);
      await (await $('[data-testid="workbench-composer-input"]')).setValue(
        '根据当前章节目标推进雾港来信，保留人物动机与已确认线索。',
      );
      const neutral = await $('.workbench-task-header');
      if (await neutral.isExisting()) await neutral.moveTo();
      await browser.pause(250);
      const metrics = await browser.execute(() => {
        const rect = (selector: string) => {
          const node = document.querySelector<HTMLElement>(selector);
          if (!node) return null;
          const box = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
            paddingLeft: style.paddingLeft,
            paddingRight: style.paddingRight,
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
          };
        };
        const selectedProject = document.querySelector<HTMLElement>(
          '[data-testid="workbench-project"][data-selected="true"]',
        );
        const selectedTask = document.querySelector<HTMLElement>(
          '[data-testid="workbench-task"][data-selected="true"]',
        );
        const selectedTaskTitle = selectedTask?.querySelector<HTMLElement>('.workbench-task-title');
        const selectedTaskTime = selectedTask?.querySelector<HTMLElement>('time');
        const secondTask = document.querySelector<HTMLElement>(
          '[data-testid="workbench-task"][data-conversation-id="ui-refine-task-b"]',
        );
        const selectedProjectStyle = selectedProject
          ? window.getComputedStyle(selectedProject)
          : null;
        return {
          viewport: { width: innerWidth, height: innerHeight },
          projectHeading: rect('.workbench-project-heading'),
          selectedProject: rect('[data-testid="workbench-project"][data-selected="true"]'),
          selectedTask: rect('[data-testid="workbench-task"][data-selected="true"]'),
          selectedTaskTitle: rect(
            '[data-testid="workbench-task"][data-selected="true"] .workbench-task-title',
          ),
          selectedTaskTime: rect(
            '[data-testid="workbench-task"][data-selected="true"] time',
          ),
          projectTitleEllipsized: selectedProject
            ? selectedProject.scrollWidth > selectedProject.clientWidth
            : null,
          projectHeadingClass: selectedProject?.closest('.workbench-project-heading')?.className,
          projectBackground: selectedProjectStyle?.backgroundColor,
          projectBoxShadow: selectedProjectStyle?.boxShadow,
          taskTitleEllipsized: selectedTaskTitle
            ? selectedTaskTitle.scrollWidth > selectedTaskTitle.clientWidth
            : null,
          taskTitleFullText: selectedTask?.getAttribute('aria-label'),
          taskTimeText: selectedTaskTime?.textContent,
          selectedTaskHeight: selectedTask?.getBoundingClientRect().height ?? null,
          secondTask: rect(
            '[data-testid="workbench-task"][data-conversation-id="ui-refine-task-b"]',
          ),
          secondTaskTitle: rect(
            '[data-testid="workbench-task"][data-conversation-id="ui-refine-task-b"] .workbench-task-title',
          ),
          secondTaskTime: secondTask?.querySelector<HTMLElement>('time')?.textContent ?? null,
          composerSurface: rect('.workbench-composer-surface'),
          composerInput: rect('[data-testid="workbench-composer-input"]'),
          goalPreview: rect('[data-testid="workbench-word-preview"]'),
          modelStatus: rect('[data-testid="workbench-model-directory-status"]'),
          modelControl: rect('[data-testid="workbench-model-select"]'),
          toolbar: rect('.workbench-composer-toolbar'),
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      fs.writeFileSync(
        path.join(outputDirectory, `${phase}-${viewport.name}.json`),
        JSON.stringify(metrics, null, 2),
      );
      await browser.saveScreenshot(
        path.join(outputDirectory, `${phase}-${viewport.name}.png`),
      );
      if (phase === 'after') {
        if (!metrics.selectedProject || !metrics.selectedTask || !metrics.goalPreview) {
          throw new Error('Expected selected rows and a chapter goal brief.');
        }
        const inputContentLeft =
          metrics.composerInput.left + Number.parseFloat(metrics.composerInput.paddingLeft);
        if (Math.abs(metrics.goalPreview.left - inputContentLeft) > 1) {
          throw new Error('Goal brief is not aligned with the composer text gutter.');
        }
        if (Math.abs(metrics.selectedProject.left - metrics.selectedTask.left) > 1) {
          throw new Error('Project and task selected backgrounds do not share a left edge.');
        }
        if (metrics.selectedProject.width !== metrics.projectHeading.width) {
          throw new Error('Project selected background does not span the full heading row.');
        }
        if (!metrics.projectHeadingClass?.includes('is-current')) {
          throw new Error('Selected project heading is missing its structural current state.');
        }
        if (metrics.projectBackground !== 'rgba(0, 0, 0, 0)') {
          throw new Error('Selected project unexpectedly paints a group background.');
        }
        if (metrics.taskTitleEllipsized && !metrics.taskTitleFullText) {
          throw new Error('Truncated task title has no full-text disclosure.');
        }
        if (!metrics.secondTask || !metrics.secondTaskTitle) {
          throw new Error('Second task geometry is unavailable.');
        }
        if (Math.abs(metrics.secondTask.height - metrics.selectedTask.height) > 1) {
          throw new Error('Current and ordinary task rows no longer share one line height.');
        }
        if (metrics.secondTaskTime !== null) {
          throw new Error('A non-current task still renders its update time.');
        }
        if (metrics.secondTaskTitle.width <= metrics.selectedTaskTitle.width) {
          throw new Error('The current task time unnecessarily reduces every task title width.');
        }
        if (
          !metrics.selectedTaskTime ||
          metrics.selectedTaskTime.top < metrics.selectedTask.top ||
          metrics.selectedTaskTime.bottom > metrics.selectedTask.bottom
        ) {
          throw new Error('The current task update time is not contained in its single row.');
        }
        if (metrics.documentWidth > viewport.width) {
          throw new Error('Workbench produced horizontal document overflow.');
        }
      }
    });
  }

  it('captures the current model-directory failure at 1024x700', async () => {
    await seedFixture();
    await setExactViewport(1024, 700);
    await browser.execute(() => {
      window.localStorage.setItem(
        'ai_novel_studio_ai_settings',
        JSON.stringify({
          runtimeMode: 'api',
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          modelName: 'deepseek-chat',
        }),
      );
    });
    await browser.refresh();
    await waitForWorkbench();
    await (await $('[data-testid="workbench-model-directory-status"]')).waitForDisplayed();
    await (await $('[data-testid="workbench-composer-input"]')).setValue(
      '继续生成本章正文，并保留当前章节目标。',
    );
    const metrics = await browser.execute(() => {
      const read = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          text: node.textContent,
        };
      };
      return {
        notice: read('[data-testid="workbench-model-directory-status"]'),
        retry: read('[data-testid="workbench-model-directory-status-retry"]'),
        settings: read('[data-testid="workbench-model-directory-status-settings"]'),
        input: read('[data-testid="workbench-composer-input"]'),
      };
    });
    fs.writeFileSync(
      path.join(outputDirectory, `${phase}-model-unavailable-1024x700.json`),
      JSON.stringify(metrics, null, 2),
    );
    await browser.saveScreenshot(
      path.join(outputDirectory, `${phase}-model-unavailable-1024x700.png`),
    );
    if (phase === 'after') {
      const { notice, input } = metrics;
      if (!notice || !input) throw new Error('Model recovery notice did not render.');
      const preview = await browser.execute(() => {
        const node = document.querySelector<HTMLElement>('[data-testid="workbench-word-preview"]');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { left: rect.left };
      });
      if (preview && Math.abs(notice.left - preview.left) > 1) {
        throw new Error('Model recovery notice and chapter goal brief use different gutters.');
      }
    }
  });

  it('checks hover, keyboard focus, light theme, and text contrast', async () => {
    await seedFixture();
    await setExactViewport(1024, 700);

    const secondTask = await $(
      '[data-testid="workbench-task"][data-conversation-id="ui-refine-task-b"]',
    );
    await secondTask.moveTo();
    await browser.pause(260);
    const hover = await browser.execute(() => {
      const entry = document.querySelector<HTMLElement>(
        '[data-testid="workbench-task"][data-conversation-id="ui-refine-task-b"]',
      )?.parentElement;
      const trigger = entry?.querySelector<HTMLElement>('.workbench-task-menu-trigger');
      if (!trigger) return null;
      const style = window.getComputedStyle(trigger);
      const rect = trigger.getBoundingClientRect();
      const time = entry.querySelector<HTMLElement>('time')?.getBoundingClientRect();
      return {
        opacity: style.opacity,
        width: rect.width,
        height: rect.height,
        overlapsTime: time
          ? rect.left < time.right &&
            rect.right > time.left &&
            rect.top < time.bottom &&
            rect.bottom > time.top
          : null,
      };
    });
    if (hover) {
      if (hover.opacity !== '1') throw new Error('Hovered task menu trigger is not visible.');
      if (hover.overlapsTime) throw new Error('Task menu trigger overlaps task metadata.');
    }
    const hoverTooltip = await browser.execute(() => {
      const tooltip = document.querySelector<HTMLElement>('[data-testid="ui-tooltip"]');
      const tree = document.querySelector<HTMLElement>('.workbench-tree');
      if (!tooltip || !tree) return null;
      const tip = tooltip.getBoundingClientRect();
      const treeRect = tree.getBoundingClientRect();
      const coversRows = Array.from(
        document.querySelectorAll<HTMLElement>('.workbench-task-entry'),
      ).some((row) => {
        const rect = row.getBoundingClientRect();
        return (
          tip.left < rect.right &&
          tip.right > rect.left &&
          tip.top < rect.bottom &&
          tip.bottom > rect.top
        );
      });
      return {
        left: tip.left,
        treeRight: treeRect.right,
        coversRows,
        text: tooltip.textContent ?? '',
      };
    });
    if (phase === 'after') {
      if (!hoverTooltip) throw new Error('Hover tooltip did not render.');
      if (hoverTooltip.left < hoverTooltip.treeRight) {
        throw new Error('Hover tooltip overlaps the sidebar list.');
      }
      if (hoverTooltip.coversRows) {
        throw new Error('Hover tooltip covers an adjacent task row.');
      }
      if (!hoverTooltip.text.includes('Reconstruct the harbor')) {
        throw new Error('Hover tooltip does not expose the full task title.');
      }
    }
    await browser.saveScreenshot(path.join(outputDirectory, `${phase}-hover-1024x700.png`));

    const selectedTask = await $(
      '[data-testid="workbench-task"][data-conversation-id="ui-refine-task-a"]',
    );
    await selectedTask.click();
    await browser.keys(['Shift', 'Tab']);
    await browser.pause(260);
    const focus = await browser.execute(() => {
      const node = document.activeElement as HTMLElement | null;
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        testId: node.dataset.testid ?? '',
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineOffset: style.outlineOffset,
      };
    });
    fs.writeFileSync(
      path.join(outputDirectory, `${phase}-focus-1024x700.json`),
      JSON.stringify(focus, null, 2),
    );
    await browser.saveScreenshot(path.join(outputDirectory, `${phase}-focus-1024x700.png`));
    if (phase === 'after') {
      if (focus?.testId !== 'workbench-project') {
        throw new Error(`Keyboard focus landed on ${focus?.testId || 'nothing'}.`);
      }
      if (focus.outlineStyle !== 'solid' || focus.outlineWidth !== '2px') {
        throw new Error('Keyboard focus ring is not visible on the project row.');
      }
      const focusTooltip = await browser.execute(() => {
        const tooltip = document.querySelector<HTMLElement>('[data-testid="ui-tooltip"]');
        return tooltip ? { text: tooltip.textContent ?? '' } : null;
      });
      if (!focusTooltip?.text.includes('雾港纪事')) {
        throw new Error('Keyboard focus did not expose the full project title.');
      }
    }

    await browser.execute(() => {
      window.localStorage.setItem('ai_novel_studio_theme_preference', 'light');
    });
    await browser.refresh();
    await waitForWorkbench();
    await setExactViewport(1024, 700);
    await (await $('[data-testid="workbench-composer-input"]')).setValue(
      '根据当前章节目标推进雾港来信。',
    );
    const contrast = await browser.execute(() => {
      const parse = (value: string) =>
        value
          .match(/[\d.]+/gu)
          ?.slice(0, 3)
          .map(Number) ?? [0, 0, 0];
      const luminance = (rgb: number[]) => {
        const channels = rgb.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const ratio = (foreground: string, background: string) => {
        const lighter = Math.max(luminance(parse(foreground)), luminance(parse(background)));
        const darker = Math.min(luminance(parse(foreground)), luminance(parse(background)));
        return (lighter + 0.05) / (darker + 0.05);
      };
      const activeRow = document.querySelector<HTMLElement>('.workbench-task-row.is-active');
      const taskTime = activeRow?.querySelector<HTMLElement>('time');
      const goalBrief = document.querySelector<HTMLElement>('.workbench-goal-brief');
      const surface = document.querySelector<HTMLElement>('.workbench-composer-surface');
      if (!activeRow || !taskTime || !goalBrief || !surface) return null;
      return {
        theme: document.documentElement.dataset.effectiveTheme,
        taskMeta: ratio(
          getComputedStyle(taskTime).color,
          getComputedStyle(activeRow).backgroundColor,
        ),
        goalBrief: ratio(
          getComputedStyle(goalBrief).color,
          getComputedStyle(surface).backgroundColor,
        ),
      };
    });
    fs.writeFileSync(
      path.join(outputDirectory, `${phase}-light-contrast-1024x700.json`),
      JSON.stringify(contrast, null, 2),
    );
    await browser.saveScreenshot(path.join(outputDirectory, `${phase}-light-1024x700.png`));
    if (phase === 'after') {
      if (contrast?.theme !== 'light') throw new Error('Light theme did not activate.');
      if ((contrast.taskMeta ?? 0) < 4.5) {
        throw new Error('Task metadata contrast is below 4.5:1.');
      }
      if ((contrast.goalBrief ?? 0) < 4.5) {
        throw new Error('Chapter goal brief contrast is below 4.5:1.');
      }
    }
  });
});
