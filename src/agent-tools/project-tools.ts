// src/agent-tools/project-tools.ts
// AI Novel Studio — 项目相关 Agent Tools
// 版本：v1.0.44
// 用途：提供项目上下文的 Tool 占位接口
// 注意：当前返回 not implemented，后续版本再连接真实数据

import type { AgentToolResult, AgentToolContext } from "./tool-types";
import { notImplemented } from "./tool-types";

/**
 * 读取项目上下文
 * 包括：世界设定、规则体系、主角信息
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 当前返回 not implemented
 */
export async function readProjectContext(
  context: AgentToolContext
): Promise<AgentToolResult> {
  // v1.0.44: 占位实现
  // 后续 v1.0.45 将接入真实项目数据读取
  void context; // 显式标记参数暂未使用
  return notImplemented("readProjectContext");
}
