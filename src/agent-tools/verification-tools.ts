// src/agent-tools/verification-tools.ts
// AI Novel Studio — 验证相关 Agent Tools
// 版本：v1.0.44
// 用途：提供大纲符合度和风格符合度验证的 Tool 占位接口
// 注意：当前返回 not implemented，不允许自动修改正文

import type { AgentToolResult, AgentToolContext } from "./tool-types";
import { notImplemented } from "./tool-types";

/**
 * 验证大纲符合度
 * 检查生成的正文是否符合章节大纲要求
 *
 * @param context - Agent Tool 执行上下文
 * @param draft - 待验证的草稿文本
 * @returns Promise<AgentToolResult> — 当前返回 not implemented
 */
export async function verifyOutlineCompliance(
  context: AgentToolContext,
  draft: string
): Promise<AgentToolResult> {
  void context;
  void draft;
  return notImplemented("verifyOutlineCompliance");
}

/**
 * 验证风格符合度
 * 检查生成的正文是否符合风格方案约束
 *
 * @param context - Agent Tool 执行上下文
 * @param draft - 待验证的草稿文本
 * @returns Promise<AgentToolResult> — 当前返回 not implemented
 */
export async function verifyStyleCompliance(
  context: AgentToolContext,
  draft: string
): Promise<AgentToolResult> {
  void context;
  void draft;
  return notImplemented("verifyStyleCompliance");
}
