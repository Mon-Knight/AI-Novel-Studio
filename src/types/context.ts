/**
 * AI Novel Studio - 上下文记录类型定义
 */

export type ContextRecordType =
  | 'chapter_summary' | 'volume_summary' | 'character_state'
  | 'foreshadow' | 'rule' | 'relationship' | 'plot_progress' | 'other';

export const ContextRecordTypeLabels: Record<ContextRecordType, string> = {
  chapter_summary: '章节摘要', volume_summary: '分卷摘要', character_state: '角色状态',
  foreshadow: '伏笔', rule: '规则', relationship: '关系变化', plot_progress: '剧情进度', other: '其他',
};

export const ContextRecordTypeColors: Record<ContextRecordType, string> = {
  chapter_summary: '#3b82f6', volume_summary: '#2563eb', character_state: '#22c55e',
  foreshadow: '#a855f7', rule: '#ef4444', relationship: '#f59e0b', plot_progress: '#f97316', other: '#6b7280',
};

export interface ContextRecord {
  id: string; novelId: string; chapterId?: string;
  contextType: ContextRecordType; title: string; content: string;
  importance: 1 | 2 | 3 | 4 | 5; isActive: boolean;
  createdAt: string; updatedAt: string;
}

export interface CreateContextRecordInput {
  novelId: string; chapterId?: string; contextType: ContextRecordType;
  title: string; content: string; importance?: number; isActive?: boolean;
}

export interface GetContextForGenerationInput {
  novelId: string; chapterId?: string; maxCount?: number;
}
