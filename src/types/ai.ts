/**
 * AI Novel Studio - AI 类型定义（v1.0.6 增强版）
 */

// ==================== AI 设置 ====================

export type AiRuntimeMode = 'mock' | 'api';
export type AiProvider = 'mock' | 'deepseek' | 'openai_compatible';

export interface AiSettings {
  runtimeMode: AiRuntimeMode;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  mockMode: boolean; // 兼容旧字段，从 runtimeMode 派生
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
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
  taskType?: AiTaskType;
  messages: AiChatMessage[];
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  promptTemplateSource?: string;
  promptDebug?: ChapterPromptDebugInfo;
}

export interface AiGenerateResponse {
  text: string;
  raw?: unknown;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
}

export interface AiGenerateOptions {
  signal?: AbortSignal;
  requestId?: string;
}

export interface AiClient {
  generate(request: AiGenerateRequest, options?: AiGenerateOptions): Promise<AiGenerateResponse>;
}

// ==================== AI 任务记录 ====================

export type AiTaskType =
  | 'connection_test'
  | 'setting_expand'
  | 'setting_suggestion_generate'
  | 'outline_generate'
  | 'volume_outline_generate'
  | 'context_summarize'
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
  | 'quality_fix'
  | 'chapter_summarize'
  | 'context_update';

export type AiTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AiTaskRecord {
  id: string;
  novelId?: string;
  chapterId?: string;
  taskType: AiTaskType;
  status: AiTaskStatus;
  runtimeMode?: 'mock' | 'api';
  provider?: string;
  modelName?: string;
  promptTemplateId?: string;
  inputSummary?: string;
  promptSnapshot?: string;
  resultText?: string;
  resultJson?: string;
  errorMessage?: string;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export const AiTaskTypeLabels: Record<AiTaskType, string> = {
  connection_test: '连接测试',
  setting_expand: '设定补充',
  setting_suggestion_generate: '设定库 AI 推演',
  outline_generate: '作品大纲生成',
  volume_outline_generate: '分卷大纲生成',
  context_summarize: '上下文总结',
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
  quality_fix: 'AI修稿',
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
  largeTextRefId?: string;
  /** Full-content availability. `content` is always empty when unavailable. */
  contentState?: import('./draftContentState').DraftContentState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChapterDraftInput {
  novelId: string;
  chapterId: string;
  content: string;
  source: DraftSource;
  /** Optional durable idempotency identity for cross-session workflows. */
  operationId?: string;
  title?: string;
  aiTaskId?: string;
  note?: string;
  largeTextRefId?: string;
}

// ==================== 生成上下文 ====================

export interface ChapterCharacterContext {
  id: string;
  novelId: string;
  chapterId: string;
  characterId: string;
  name: string;
  roleInChapter?: string;
  roleType?: string;
  identity?: string;
  faction?: string;
  goal?: string;
  personality?: string;
  behaviorLimits?: string;
  forbiddenBehaviors?: string;
  note?: string;
  mustAppear: boolean;
  isProtagonist?: boolean;
}

export type OutlineKeyPointType =
  | 'event'
  | 'character'
  | 'conflict'
  | 'turning_point'
  | 'ending'
  | 'setting'
  | 'other';

export interface OutlineKeyPoint {
  id: string;
  text: string;
  type: OutlineKeyPointType;
  required: boolean;
}

export interface OutlineComplianceResult {
  score: number;
  coveredPoints: OutlineKeyPoint[];
  missingPoints: OutlineKeyPoint[];
  warnings: string[];
}

export interface ChapterPromptDebugInfo {
  templateSource: 'chapter_generate.md' | 'DEFAULT_TEMPLATE';
  hasChapterOutlineBlock: boolean;
  hasOutlineChecklistBlock: boolean;
  hasVolumeOutlineBlock: boolean;
  hasMasterOutlineBlock: boolean;
  hasChapterGoalBlock: boolean;
  hasChapterCharactersBlock: boolean;
  hasRequiredCharactersBlock: boolean;
  includesChapterOutlineText: boolean;
  includesOutlineChecklistText: boolean;
  includesVolumeOutlineText: boolean;
  includesMasterOutlineText: boolean;
  outlineKeyPointCount: number;
  requiredCharactersCount: number;
  requiredCharacterNames: string[];
  promptLength: number;
}

export interface ChapterGenerationContext {
  novelTitle: string;
  novelGenre?: string;
  novelDescription?: string;
  novelOutline?: string;
  masterOutline?: string;
  worldBackground?: string;
  ruleSystems?: string;
  protagonist?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  protagonistMode?: string;
  protagonistsSummary?: string;
  dualProtagonistSummary?: string;
  protagonistNames?: string;
  protagonistAppearance?: string;
  protagonistMustAppear?: boolean;
  volumeTitle?: string;
  volumeOutline?: string;
  volumeGoal?: string;
  volumeConflict?: string;
  chapterTitle: string;
  chapterOutline?: string;
  outlineKeyPoints?: OutlineKeyPoint[];
  outlineChecklistText?: string;
  chapterGoal?: string;
  targetWordCount?: number;
  styleProfile?: string;
  outputProfile?: string;
  chapterCharacters?: string;
  chapterCharacterList?: ChapterCharacterContext[];
  requiredCharacters?: ChapterCharacterContext[];
  requiredCharactersSummary?: string;
  requiredCharacterNames?: string;
  chapterEvents?: string;
  chapterSettings?: string;
  previousContext?: string;
  userInstruction?: string;
  /** 当前草稿正文（重新生成/改写模式时传入） */
  draftContent?: string;
  chapterOutlineSource?: 'active_chapter_outline' | 'chapter_field' | 'draft' | 'empty';
  volumeOutlineSource?: 'active_outline' | 'volume_field' | 'none';
  masterOutlineSource?: 'active_outline' | 'novel_field' | 'novel_description' | 'none';
}
