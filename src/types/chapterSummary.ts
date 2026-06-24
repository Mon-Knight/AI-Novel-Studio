/**
 * AI Novel Studio - 章节总结与总结结果类型定义
 * v1.7.13: 章节总结升级为章节上下文，增加一致性校验、过期机制
 */
import type { ContextRecordType } from './context';

/** 校验结果 */
export interface ChapterSummaryValidation {
  passed: boolean;
  score: number;
  problems: Array<{
    type: 'fabrication' | 'omission' | 'character_error' | 'setting_error' | 'spoiler' | 'speculation' | 'quality_conflict';
    message: string;
  }>;
  safeToContext: boolean;
}

/** 章节总结持久化实体 */
export interface ChapterSummary {
  id: string; novelId: string; chapterId: string; volumeId?: string;
  adoptedDraftId: string;
  summary: string;
  keyEvents?: string[];
  characterChanges?: Record<string, unknown>;
  relationshipChanges?: Record<string, unknown>;
  newForeshadows?: string[];
  resolvedForeshadows?: string[];
  nextChapterHints?: string;
  /** 结构化章节上下文（v1.7.13） */
  coreEvents?: string[];
  protagonistStateChange?: string;
  importantCharacterChanges?: Array<{ name: string; change: string }>;
  settingChanges?: string[];
  newLocations?: string[];
  newItemsOrAbilities?: string[];
  foreshadowing?: string[];
  unresolvedQuestions?: string[];
  factsMustRemember?: string[];
  nextChapterHook?: string;
  /** 校验状态 */
  validationStatus?: 'pending' | 'passed' | 'failed';
  validationResult?: ChapterSummaryValidation;
  /** 启用状态 */
  enabled: boolean;
  /** 过期机制 */
  contentHash?: string;
  draftVersion?: number;
  isExpired: boolean;
  aiTaskId?: string;
  createdAt: string; updatedAt: string;
}

export interface CreateChapterSummaryInput {
  novelId: string; chapterId: string; volumeId?: string;
  adoptedDraftId: string; summary: string;
  keyEvents?: string[]; characterChanges?: Record<string, unknown>;
  relationshipChanges?: Record<string, unknown>;
  newForeshadows?: string[]; resolvedForeshadows?: string[];
  nextChapterHints?: string;
  coreEvents?: string[];
  protagonistStateChange?: string;
  importantCharacterChanges?: Array<{ name: string; change: string }>;
  settingChanges?: string[];
  newLocations?: string[];
  newItemsOrAbilities?: string[];
  foreshadowing?: string[];
  unresolvedQuestions?: string[];
  factsMustRemember?: string[];
  nextChapterHook?: string;
  validationStatus?: 'pending' | 'passed' | 'failed';
  validationResult?: ChapterSummaryValidation;
  enabled?: boolean;
  contentHash?: string;
  draftVersion?: number;
  aiTaskId?: string;
}

export interface ChapterSummarizeResult {
  summary: string;
  summaryTitle?: string;
  keyEvents: string[];
  coreEvents?: string[];
  protagonistStateChange?: string;
  importantCharacterChanges?: Array<{ name: string; change: string }>;
  characterChanges: Array<{
    characterName: string; characterId?: string; stateSummary: string;
    relationshipChanges?: string; goalChanges?: string;
    location?: string; healthState?: string; knowledgeState?: string;
  }>;
  relationshipChanges: Array<{
    fromCharacterName: string; toCharacterName: string; change: string;
  }>;
  settingChanges?: string[];
  newLocations?: string[];
  newItemsOrAbilities?: string[];
  newForeshadows: string[];
  resolvedForeshadows: string[];
  foreshadowing?: string[];
  unresolvedQuestions?: string[];
  factsMustRemember?: string[];
  nextChapterHints: string;
  nextChapterHook?: string;
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
  novelId: string; chapterId: string; volumeId?: string;
  adoptedDraftId: string; result: ChapterSummarizeResult;
  contentHash?: string; draftVersion?: number;
}

/** 一致性校验输入 */
export interface ValidateSummaryInput {
  draftContent: string;
  summaryResult: ChapterSummarizeResult;
  chapterTitle: string;
}

