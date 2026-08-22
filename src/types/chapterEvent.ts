/**
 * AI Novel Studio - 章节事件类型定义
 */

export type ChapterEventStatus =
  'candidate' | 'selected' | 'required' | 'forbidden' | 'adopted' | 'discarded';
export type ChapterEventSource = 'manual' | 'ai_suggested';

export const ChapterEventStatusLabels: Record<ChapterEventStatus, string> = {
  candidate: '候选',
  selected: '已选择',
  required: '必须发生',
  forbidden: '禁止发生',
  adopted: '已采用',
  discarded: '已废弃',
};

export interface ChapterEvent {
  id: string;
  novelId: string;
  chapterId: string;
  title: string;
  description: string;
  involvedCharacterIds?: string[];
  impact?: string;
  risk?: string;
  status: ChapterEventStatus;
  source: ChapterEventSource;
  aiTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChapterEventInput {
  novelId: string;
  chapterId: string;
  title: string;
  description: string;
  involvedCharacterIds?: string[];
  impact?: string;
  risk?: string;
  status?: ChapterEventStatus;
  source?: ChapterEventSource;
}
