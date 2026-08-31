/**
 * AI Novel Studio - AI 类型定义（v1.0.6 增强版）
 */

// ==================== AI 设置 ====================

export type AiRuntimeMode = 'mock' | 'api';
export type AiProvider = 'mock' | 'deepseek' | 'openai_compatible';
export type CloudApiProvider = Exclude<AiProvider, 'mock'>;

export interface SavedApiModelProfile {
  id: string;
  label: string;
  provider: CloudApiProvider;
  baseUrl: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
  lastTestAt?: string;
  lastTestOk?: boolean;
}

export interface SavedLocalModelProfile {
  id: string;
  label: string;
  providerId: string;
  baseUrl: string;
  modelName: string;
  timeoutSeconds: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  minTokens?: number;
  noRepeatNgramSize?: number;
  seed?: number;
  allowCloudWriterFallback?: boolean;
  lastTestOk?: boolean;
}

export interface SavedGatewayModelProfile {
  id: string;
  label: string;
  providerId: string;
  baseUrl: string;
  modelName: string;
  timeoutSeconds: number;
  contextTokens?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  minTokens?: number;
  noRepeatNgramSize?: number;
  seed?: number;
  lastTestOk?: boolean;
}

export interface AiSettings {
  runtimeMode: AiRuntimeMode;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  /** Saved Cloud API models shown as settings cards. Keys stay in session memory. */
  savedApiModels?: SavedApiModelProfile[];
  activeSavedApiModelId?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  /** User-configured USD price for one million input tokens. */
  inputPricePerMillionTokens?: number;
  /** User-configured USD price for one million output tokens. */
  outputPricePerMillionTokens?: number;
  /** Maximum real-provider requests started inside a rolling minute. */
  maxRequestsPerMinute?: number;
  /** Maximum real-provider requests active across the desktop SQLite database. */
  maxConcurrentAiRequests?: number;
  /** Optional hard daily input + output token budget. */
  dailyTokenBudget?: number;
  /** Optional hard daily estimated USD budget. Requires both token prices. */
  dailyCostBudgetUsd?: number;
  /** Percentage at which the settings page reports a budget warning. */
  budgetWarningPercent?: number;
  /** Optional task-specific local model used only for chapter prose generation. */
  localChapterModel?: LocalChapterModelSettings;
  savedLocalModels?: SavedLocalModelProfile[];
  activeSavedLocalModelId?: string;
  /** Optional dedicated AI Model Gateway / Remote OpenAI-compatible model endpoint. */
  gateway?: GatewayModelConfig;
  savedGatewayModels?: SavedGatewayModelProfile[];
  activeSavedGatewayModelId?: string;
  /** Deprecated alias for gateway compatibility */
  remoteWriter?: GatewayModelConfig;
  mockMode: boolean; // 兼容旧字段，从 runtimeMode 派生
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
}

export interface LocalChapterModelSettings {
  enabled: boolean;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  contextTokens: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  minTokens?: number;
  noRepeatNgramSize?: number;
  seed?: number;
  /** When false, a down/training local writer fails closed instead of using the cloud beat contract. */
  allowCloudWriterFallback?: boolean;
}

export interface GatewayModelConfig {
  enabled: boolean;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  contextTokens?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  minTokens?: number;
  noRepeatNgramSize?: number;
  seed?: number;
}

export type AiGatewaySettings = GatewayModelConfig;
export type RemoteWriterSettings = GatewayModelConfig;

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
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  minTokens?: number;
  noRepeatNgramSize?: number;
  seed?: number;
  /** Provider-supported thinking toggle for narrowly scoped governed tasks. */
  thinkingMode?: 'enabled' | 'disabled';
  promptTemplateSource?: string;
  promptDebug?: ChapterPromptDebugInfo;
}

export interface AiGenerateResponse {
  text: string;
  raw?: unknown;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  finishReason?: string;
  usageCost?: AiUsageCost;
}

export type AiCostStatus = 'complete' | 'mock' | 'unpriced' | 'usage_missing';

