import {
  ArrowDownToLine,
  BookOpenText,
  Bot,
  Boxes,
  Database,
  LayoutTemplate,
  Library,
  ListTree,
  Palette,
  PenLine,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type ShellSection = 'session' | 'project' | 'hub' | 'other';
export type ShellLayout = 'workbench' | 'writing' | 'hub' | 'standard';

export interface ShellNavEntry {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Marks the entry active for nested routes as well as the exact path. */
  matchPrefix?: boolean;
}

export interface ShellNavGroup {
  label: string;
  entries: ShellNavEntry[];
}

export interface ShellContext {
  section: ShellSection;
  layout: ShellLayout;
  novelId: string | null;
  /** Human-readable label of the current page for the frame bar. */
  pageLabel: string;
}

/** Intents that the sidebar quick actions hand to the workbench route. */
export type WorkbenchIntent = 'new-task' | 'search';

export interface WorkbenchIntentState {
  workbenchIntent?: WorkbenchIntent;
}

const PROJECT_PAGES: Array<{ suffix: string; label: string; icon: LucideIcon }> = [
  { suffix: '', label: '作品概览', icon: BookOpenText },
  { suffix: '/workspace', label: '章节审阅', icon: PenLine },
  { suffix: '/outline', label: '大纲', icon: ListTree },
  { suffix: '/setting-suggestions', label: '设定推演', icon: Sparkles },
  { suffix: '/references', label: '参考资料', icon: Library },
  { suffix: '/story-assets', label: '故事资产', icon: Boxes },
  { suffix: '/autonomous-planning', label: '自主创作', icon: Bot },
];

export const HUB_GROUPS: ShellNavGroup[] = [
  {
    label: '创作资源',
    entries: [
      { path: '/styles', label: '风格方案', icon: Palette, matchPrefix: true },
      { path: '/templates', label: '模板中心', icon: LayoutTemplate, matchPrefix: true },
      { path: '/assets', label: '创作资产', icon: Boxes, matchPrefix: true },
    ],
  },
  {
    label: '数据与记录',
    entries: [
      { path: '/import-export', label: '导入导出', icon: ArrowDownToLine, matchPrefix: true },
      { path: '/ai-tasks', label: 'AI 任务记录', icon: Bot, matchPrefix: true },
    ],
  },
  {
    label: '设置',
    entries: [
      { path: '/settings?tab=general', label: '常规与外观', icon: Palette },
      { path: '/settings?tab=ai_models', label: 'AI 模型配置', icon: Bot },
      { path: '/settings?tab=governance', label: '网关与流控', icon: ShieldCheck },
      { path: '/settings?tab=data', label: '数据与存储', icon: Database },
      { path: '/settings?tab=diagnostics', label: '诊断与关于', icon: Search },
    ],
  },
];

export const HUB_HOME_PATH = '/settings';
export const HUB_ROUTE_PATTERN =
  /^\/(?:settings|styles|templates|assets|import-export|ai-tasks)(?:\/|$)/u;

export const WORKSPACE_ENTRIES: ShellNavEntry[] = [
  { path: '/', label: '会话', icon: Sparkles },
  { path: '/novels', label: '项目', icon: BookOpenText, matchPrefix: true },
];

export const HUB_ENTRY: ShellNavEntry = {
  path: HUB_HOME_PATH,
  label: '资源中心',
  icon: Settings2,
  matchPrefix: true,
};

export function resolveNovelId(pathname: string): string | null {
  const match = /^\/novels\/([^/]+)/u.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function projectEntries(novelId: string): ShellNavEntry[] {
  return PROJECT_PAGES.map((page) => ({
    path: `/novels/${encodeURIComponent(novelId)}${page.suffix}`,
    label: page.label,
    icon: page.icon,
  }));
}

export function isEntryActive(entry: ShellNavEntry, pathname: string, search = ''): boolean {
  const [entryPath, entryQuery] = entry.path.split('?');
  if (entryQuery) {
    if (pathname !== entryPath) return false;
    const params = new URLSearchParams(search);
    const [key, value] = entryQuery.split('=');
    return (params.get(key) ?? 'general') === value;
  }
  if (entry.path === '/') return pathname === '/';
  if (entry.matchPrefix) return pathname === entryPath || pathname.startsWith(`${entryPath}/`);
  return pathname === entryPath;
}

export function resolvePageLabel(pathname: string): string {
  if (pathname === '/') return '创作会话';
  if (pathname === '/novels') return '小说项目';
  const novelId = resolveNovelId(pathname);
  if (novelId) {
    const page = PROJECT_PAGES.find(
      (candidate) => pathname === `/novels/${encodeURIComponent(novelId)}${candidate.suffix}`,
    );
    return page?.label ?? '作品详情';
  }
  if (/^\/worlds\/[^/]+\/lore\/suggestions/u.test(pathname)) return '设定推演';
  for (const group of HUB_GROUPS) {
    const entry = group.entries.find((candidate) => isEntryActive(candidate, pathname));
    if (entry) return entry.label;
  }
  if (pathname === '/coming-soon') return '即将开放';
  return '页面';
}

export function resolveShellContext(pathname: string): ShellContext {
  const novelId = resolveNovelId(pathname);
  const pageLabel = resolvePageLabel(pathname);
  if (pathname === '/')
    return { section: 'session', layout: 'workbench', novelId: null, pageLabel };
  if (/^\/novels\/[^/]+\/workspace\/?$/u.test(pathname)) {
    return { section: 'project', layout: 'writing', novelId, pageLabel };
  }
  if (pathname === '/novels' || novelId || /^\/worlds\//u.test(pathname)) {
    return { section: 'project', layout: 'standard', novelId, pageLabel };
  }
  if (HUB_ROUTE_PATTERN.test(pathname)) {
    return { section: 'hub', layout: 'hub', novelId: null, pageLabel };
  }
  return { section: 'other', layout: 'standard', novelId: null, pageLabel };
}

/** Builds the sidebar navigation groups for a route: workspace entries plus the active project. */
export function sidebarGroups(pathname: string): ShellNavGroup[] {
  const groups: ShellNavGroup[] = [{ label: '工作区', entries: [...WORKSPACE_ENTRIES, HUB_ENTRY] }];
  const novelId = resolveNovelId(pathname);
  if (novelId) groups.push({ label: '当前项目', entries: projectEntries(novelId) });
  return groups;
}
