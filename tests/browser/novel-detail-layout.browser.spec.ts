import { $, browser, expect } from '@wdio/globals';

const projectId = 'novel-detail-bounded-layout';

async function setViewport(width: number, height: number): Promise<void> {
  await browser.setWindowSize(width, height);
  const outer = await browser.getWindowSize();
  const inner = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
  await browser.setWindowSize(
    outer.width + width - inner.width,
    outer.height + height - inner.height,
  );
  await browser.waitUntil(
    async () => browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
    { timeout: 5000 },
  );
}

async function seedDetail(long: boolean): Promise<void> {
  await browser.execute(
    (id, expanded) => {
      if (
        location.hostname !== '127.0.0.1' ||
        '__TAURI__' in window ||
        '__TAURI_INTERNALS__' in window ||
        '__TAURI_IPC__' in window
      ) {
        throw new Error('Layout fixtures require an isolated loopback browser without Tauri.');
      }
      localStorage.clear();
      const now = '2026-10-15T00:00:00.000Z';
      const content = '背景、人物动机与叙事限制。\n'.repeat(100) + '完整内容末尾';
      localStorage.setItem(
        'ai_novel_studio_novels',
        JSON.stringify([
          {
            id,
            title: '固定模块布局测试',
            genre: '悬疑',
            description: '',
            outline: '',
            protagonistMode: 'single',
            protagonists: [],
            status: 'planning',
            totalWordCount: 0,
            targetWordCount: 60_000,
            createdAt: now,
            updatedAt: now,
            volumes: [],
          },
        ]),
      );
      const source = { novelId: id, content, isActive: true, createdAt: now, updatedAt: now };
      localStorage.setItem(
        'ai_novel_studio_world_settings',
        JSON.stringify(expanded ? [{ ...source, id: 'layout-world', title: '创作准备模板' }] : []),
      );
      localStorage.setItem(
        'ai_novel_studio_rule_systems',
        JSON.stringify(
          expanded
            ? Array.from({ length: 12 }, (_, index) => ({
                ...source,
                id: `layout-rule-${index}`,
                title: `规则 ${index + 1}`,
              }))
            : [],
        ),
      );
      localStorage.setItem(
        'ai_novel_studio_volumes',
        JSON.stringify(
          expanded
            ? Array.from({ length: 12 }, (_, index) => ({
                id: `layout-volume-${index}`,
                novelId: id,
                title: `第 ${index + 1} 卷`,
                summary: content,
                orderIndex: index,
                sortOrder: index,
                volumeNumber: index + 1,
                status: 'planned',
                createdAt: now,
                updatedAt: now,
              }))
            : [],
        ),
      );
      localStorage.setItem('ai_novel_studio_chapters', '[]');
    },
    projectId,
    long,
  );
  await browser.url(`/#/novels/${projectId}`);
  await browser.refresh();
  await (await $('.detail-cards-grid')).waitForExist();
  await (await $('#startup-splash')).waitForExist({ reverse: true });
  if (long) await (await $('summary=查看完整背景内容')).waitForExist();
}

async function moduleGeometry() {
  return browser.execute(() => {
    const modules = Array.from(document.querySelectorAll<HTMLElement>('.detail-module'));
    return modules.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        height: box.height,
        width: box.width,
        overflow: getComputedStyle(element).overflowY,
        horizontalOverflow: element.scrollWidth > element.clientWidth,
      };
    });
  });
}

describe('novel detail fixed modules', () => {
  before(async () => {
    await browser.url('/#/novels');
    await (await $('[data-testid="project-list"]')).waitForExist();
  });

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1024, height: 640 },
  ]) {
    it(`keeps empty, long and editing modules at the same height at ${viewport.width}px`, async () => {
      await setViewport(viewport.width, viewport.height);
      await seedDetail(false);
      const empty = await moduleGeometry();
      expect(empty).toHaveLength(8);
      await seedDetail(true);
      const long = await moduleGeometry();
      for (const [index, module] of long.entries()) {
        expect(module.height).toBe(440);
        expect(module.height).toBe(empty[index].height);
        expect(module.overflow).toBe('auto');
        expect(module.horizontalOverflow).toBe(false);
      }
      const outlineOverflow = await browser.execute(() => {
        const outline = document.getElementById('novel-detail-outline');
        if (!outline) throw new Error('Missing outline module');
        outline.scrollTop = outline.scrollHeight;
        return outline.scrollTop;
      });
      expect(outlineOverflow).toBeGreaterThan(0);

      await (await $('summary=查看完整背景内容')).click();
      const expanded = await browser.execute(() => {
        const module = document.getElementById('novel-detail-world-setting');
        const disclosure = module?.querySelector<HTMLDetailsElement>('details');
        if (!module || !disclosure) throw new Error('Missing full background disclosure');
        module.scrollTop = module.scrollHeight;
        return {
          height: module.getBoundingClientRect().height,
          scrolled: module.scrollTop,
          complete: disclosure.open && disclosure.textContent?.includes('完整内容末尾'),
        };
      });
      expect(expanded.height).toBe(440);
      expect(expanded.scrolled).toBeGreaterThan(0);
      expect(expanded.complete).toBe(true);

      await (await $('[data-testid="world-setting-edit"]')).click();
      await (await $('[data-testid="setting-editor-world-layout-world"]')).waitForDisplayed();
      const editor = await browser.execute(() => {
        const module = document.getElementById('novel-detail-world-setting');
        const action = module?.querySelector<HTMLElement>('[data-testid="setting-impact-preview"]');
        if (!module || !action) throw new Error('Missing setting editor action');
        action.scrollIntoView({ block: 'nearest' });
        const moduleBox = module.getBoundingClientRect();
        const actionBox = action.getBoundingClientRect();
        return {
          height: moduleBox.height,
          actionContained: actionBox.top >= moduleBox.top && actionBox.bottom <= moduleBox.bottom,
        };
      });
      expect(editor.height).toBe(440);
      expect(editor.actionContained).toBe(true);
      expect((await moduleGeometry()).every((module) => module.height === 440)).toBe(true);
    });
  }
});
