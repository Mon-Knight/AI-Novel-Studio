// src/agent-tools/tool-types.ts
// AI Novel Studio — Agent Tool 基础类型
// 版本：v1.0.46
// 用途：定义 Agent Tool 的统一返回类型和上下文类型
// 注意：增强版，支持 warnings / source / AgentReadableSummary

/**
 * Agent Tool 统一返回类型
 * @template T - 工具返回的数据类型
 */
export interface AgentToolResult<T = unknown> {
  /** 操作是否成功 */
  ok: boolean;
  /** 成功时的返回数据 */
  data?: T;
  /** 失败时的错误信息 */
  error?: string;
  /** 数据来源标识（如 "sqlite", "localStorage", "mock"） */
  source?: string;
  /** 非致命警告信息 */
  warnings?: string[];
}

/**
 * Agent Tool 执行上下文
 * v1.0.46: 扩展支持 novelId / styleProfileId / workId
 */
export interface AgentToolContext {
  /** 项目/作品 ID */
  projectId?: string;
  /** 作品 ID（别名，与 projectId 等效） */
  novelId?: string;
  /** 工作 ID（通用于作品或项目） */
  workId?: string;
  /** 章节 ID */
  chapterId?: string;
  /** 风格方案 ID */
  styleProfileId?: string;
  /** 是否为 dry-run 模式（不产生副作用） */
  dryRun?: boolean;
}

/**
 * Agent 可读摘要
 * v1.0.46: 新增，用于 context-tools 输出
 */
export interface AgentReadableSummary {
  /** 摘要标题 */
  title: string;
  /** 摘要正文 */
  summary: string;
  /** 非致命警告 */
  warnings?: string[];
}

/**
 * 创建一个 "not implemented" 结果
 */
export function notImplemented<T>(toolName: string): AgentToolResult<T> {
  return {
    ok: false,
    error: `Tool '${toolName}' is not yet implemented`,
    source: 'placeholder',
  };
}

/**
 * 创建一个成功的工具结果
 */
export function successResult<T>(
  data: T,
  options?: { source?: string; warnings?: string[] },
): AgentToolResult<T> {
  return {
    ok: true,
    data,
    source: options?.source ?? 'unknown',
    warnings: options?.warnings,
  };
}

/**
 * 创建一个失败的工具结果
 */
export function errorResult(
  error: string,
  options?: { source?: string; warnings?: string[] },
): AgentToolResult<never> {
  return {
    ok: false,
    error,
    source: options?.source ?? 'unknown',
    warnings: options?.warnings,
  };
}

/**
 * 解析 AgentToolContext 中的 novelId
 * 支持 projectId / novelId / workId 三种命名
 */
export function resolveNovelId(context: AgentToolContext): string | undefined {
  return context.projectId ?? context.novelId ?? context.workId;
}
