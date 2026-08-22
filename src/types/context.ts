/**
 * AI Novel Studio - 上下文记录类型定义
 * v1.7.13: 增加章节上下文分类、过期和卷归类
 */

export type ContextRecordType =
  | 'chapter_summary'
  | 'volume_summary'
  | 'character_state'
  | 'foreshadow'
  | 'rule'
  | 'relationship'
  | 'plot_progress'
  | 'other';

/** 上下文记录分类（面板显示用） */
export type ContextCategory = 'chapter_context' | 'volume_context' | 'manual_context';

export const ContextRecordTypeLabels: Record<ContextRecordType, string> = {
  chapter_summary: '章节摘要',
  volume_summary: '分卷摘要',
  character_state: '角色状态',
  foreshadow: '伏笔',
  rule: '规则',
  relationship: '关系变化',
  plot_progress: '剧情进度',
  other: '其他',
};

export const ContextRecordTypeColors: Record<ContextRecordType, string> = {
  chapter_summary: '#3b82f6',
  volume_summary: '#2563eb',
  character_state: '#22c55e',
  foreshadow: '#a855f7',
  rule: '#ef4444',
  relationship: '#f59e0b',
  plot_progress: '#f97316',
  other: '#6b7280',
};

export const ContextCategoryLabels: Record<ContextCategory, string> = {
  chapter_context: '章节上下文',
  volume_context: '卷上下文',
  manual_context: '手动上下文',
};

export interface ContextRecord {
  id: string;
  novelId: string;
  chapterId?: string;
  volumeId?: string;
  contextType: ContextRecordType;
  title: string;
  content: string;
  importance: 1 | 2 | 3 | 4 | 5;
  isActive: boolean;
  /** v1.7.13 过期和版本绑定 */
  isExpired?: boolean;
  contentHash?: string;
  draftVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContextRecordInput {
  novelId: string;
  chapterId?: string;
  volumeId?: string;
  contextType: ContextRecordType;
  title: string;
  content: string;
  importance?: number;
  isActive?: boolean;
  contentHash?: string;
  draftVersion?: number;
}

export interface GetContextForGenerationInput {
  novelId: string;
  chapterId?: string;
  maxCount?: number;
  /** 是否排除过期记录 */
  excludeExpired?: boolean;
}
