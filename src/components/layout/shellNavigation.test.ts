import { describe, expect, it } from 'vitest';
import {
  HUB_ENTRY,
  HUB_GROUPS,
  isEntryActive,
  projectEntries,
  resolvePageLabel,
  resolveShellContext,
  sidebarGroups,
  TOP_NAV_ENTRIES,
} from './shellNavigation';

describe('shell navigation model', () => {
  it('maps every route family to a shell layout and section', () => {
    expect(resolveShellContext('/')).toMatchObject({ section: 'session', layout: 'workbench' });
    expect(resolveShellContext('/novels')).toMatchObject({
      section: 'project',
      layout: 'standard',
      novelId: null,
    });
    expect(resolveShellContext('/novels/n-1/workspace')).toMatchObject({
      section: 'project',
      layout: 'writing',
      novelId: 'n-1',
    });
    expect(resolveShellContext('/novels/n-1/outline').layout).toBe('standard');
    for (const path of [
      '/settings',
      '/styles',
      '/templates',
      '/assets',
      '/import-export',
      '/ai-tasks',
    ])
      expect(resolveShellContext(path)).toMatchObject({ section: 'hub', layout: 'hub' });
    expect(resolveShellContext('/coming-soon')).toMatchObject({
      section: 'other',
      layout: 'standard',
    });
  });

  it('labels every registered page for the frame bar', () => {
    expect(resolvePageLabel('/')).toBe('创作会话');
    expect(resolvePageLabel('/novels/n-1')).toBe('作品概览');
    expect(resolvePageLabel('/novels/n-1/setting-suggestions')).toBe('设定推演');
    expect(resolvePageLabel('/worlds/w-1/lore/suggestions')).toBe('设定推演');
    expect(resolvePageLabel('/settings')).toBe('常规与外观');
    expect(resolvePageLabel('/ai-tasks')).toBe('AI 任务记录');
    expect(resolvePageLabel('/unknown')).toBe('页面');
  });

  it('activates settings categories by query string and prefixes by path', () => {
    const settingsGroup = HUB_GROUPS.find((group) => group.label === '设置');
    const general = settingsGroup!.entries[0];
    const models = settingsGroup!.entries[1];
    expect(isEntryActive(general, '/settings', '')).toBe(true);
    expect(isEntryActive(general, '/settings', '?tab=ai_models')).toBe(false);
    expect(isEntryActive(models, '/settings', '?tab=ai_models')).toBe(true);
    expect(isEntryActive(models, '/styles', '?tab=ai_models')).toBe(false);
    const styles = HUB_GROUPS[0].entries[0];
    expect(isEntryActive(styles, '/styles/anything')).toBe(true);
    expect(isEntryActive(styles, '/stylesheet')).toBe(false);
    expect(TOP_NAV_ENTRIES.map((entry) => entry.label)).toEqual(['会话', '项目', '资源中心']);
    expect(isEntryActive(HUB_ENTRY, '/styles')).toBe(true);
    expect(isEntryActive(HUB_ENTRY, '/ai-tasks')).toBe(true);
    expect(isEntryActive(HUB_ENTRY, '/novels')).toBe(false);
  });

  it('keeps only project entries in the project sidebar and encodes novel ids in links', () => {
    const libraryOnly = sidebarGroups('/novels');
    expect(libraryOnly.map((group) => group.label)).toEqual(['小说项目']);
    expect(libraryOnly[0].entries.map((entry) => entry.label)).toEqual(['项目库']);
    const groups = sidebarGroups('/novels/n%201/outline');
    expect(groups.map((group) => group.label)).toEqual(['小说项目', '当前项目']);
    expect(groups[1].entries).toHaveLength(7);
    expect(projectEntries('n 1')[1].path).toBe('/novels/n%201/workspace');
  });
});
