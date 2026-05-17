/**
 * AI Novel Studio - AI 类型定义（v1.0.3 增强版）
 */

// ==================== AI 设置 ====================

export type AiProvider = 'mock' | 'openai_compatible';

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  mockMode: boolean;
}

export interface AiConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

// ==================== AI 请求/响应 ====================

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiGenerateRequest {
  messages: AiChatMessage[];
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiGenerateResponse {
  text: string;
  raw?: unknown;
  tokenInput?: number;
  tokenOutput?: number;
}

export interface AiClient {
  generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;
}

// ==================== AI 任务记录 ====================

export type AiTaskType =
  | 'setting_structure'
  | 'rule_structure'
  | 'protagonist_structure'
  | 'volume_outline_expand'
  | 'chapter_outline_generate'
  | 'style_analyze'
  | 'character_generate'
  | 'event_suggest'
  | 'chapter_generate'
  | 'chapter_rewrite'
  | 'chapter_polish'
  | 'quality_check'
  | 'chapter_summarize'
  | 'context_update';

export type AiTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AiTaskRecord {
  id: string;
  novelId?: string;
  chapterId?: string;
  taskType: AiTaskType;
  status: AiTaskStatus;
  modelName?: string;
  promptTemplateId?: string;
  inputSummary?: string;
  promptSnapshot?: string;
  resultText?: string;
  resultJson?: string;
  errorMessage?: string;
  tokenInput?: number;
  tokenOutput?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export const AiTaskTypeLabels: Record<AiTaskType, string> = {
  setting_structure: '设定整理',
  rule_structure: '规则整理',
  protagonist_structure: '主角设定',
  volume_outline_expand: '分卷大纲扩展',
  chapter_outline_generate: '章节大纲生成',
  style_analyze: '风格分析',
  character_generate: '角色生成',
  event_suggest: '事件推荐',
  chapter_generate: '章节生成',
  chapter_rewrite: '章节重写',
  chapter_polish: '章节润色',
  quality_check: '质量检查',
  chapter_summarize: '章节总结',
  context_update: '上下文更新',
};

// ==================== 草稿来源 ====================

export type DraftSource =
  | 'ai_generated'
  | 'ai_regenerated'
  | 'user_edited'
  | 'ai_polished'
  | 'imported'
  | 'manual_placeholder';

export interface ChapterDraft {
  id: string;
  novelId: string;
  chapterId: string;
  title?: string;
  content: string;
  source: DraftSource;
  versionNo: number;
  wordCount: number;
  isAdopted: boolean;
  aiTaskId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChapterDraftInput {
  novelId: string;
  chapterId: string;
  content: string;
  source: DraftSource;
  title?: string;
  aiTaskId?: string;
  note?: string;
}

// ==================== 生成上下文 ====================

export interface ChapterGenerationContext {
  novelTitle: string;
  novelGenre?: string;
  worldBackground?: string;
  ruleSystems?: string;
  protagonist?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  volumeTitle?: string;
  volumeGoal?: string;
  volumeConflict?: string;
  chapterTitle: string;
  chapterOutline?: string;
  chapterGoal?: string;
  targetWordCount?: number;
  styleProfile?: string;
  outputProfile?: string;
  chapterCharacters?: string;
  chapterEvents?: string;
  previousContext?: string;
  userInstruction?: string;
}
