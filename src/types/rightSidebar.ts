export type PanelType =
  | 'ai-generate'
  | 'engineering'
  | 'outline'
  | 'characters'
  | 'events'
  | 'setting'
  | 'style'
  | 'check'
  | 'polish'
  | 'multi-agent'
  | 'draft-history'
  | 'chapter-summary'
  | 'context-view'
  | 'memory-inspector'
  | 'generation-trace'
  | null;

export type RightDockPanelType = Exclude<PanelType, 'draft-history' | null>;

/** Review-only panels still offered in the writing workspace toolbar. */
export const WORKSPACE_REVIEW_PANELS = [
  'chapter-summary',
  'memory-inspector',
  'generation-trace',
] as const;

/** Desktop E2E keeps legacy rollback and AI surfaces testable after their production entry was removed. */
export const WORKSPACE_E2E_PANELS = [
  'draft-history',
  'ai-generate',
  'engineering',
  'check',
  'setting',
] as const;

export const RETIRED_WORKSPACE_AI_PANELS: ReadonlySet<Exclude<PanelType, null>> = new Set([
  'draft-history',
  'ai-generate',
  'outline',
  'characters',
  'events',
  'style',
  'polish',
  'multi-agent',
  'context-view',
  'engineering',
  'check',
  'setting',
]);

export function isWorkspaceAiPanelRetired(
  panel: PanelType,
  e2eEnabled = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1',
): boolean {
  if (!panel || (WORKSPACE_REVIEW_PANELS as readonly string[]).includes(panel)) return false;
  if (e2eEnabled && (WORKSPACE_E2E_PANELS as readonly string[]).includes(panel)) return false;
  return RETIRED_WORKSPACE_AI_PANELS.has(panel);
}
