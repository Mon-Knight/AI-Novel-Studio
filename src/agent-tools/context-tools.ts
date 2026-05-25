// src/agent-tools/context-tools.ts
// AI Novel Studio — 上下文聚合 Agent Tools（只读）
// 版本：v1.0.46
// 用途：把项目、章节、风格信息聚合为 Agent 可读上下文摘要
// 安全：只读聚合，不调用外部 AI，不写数据库，不生成正文

import type {
  AgentToolResult,
  AgentToolContext,
  AgentReadableSummary,
} from "./tool-types";
import { errorResult, resolveNovelId, successResult } from "./tool-types";
import { readProjectContext } from "./project-tools";
import { readChapterContext } from "./chapter-tools";
import { readStyleProfile } from "./style-tools";
import { readOutputControl } from "./style-tools";

/**
 * 构建 Agent 可读上下文摘要
 * 组合项目、章节、风格信息，输出一份结构化的中文摘要
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult<AgentReadableSummary>> — Agent 可读摘要
 */
export async function buildAgentReadableContext(
  context: AgentToolContext
): Promise<AgentToolResult<AgentReadableSummary>> {
  const novelId = resolveNovelId(context);
  const chapterId = context.chapterId;

  if (!novelId && !chapterId) {
    return errorResult("至少需要提供作品 ID 或章节 ID", {
      source: "tool-layer",
    });
  }

  const allWarnings: string[] = [];

  // 并行读取三个数据源
  const [projectResult, chapterResult, styleResult] = await Promise.all([
    novelId
      ? readProjectContext({ novelId })
      : Promise.resolve({ ok: false, error: "未提供作品 ID" } as AgentToolResult),
    chapterId
      ? readChapterContext({ chapterId, novelId })
      : Promise.resolve({ ok: false, error: "未提供章节 ID" } as AgentToolResult),
    novelId
      ? readStyleProfile({ novelId })
      : Promise.resolve({ ok: false, error: "未提供作品 ID" } as AgentToolResult),
  ]);

  // 收集警告
  if (projectResult.warnings) allWarnings.push(...projectResult.warnings);
  if (chapterResult.warnings) allWarnings.push(...chapterResult.warnings);
  if (styleResult.warnings) allWarnings.push(...styleResult.warnings);

  // 构建摘要
  const lines: string[] = [];

  // 项目摘要
  const pData = projectResult.data as Record<string, unknown> | undefined;
  if (pData?.novel) {
    const novel = pData.novel as Record<string, unknown>;
    lines.push(
      `【作品】${novel.title ?? "未命名"}  (ID: ${novel.id ?? "?"})`
    );
    if (novel.status) lines.push(`  状态: ${novel.status}`);
    if (typeof novel.totalWordCount === "number") {
      lines.push(`  总字数: ${novel.totalWordCount.toLocaleString()}`);
    }
  } else {
    lines.push("【作品】未读取到作品信息");
    allWarnings.push("作品上下文缺失");
  }

  // 章节摘要
  const cData = chapterResult.data as Record<string, unknown> | undefined;
  if (cData?.chapter) {
    const ch = cData.chapter as Record<string, unknown>;
    lines.push(
      `\n【章节】${ch.title ?? "未命名"}  (ID: ${ch.id ?? "?"})`
    );
    if (ch.status) lines.push(`  状态: ${ch.status}`);
    if (typeof ch.targetWordCount === "number") {
      lines.push(`  目标字数: ${ch.targetWordCount.toLocaleString()}`);
    }
    if (typeof ch.wordCount === "number" && ch.wordCount > 0) {
      lines.push(`  当前字数: ${(ch.wordCount as number).toLocaleString()}`);
    }
    if (cData.chapterCharacters) {
      const chars = cData.chapterCharacters as unknown[];
      if (Array.isArray(chars) && chars.length > 0) {
        lines.push(`  出场角色: ${chars.length} 人`);
      }
    }
    if (cData.chapterEvents) {
      const events = cData.chapterEvents as unknown[];
      if (Array.isArray(events) && events.length > 0) {
        lines.push(`  章节事件: ${events.length} 个`);
      }
    }
  } else {
    lines.push("\n【章节】未读取到章节信息");
    allWarnings.push("章节上下文缺失");
  }

  // 风格摘要
  const sData = styleResult.data as Record<string, unknown> | undefined;
  if (sData?.activeStyle) {
    const style = sData.activeStyle as Record<string, unknown>;
    lines.push(
      `\n【风格】${style.name ?? "未命名"}  (ID: ${style.id ?? "?"})`
    );
    if (style.narrativePerspective && style.narrativePerspective !== "未指定") {
      lines.push(`  叙事人称: ${style.narrativePerspective}`);
    }
    if (style.pace && style.pace !== "未指定") {
      lines.push(`  节奏: ${style.pace}`);
    }
    if (typeof style.dialogueRatio === "number") {
      lines.push(`  对话比例: ${style.dialogueRatio}%`);
    }
    if (typeof style.descriptionRatio === "number") {
      lines.push(`  描写比例: ${style.descriptionRatio}%`);
    }
    if (style.forbiddenStyles) {
      const fb = style.forbiddenStyles as string[];
      if (Array.isArray(fb) && fb.length > 0) {
        lines.push(`  禁用写法: ${fb.join(", ")}`);
      }
    }
  } else {
    lines.push("\n【风格】未配置风格方案");
    allWarnings.push("风格方案缺失");
  }

  // 输出控制
  if (sData && !sData.activeStyle) {
    lines.push("\n【输出控制】未配置");
  }

  // 缺失项提醒
  const missingItems: string[] = [];
  if (!pData?.novel) missingItems.push("作品信息");
  if (!cData?.chapter) missingItems.push("章节信息");
  if (!sData?.activeStyle) missingItems.push("风格方案");

  if (missingItems.length > 0) {
    lines.push(`\n【缺失提醒】${missingItems.join("、")}`);
  }

  // 下一步建议
  lines.push("\n【下一步建议】");
  if (missingItems.length > 0) {
    lines.push(`  请先完善: ${missingItems.join("、")}`);
  }
  if (cData?.chapter) {
    const ch = cData.chapter as Record<string, unknown>;
    if (typeof ch.targetWordCount === "number" && (ch.targetWordCount as number) > 0 && typeof ch.wordCount === "number" && (ch.wordCount as number) === 0) {
      lines.push("  本章尚未生成正文，可以开始生成");
    } else if (typeof ch.wordCount === "number" && (ch.wordCount as number) > 0) {
      lines.push("  本章已有正文，可进行润色或质量检查");
    }
  }
  if (pData?.novel && cData?.chapter && sData?.activeStyle) {
    lines.push("  上下文准备就绪，可以触发生成");
  }

  return successResult(
    {
      title: `第 ${
        cData?.chapter
          ? (cData.chapter as Record<string, unknown>).title ?? "?"
          : "?"
      } 章 生成上下文`,
      summary: lines.join("\n"),
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    },
    { source: "tool-layer" }
  );
}
