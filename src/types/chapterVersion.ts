/**
 * Chapter Version & Provenance System - Domain Types
 * 章节版本控制、Diff 比对与创作全链路溯源存证
 */

/** 章节版本生成/修改来源 */
export type ChapterRevisionSource =
  | 'ai_generation' // AI 初稿/正文生成
  | 'ai_revision' // AI 多智能体/专家评审修订
  | 'user_edit' // 用户人工直接编辑修改
  | 'safe_apply' // Safe Apply 决策采用合入
  | 'rollback'; // 从历史版本安全回滚

/** 章节版本标签 */
export type ChapterRevisionTag =
  | 'final' // 终稿 (采用并定稿)
  | 'adopted' // 当前采用中
  | 'candidate' // 候选待审阅版本
  | 'draft' // 草稿阶段
  | 'archived'; // 归档历史版本

/** 创作溯源元数据存证 */
export interface ChapterRevisionProvenance {
  /** 负责生成的模型标识（如 qwen3.8-27b-writer / deepseek-chat） */
  modelId?: string;
  /** 服务提供商（如 local / ai_gateway / deepseek） */
  providerId?: string;
  /** 路由决策原因（如 local_available / remote_gateway_fallback / cloud_writer_primary） */
  routeReason?: string;
  /** 生成时使用的提示词快照或模板 ID */
  promptSnapshot?: string;
  /** 上下文编译 SHA-256 哈希值 */
  compilationHash?: string;
  /** 关联的记忆快照版本号 */
  memorySnapshotVersion?: number;
  /** 关联的分镜 Scene ID */
  sceneId?: string;
  /** 关联的 Beat 顺序号 */
  beatOrder?: number;
  /** 操作作者或发起人 */
  author?: string;
}

/** 章节不可变版本记录 */
export interface ChapterRevision {
  /** 版本唯一标识 (如 "rev-chap-01-v1") */
  revisionId: string;
  /** 所属章节 ID */
  chapterId: string;
  /** 所属小说 ID */
  novelId: string;
  /** 自增版本号 (1, 2, 3...) */
  revisionNumber: number;
  /** 版本标题/章节名 */
  title: string;
  /** 本版本章节正文完整内容 */
  content: string;
  /** 字数 (词数) */
  wordCount: number;
  /** 纯字符数 */
  characterCount: number;
  /** 版本来源 */
  source: ChapterRevisionSource;
  /** 版本标签 */
  tag: ChapterRevisionTag;
  /** 是否为当前采用版本 */
  isAdopted: boolean;
  /** 创作全链路溯源存证 */
  provenance: ChapterRevisionProvenance;
  /** 版本变更描述或修订摘要 */
  summary?: string;
  /** 创建时间戳 (ISO 8601) */
  createdAt: string;
}

/** Diff 差异块 */
export interface RevisionDiffChunk {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
  fromLineNo?: number;
  toLineNo?: number;
}

/** 两个版本间的 Diff 对比分析结果 */
export interface RevisionDiff {
  fromRevisionId: string;
  toRevisionId: string;
  fromRevisionNumber: number;
  toRevisionNumber: number;
  addedCharacters: number;
  removedCharacters: number;
  addedLines: number;
  removedLines: number;
  diffChunks: RevisionDiffChunk[];
  summary: string;
}

/** 章节版本创建输入参数 */
export interface CreateChapterRevisionInput {
  chapterId: string;
  novelId: string;
  title: string;
  content: string;
  source: ChapterRevisionSource;
  tag?: ChapterRevisionTag;
  isAdopted?: boolean;
  provenance?: ChapterRevisionProvenance;
  summary?: string;
}

/** 章节版本历史聚合结构 */
export interface ChapterVersionHistory {
  chapterId: string;
  novelId: string;
  currentRevisionId?: string;
  adoptedRevisionId?: string;
  totalRevisions: number;
  revisions: ChapterRevision[];
}