export interface AiPricingSnapshot {
  currency: 'USD';
  source: 'user_configured' | 'mock' | 'unconfigured';
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
}

export interface AiUsageCost extends AiPricingSnapshot {
  status: AiCostStatus;
  estimatedCost?: number;
}

export type AiStreamEvent =
  | { type: 'started'; requestId: string }
  | { type: 'delta'; requestId: string; sequence: number; text: string }
  | {
      type: 'usage';
      requestId: string;
      tokenInput?: number;
      tokenOutput?: number;
      tokenTotal?: number;
    }
  | { type: 'completed'; requestId: string; finishReason?: string }
  | { type: 'error'; requestId: string; code: string };

export interface AiGenerateOptions {
  signal?: AbortSignal;
  requestId?: string;
  /** Process-local owner used by the AI task center to stop an active execution. */
  cancel?: () => void;
  /** Request an OpenAI-compatible SSE response while preserving the aggregated return value. */
  stream?: boolean;
  /** Receives transient stream events. Callers must persist only the final generate() result. */
  onStreamEvent?: (event: AiStreamEvent) => void;
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
  | 'chapter_beat_repair'
  | 'chapter_scene_generate'
  | 'chapter_scene_plan_generate'
  | 'chapter_rewrite'
  | 'chapter_polish'
  | 'quality_check'
  | 'quality_fix'
  | 'multi_agent_review'
  | 'multi_agent_revision'
  | 'autonomous_plot_plan'
  | 'autonomous_character_evolution'
  | 'autonomous_world_build'
  | 'autonomous_conflict_generate'
  | 'autonomous_pacing_control'
  | 'autonomous_chapter_batch'
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
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
  costEstimate?: number;
  costCurrency?: 'USD';
  costStatus?: AiCostStatus;
  pricingSource?: AiPricingSnapshot['source'];
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
  chapter_beat_repair: '单 Beat 外部修稿',
  chapter_scene_generate: '章节场景正文',
  chapter_scene_plan_generate: 'Scene/Beat 规划候选',
  chapter_rewrite: '章节重写',
  chapter_polish: '章节润色',
  quality_check: '质量检查',
  quality_fix: 'AI修稿',
  multi_agent_review: 'Multi-Agent 专家评审',
  multi_agent_revision: 'Multi-Agent 候选修订',
  autonomous_plot_plan: 'Plot Planner 全书规划',
  autonomous_character_evolution: 'Character Evolution 人物弧线',
  autonomous_world_build: 'World Builder 世界扩展',
  autonomous_conflict_generate: 'Conflict Generator 冲突设计',
  autonomous_pacing_control: 'Pacing Controller 节奏控制',
  autonomous_chapter_batch: 'Plot Planner 章节批次',
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
  'event' | 'character' | 'conflict' | 'turning_point' | 'ending' | 'setting' | 'other';

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
  worldSettingSources?: Array<{
    id: string;
    title: string;
    role: 'primary' | 'supplemental';
    updatedAt: string;
  }>;
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
  characterStates?: string;
  characterStateSources?: Array<{
    id: string;
    characterId: string;
    characterName: string;
    chapterId?: string;
    origin: 'character_state' | 'character_current_state';
  }>;
  chapterEvents?: string;
  chapterSettings?: string;
  /** Read-time projection from persisted adopted summaries and ContextRecords. */
  worldStateTimeline?: string;
  worldStateTimelineSource?: {
    latestChapterId: string;
    chapterCount: number;
    sourceSummaryIds: string[];
    sourceContextRecordIds: string[];
  };
  previousContext?: string;
  userInstruction?: string;
  /** 当前草稿正文（重新生成/改写模式时传入） */
  draftContent?: string;
  chapterOutlineSource?: 'active_chapter_outline' | 'chapter_field' | 'draft' | 'empty';
  volumeOutlineSource?: 'active_outline' | 'volume_field' | 'none';
  masterOutlineSource?: 'active_outline' | 'novel_field' | 'novel_description' | 'none';
  /** Optional context sources that could not be read while this context was built. */
  contextWarnings?: string[];
}
