/**
 * AI Novel Studio - 章节与草稿类型定义
 */

export type ChapterStatus =
  | 'unwritten'
  | 'ai_draft'
  | 'user_revised'
  | 'adopted'
  | 'summarized';

export type DraftSource =
  | 'ai_generate'
  | 'ai_regenerate'
  | 'ai_polish'
  | 'user_edit'
  | 'import';

export interface Chapter {
  id: string;
  novelId: string;
  volumeId: string;
  title: string;
  chapterNumber: number;
  status: ChapterStatus;
  targetWords: number;
  currentWords: number;
  adoptedDraftId?: string;
  drafts: ChapterDraft[];
  summary?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
