// src/agent-tools/tool-types.ts
// AI Novel Studio — Agent Tool 基础类型
// 版本：v1.0.44
// 用途：定义 Agent Tool 的统一返回类型和上下文类型
// 注意：只做类型定义，不连接真实业务

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
}

/**
 * Agent Tool 执行上下文
 * 当前版本仅携带可选 ID，不包含实际数据访问能力
 */
export interface AgentToolContext {
  /** 项目 ID（可选） */
  projectId?: string;
  /** 章节 ID（可选） */
  chapterId?: string;
  /** 是否为 dry-run 模式（不产生副作用） */
  dryRun?: boolean;
}

/**
 * 创建一个 "not implemented" 结果
 */
export function notImplemented<T>(
  toolName: string
): AgentToolResult<T> {
  return {
    ok: false,
    error: `Tool '${toolName}' is not yet implemented (v1.0.44 placeholder)`,
  };
}
