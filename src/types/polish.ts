/**
 * AI Novel Studio - 正文润色类型定义
 */

export type PolishMode =
  | 'keep_plot'
  | 'enhance_description'
  | 'reduce_redundancy'
  | 'strengthen_conflict'
  | 'adjust_pacing'
  | 'unify_style'
  | 'fix_language'
  | 'custom';

export const PolishModeLabels: Record<PolishMode, string> = {
  keep_plot: '保持剧情不变',
  enhance_description: '增强描写',
  reduce_redundancy: '减少废话',
  strengthen_conflict: '强化冲突',
  adjust_pacing: '调整节奏',
  unify_style: '统一文风',
  fix_language: '修正语言问题',
  custom: '自定义要求',
};

export interface PolishRequestOptions {
  mode: PolishMode;
  customInstruction?: string;
  preservePlot: boolean;
  preserveCharacters: boolean;
  preserveKeyEvents: boolean;
  targetStyleProfileId?: string;
  outputProfileId?: string;
}

export interface PolishRecord {
  id: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  resultDraftId?: string;
  mode: PolishMode;
  instruction?: string;
  aiTaskId?: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePolishRecordInput {
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  mode: PolishMode;
  instruction?: string;
}

export interface RunPolishInput {
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  draftContent: string;
  chapterTitle: string;
  chapterOutline?: string;
  styleProfile?: string;
  outputProfile?: string;
  previousContext?: string;
  chapterCharacters?: string;
  chapterEvents?: string;
  qualityIssues?: string;
  options: PolishRequestOptions;
}
