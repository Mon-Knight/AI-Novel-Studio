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

/** Explicit compatibility specs can exercise retired surfaces in an E2E build. */
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

export function isE2eLegacyWorkspacePanelsEnabled(): boolean {
  if (import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E !== '1') return false;
  try {
    return localStorage.getItem('ai_novel_studio_e2e_legacy_workspace_panels') === 'enabled';
  } catch {
    return false;
  }
}

export function isWorkspaceAiPanelRetired(
  panel: PanelType,
  e2eEnabled = isE2eLegacyWorkspacePanelsEnabled(),
): boolean {
  if (!panel || (WORKSPACE_REVIEW_PANELS as readonly string[]).includes(panel)) return false;
  if (e2eEnabled && (WORKSPACE_E2E_PANELS as readonly string[]).includes(panel)) return false;
  return RETIRED_WORKSPACE_AI_PANELS.has(panel);
}
