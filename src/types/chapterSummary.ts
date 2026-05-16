/**
 * AI Novel Studio - 章节总结与总结结果类型定义
 */
import type { ContextRecordType } from './context';

export interface ChapterSummary {
  id: string; novelId: string; chapterId: string; adoptedDraftId: string;
  summary: string;
  keyEvents?: string[];
  characterChanges?: Record<string, unknown>;
  relationshipChanges?: Record<string, unknown>;
  newForeshadows?: string[];
  resolvedForeshadows?: string[];
  nextChapterHints?: string;
  aiTaskId?: string;
  createdAt: string; updatedAt: string;
}

export interface CreateChapterSummaryInput {
  novelId: string; chapterId: string; adoptedDraftId: string; summary: string;
  keyEvents?: string[]; characterChanges?: Record<string, unknown>;
  relationshipChanges?: Record<string, unknown>;
  newForeshadows?: string[]; resolvedForeshadows?: string[];
  nextChapterHints?: string; aiTaskId?: string;
}

export interface ChapterSummarizeResult {
  summary: string;
  keyEvents: string[];
  characterChanges: Array<{
    characterName: string; characterId?: string; stateSummary: string;
    relationshipChanges?: string; goalChanges?: string;
    location?: string; healthState?: string; knowledgeState?: string;
  }>;
  relationshipChanges: Array<{
    fromCharacterName: string; toCharacterName: string; change: string;
  }>;
  newForeshadows: string[];
  resolvedForeshadows: string[];
  nextChapterHints: string;
  contextRecords: Array<{
    contextType: ContextRecordType; title: string; content: string; importance: 1 | 2 | 3 | 4 | 5;
  }>;
}

export interface SummarizeAdoptedChapterInput {
  novelId: string; chapterId: string; adoptedDraftId: string;
  chapterTitle: string; chapterOutline?: string; adoptedContent: string;
  chapterCharacters?: string; chapterEvents?: string;
}

export interface SaveSummarizeResultInput {
  novelId: string; chapterId: string; adoptedDraftId: string; result: ChapterSummarizeResult;
}
