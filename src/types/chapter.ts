/**
 * AI Novel Studio - 章节与草稿类型定义
 */

export type ChapterStatus =
  | 'not_started'
  | 'outline_ready'
  | 'draft_generated'
  | 'editing'
  | 'polished'
  | 'adopted'
  | 'summarized';

export const ChapterStatusLabels: Record<ChapterStatus, string> = {
  not_started: '未开始',
  outline_ready: '已有大纲',
  draft_generated: '已生成初稿',
  editing: '修改中',
  polished: '已润色',
  adopted: '已采用',
  summarized: '已总结',
};

export type DraftSource = 'ai_generate' | 'ai_regenerate' | 'ai_polish' | 'user_edit' | 'import';

export interface Chapter {
  id: string;
  novelId: string;
  volumeId?: string;
  title: string;
  outline?: string;
  goal?: string;
  chapterNumber: number;
  orderIndex: number;
  sortOrder: number;
  status: ChapterStatus;
  adoptedDraftId?: string;
  wordCount: number;
  currentWords: number;
  targetWordCount?: number;
  targetWords: number;
  drafts: ChapterDraft[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateChapterInput {
  novelId: string;
  volumeId?: string;
  title: string;
  outline?: string;
  goal?: string;
  targetWordCount?: number;
  orderIndex?: number;
}

export interface UpdateChapterInput {
  volumeId?: string;
  title?: string;
  outline?: string;
  goal?: string;
  orderIndex?: number;
  status?: ChapterStatus;
  targetWordCount?: number;
}

export interface ChapterDraft {
  id: string;
  chapterId: string;
  version: number;
  source: DraftSource;
  content: string;
  wordCount: number;
  isAdopted: boolean;
  aiTaskId?: string;
  createdAt: string;
}
