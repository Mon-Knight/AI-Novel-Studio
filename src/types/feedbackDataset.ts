/**
 * Human Feedback & SFT/DPO Dataset Collector - Domain Types
 * 创作反馈样本捕获、微调数据清洗与全格式训练集导出契约
 */

/** 反馈样本微调类型 */
export type FeedbackSampleType =
  | 'sft_demonstration' // SFT 优质人类示范样本 (Instruction -> Final Text)
  | 'dpo_preference'; // DPO 人类偏好对 (Prompt, Chosen=Final, Rejected=Initial)

/** 反馈样本来源动作 */
export type FeedbackSource =
  | 'editor_manual_edit' // 编辑器人工修改润色
  | 'chapter_adopt' // 章节草稿最终采用
  | 'multi_agent_revision' // 多智能体专家审阅修订
  | 'quality_gate_repair'; // 质量门禁修复后采用

/** 数据集导出目标格式 */
export type DatasetExportFormat =
  | 'jsonl' // 标准 JSONL 格式 (支持 SFT 与 DPO 对)
  | 'sharegpt' // ShareGPT 对话格式 (from human / gpt)
  | 'openai_chat'; // OpenAI Chat Completions 训练格式 (messages array)

/** 创作反馈数据样本 */
export interface FeedbackSample {
  /** 样本唯一标识 (如 "fb-chap-001-v1-178...") */
  sampleId: string;
  /** 所属小说 ID */
  novelId: string;
  /** 所属章节 ID */
  chapterId: string;
  /** 关联的分镜 Scene ID (可选) */
  sceneId?: string;
  /** 样本来源动作 */
  source: FeedbackSource;
  /** 样本类型 */
  type: FeedbackSampleType;
  /** 输入指令与上下文 Prompt */
  prompt: string;
  /** 系统前置指令 System Prompt */
  systemPrompt?: string;
  /** 初始 AI 生成内容 (作为 DPO Rejected 或对比基准) */
  initialAiOutput: string;
  /** 人工修改/采纳后的最终正文 (作为 SFT 目标或 DPO Chosen) */
  finalHumanOutput: string;
  /** 修改字符绝对差值 */
  charDifference: number;
  /** 修改幅度比例 (0.0 ~ 1.0) */
  editRatio: number;
  /** 质量评审评分 (如有) */
  qualityScore?: number;
  /** 标签与元数据分类 (如 ['xianxia', 'pov_fixed', 'scene_beat']) */
  tags?: string[];
  /** 捕获时间戳 (ISO 8601) */
  createdAt: string;
}

/** 捕获反馈样本输入参数 */
export interface CaptureFeedbackInput {
  novelId: string;
  chapterId: string;
  sceneId?: string;
  source: FeedbackSource;
  prompt: string;
  systemPrompt?: string;
  initialAiOutput: string;
  finalHumanOutput: string;
  qualityScore?: number;
  tags?: string[];
}

/** 数据集导出参数选项 */
export interface ExportDatasetOptions {
  /** 导出格式 */
  format: DatasetExportFormat;
  /** 过滤指定小说 ID (留空表示全部小说) */
  novelId?: string;
  /** 样本类型过滤 (sft / dpo / 全部) */
  sampleType?: FeedbackSampleType;
  /** 最小修改幅度阈值 (默认 0.02，过滤纯标点/空格改动) */
  minEditRatio?: number;
  /** 最大修改幅度阈值 (默认 0.98，过滤完全重写无关文本) */
  maxEditRatio?: number;
}

/** 数据集统计指标 */
export interface DatasetStatistics {
  /** 总样本数 */
  totalSamples: number;
  /** SFT 样本数量 */
  sftSamplesCount: number;
  /** DPO 偏好对数量 */
  dpoSamplesCount: number;
  /** 沉淀的总词数 */
  totalWords: number;
  /** 平均修改幅度比例 (0~1) */
  avgEditRatio: number;
}
