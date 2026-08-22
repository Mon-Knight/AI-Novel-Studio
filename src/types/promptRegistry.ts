/**
 * Prompt Template Registry & Model-Adaptive Engine - Domain Types
 * 提示词模板声明式注册与多模型家族动态适配契约
 */

/** 提示词应用场景分类 */
export type PromptTemplateCategory =
  | 'scene_generation' // 场景分镜创作
  | 'beat_generation' // Beat 逐段推进
  | 'multi_agent_review' // 多智能体专家评审
  | 'memory_extraction' // 记忆状态演化抽取
  | 'quality_check' // 章节质量诊断
  | 'character_evolution' // 角色演进分析
  | 'story_planning' // 大纲与情节点规划
  | 'custom'; // 自定义扩展场景

/** 模型家族归属分类 */
export type ModelFamily =
  | 'qwen' // 通义千问/Qwen 系列（如 Qwen3.8-27B 写作模型）
  | 'deepseek' // DeepSeek 系列（如 DeepSeek-V3 / R1 推理模型）
  | 'claude' // Anthropic Claude 系列
  | 'openai_compatible' // 标准 OpenAI-Compatible 网关/GPT 系列
  | 'generic'; // 通用大语言模型

/** 模板变量定义 */
export interface PromptTemplateVariable {
  /** 变量名（在模板中对应 {{name}}） */
  name: string;
  /** 是否必填 */
  required: boolean;
  /** 变量用途描述 */
  description?: string;
  /** 默认值（未传入时回退） */
  defaultValue?: string;
  /** 示例值 */
  example?: string;
}

/** 针对特定模型家族的专属适配规则 */
export interface ModelAdaptationRule {
  /** 目标模型家族 */
  modelFamily: ModelFamily;
  /** 注入的系统前置指令 */
  systemInstructionPrefix?: string;
  /** 注入的尾部格式约束提示 */
  formatSuffix?: string;
  /** 输出硬约束（如严格禁止套话、严格 JSON 格式等） */
  outputConstraints?: string;
  /** 推荐的最大 Token 上限指引 */
  maxTokensGuide?: number;
}

/** 提示词模板定义契约 */
export interface PromptTemplate {
  /** 模板唯一标识 (如 "scene_generation_v1") */
  templateId: string;
  /** 模板名称 */
  name: string;
  /** 场景分类 */
  category: PromptTemplateCategory;
  /** 语义化版本号 (如 "1.0.0") */
  version: string;
  /** 模板设计目标与说明 */
  description: string;
  /** 模板正文（支持 {{variable}} 与条件块 {{#var}}...{{/var}}） */
  templateText: string;
  /** 模板变量清单 */
  variables: PromptTemplateVariable[];
  /** 针对各模型家族的动态适配规则表 */
  adaptations?: Partial<Record<ModelFamily, ModelAdaptationRule>>;
  /** 是否为系统官方内置模板 */
  isOfficial: boolean;
}

/** 提示词渲染选项 */
export interface RenderPromptOptions {
  /** 显式指定目标模型家族（未指定时尝试从 modelName 推断） */
  modelFamily?: ModelFamily;
  /** 目标模型名称（如 "qwen3.8-27b-writer" 或 "deepseek-chat"） */
  modelName?: string;
  /** 是否开启严格变量检查（默认 true） */
  strict?: boolean;
}

/** 编译渲染后的提示词载荷 */
export interface CompiledPromptPayload {
  /** 使用的模板 ID */
  templateId: string;
  /** 使用的模板版本号 */
  version: string;
  /** 匹配的目标模型家族 */
  modelFamily: ModelFamily;
  /** 组装后的 System Prompt */
  systemPrompt: string;
  /** 组装后的 User Prompt */
  userPrompt: string;
  /** 实际注入的变量键值快照 */
  renderedVariables: Record<string, string>;
  /** 提示词内容的确定性 SHA-256 哈希值（用于审计与版本溯源） */
  hash: string;
}
