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
  | null;

export type RightDockPanelType = Exclude<PanelType, 'draft-history' | null>;
