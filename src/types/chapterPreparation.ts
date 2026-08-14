// DSH 融合 — 章节准备提案类型（设计文档 §6 镜像；与 Rust 侧
// src-tauri/src/services/dsh/models.rs 逐字段一致，camelCase 线上名）。

export const CHAPTER_PREPARATION_SOURCES = [
  'outline',
  'chapter_context',
  'style_profile',
  'output_control',
  'character_states',
  'memory_index',
] as const;

export type ChapterBaselineSource = (typeof CHAPTER_PREPARATION_SOURCES)[number];

export type ChapterPreparationPlanner = 'current_chapter_readiness_v1' | 'dsh_spike_v0';

export interface ChapterBaselineRevision {
  source: ChapterBaselineSource;
  revision: number;
}

export interface ChapterPreparationInput {
  novelId: string;
  chapterId: string;
  /** 调用方已知的各来源当前修订号；Proposal 必须原样回显且与其一致。 */
  baselineRevisions: ChapterBaselineRevision[];
}

export interface TargetChapter {
  novelId: string;
  chapterId: string;
}

export interface RetrievedEvidenceItem {
  source: ChapterBaselineSource;
  /** 必须与 baselineRevisions 中对应来源一致。 */
  revision: number;
  summary: string;
  detailRef?: string;
}

export interface ScenePlanItem {
  title: string;
  purpose: string;
  conflicts?: string[];
}

export interface CharacterConstraintItem {
  characterId: string;
  constraint: string;
}

export type ContinuitySeverity = 'low' | 'medium' | 'high';

export interface ContinuityRiskItem {
  kind: string;
  description: string;
  severity: ContinuitySeverity;
}

export type RecommendedActionType = 'read_tool' | 'ask_user';

export interface RecommendedActionItem {
  /** 只允许 read_tool / ask_user；任何写动作会被校验器整体拒绝。 */
  type: RecommendedActionType;
  target?: string;
  description: string;
}

export interface PlannerCoercion {
  /** 模型原始输出的拼写值。 */
  original: string;
  distance: number;
}

export interface ProposalMetrics {
  planner: ChapterPreparationPlanner;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  toolCallCount?: number;
  processRestarts?: number;
  /** 归一标记：adapter 修正了模型输出的 planner 枚举（绝不静默）。 */
  plannerCoerced?: PlannerCoercion | false;
}

export interface ChapterPreparationProposal {
  schemaVersion: 1;
  planner: ChapterPreparationPlanner;
  targetChapter: TargetChapter;
  baselineRevisions: ChapterBaselineRevision[];
  retrievedEvidence: RetrievedEvidenceItem[];
  chapterGoals: string[];
  scenePlan: ScenePlanItem[];
  characterConstraints: CharacterConstraintItem[];
  continuityRisks: ContinuityRiskItem[];
  unresolvedQuestions: string[];
  recommendedActions: RecommendedActionItem[];
  producedAt: string;
  metrics: ProposalMetrics;
}

/** 两个实现共用端口：CurrentPlannerAdapter（确定性，零模型成本）与 DshPlannerAdapter（进程外 DSH）。 */
export interface ChapterPreparationPlannerPort {
  prepare(
    input: ChapterPreparationInput,
    options?: ChapterPreparationPlannerOptions,
  ): Promise<ChapterPreparationProposal>;
}

/** 仅 DshPlannerAdapter 使用：DeepSeek 凭据与可选覆盖。 */
export interface ChapterPreparationPlannerOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}
