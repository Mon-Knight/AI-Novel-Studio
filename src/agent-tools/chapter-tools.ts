// src/agent-tools/chapter-tools.ts
// AI Novel Studio — 章节相关 Agent Tools
// 版本：v1.0.44
// 用途：提供章节大纲读取和草稿保存的 Tool 占位接口
// 注意：当前返回 not implemented，不允许直接修改正式正文

import type { AgentToolResult, AgentToolContext } from "./tool-types";
import { notImplemented } from "./tool-types";

/**
 * 读取章节大纲
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 当前返回 not implemented
 */
export async function readChapterOutline(
  context: AgentToolContext
): Promise<AgentToolResult> {
  void context;
  return notImplemented("readChapterOutline");
}

/**
 * 保存候选草稿
 *
 * 重要：本函数只保存为"候选草稿"，不直接覆盖正式正文。
 * 用户确认采用后才成为正式正文。
 *
 * @param context - Agent Tool 执行上下文
 * @param draft - 草稿文本内容
 * @returns Promise<AgentToolResult> — 当前返回 not implemented
 */
export async function saveCandidateDraft(
  context: AgentToolContext,
  draft: string
): Promise<AgentToolResult> {
  void context;
  void draft;
  return notImplemented("saveCandidateDraft");
}
