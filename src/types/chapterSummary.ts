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
    type:
      | 'fabrication'
      | 'omission'
      | 'character_error'
      | 'setting_error'
      | 'spoiler'
      | 'speculation'
      | 'quality_conflict';
    message: string;
  }>;
  safeToContext: boolean;
}

export interface ChapterCharacterChange {
  characterName: string;
  characterId?: string;
  stateSummary: string;
  relationshipChanges?: string;
  goalChanges?: string;
  location?: string;
  healthState?: string;
  knowledgeState?: string;
}

export interface ChapterRelationshipChange {
  fromCharacterName: string;
  toCharacterName: string;
  change: string;
}

/** 章节总结持久化实体 */
export interface ChapterSummary {
  id: string;
  novelId: string;
  chapterId: string;
  volumeId?: string;
  adoptedDraftId: string;
  summary: string;
  keyEvents?: string[];
  characterChanges?: ChapterCharacterChange[] | Record<string, unknown>;
  relationshipChanges?: ChapterRelationshipChange[] | Record<string, unknown>;
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateChapterSummaryInput {
  novelId: string;
  chapterId: string;
  volumeId?: string;
  adoptedDraftId: string;
  summary: string;
  keyEvents?: string[];
  characterChanges?: ChapterCharacterChange[] | Record<string, unknown>;
  relationshipChanges?: ChapterRelationshipChange[] | Record<string, unknown>;
  newForeshadows?: string[];
  resolvedForeshadows?: string[];
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
  characterChanges: ChapterCharacterChange[];
  relationshipChanges: ChapterRelationshipChange[];
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
    contextType: ContextRecordType;
    title: string;
    content: string;
    importance: 1 | 2 | 3 | 4 | 5;
  }>;
}

export interface SummarizeAdoptedChapterInput {
  novelId: string;
  chapterId: string;
  adoptedDraftId: string;
  chapterTitle: string;
  chapterOutline?: string;
  adoptedContent: string;
  chapterCharacters?: string;
  chapterEvents?: string;
}

export interface SaveSummarizeResultInput {
  novelId: string;
  chapterId: string;
  volumeId?: string;
  adoptedDraftId: string;
  result: ChapterSummarizeResult;
  contentHash?: string;
  draftVersion?: number;
}

/** 一致性校验输入 */
export interface ValidateSummaryInput {
  draftContent: string;
  summaryResult: ChapterSummarizeResult;
  chapterTitle: string;
}

// ==================== v1.7.14 卷上下文类型 ====================

/** 卷完成检查结果 */
export interface VolumeCompletionCheck {
  completed: boolean;
  reasons: string[];
  totalChapters: number;
  chaptersWithContext: number;
  expiredContexts: number;
  disabledContexts: number;
}

/** 卷总结 AI 返回结果 */
export interface VolumeSummarizeResult {
  summaryTitle: string;
  volumeMainArc: string;
  majorEvents: string[];
  protagonistGrowth: string;
  characterChanges: Array<{ name: string; change: string }>;
  relationshipChanges: Array<{ from: string; to: string; change: string }>;
  factionChanges: string[];
  settingChanges: string[];
  foreshadowingCollected: string[];
  unresolvedQuestions: string[];
  factsMustRemember: string[];
  nextVolumeHook: string;
}

/** 卷总结生成输入 */
export interface SummarizeVolumeInput {
  novelId: string;
  volumeId: string;
  volumeTitle: string;
  chapterContexts: Array<{
    chapterId: string;
    chapterTitle: string;
    summary: string;
    keyEvents: string[];
    coreEvents?: string[];
    protagonistStateChange?: string;
    importantCharacterChanges?: Array<{ name: string; change: string }>;
    settingChanges?: string[];
    newForeshadows?: string[];
    resolvedForeshadows?: string[];
    unresolvedQuestions?: string[];
    factsMustRemember?: string[];
  }>;
}
