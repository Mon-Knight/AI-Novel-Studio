export interface StyleProfileFormValue {
  name: string;
  narrativePerspective: string;
  tone: string;
  pace: string;
  sentenceStyle: string;
  dialogueRatio: number;
  descriptionRatio: number;
  styleSummary: string;
}

export interface OutputProfileFormValue {
  name: string;
  targetWordCount: number;
  paceLevel: 'slow' | 'medium' | 'fast';
  dialogueRatio: number;
  descriptionRatio: number;
}

export type StyleProfilesTab = 'styles' | 'outputs' | 'imports';
