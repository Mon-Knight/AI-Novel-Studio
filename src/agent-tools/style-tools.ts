// src/agent-tools/style-tools.ts
// AI Novel Studio — 风格方案相关 Agent Tools（只读）
// 版本：v1.0.46
// 用途：提供风格方案/输出控制的只读 Tool 接口
// 安全：只读，不创建/修改/删除风格方案

import type { AgentToolResult, AgentToolContext } from "./tool-types";
import { errorResult, resolveNovelId, successResult } from "./tool-types";
import { styleProfileService } from "../services/styles/styleProfileService";
import { outputProfileService } from "../services/styles/outputProfileService";

/**
 * 读取风格方案
 * 包括：风格名称、叙事人称、节奏、对话/描写比例、禁用写法等
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 风格方案信息
 */
export async function readStyleProfile(
  context: AgentToolContext
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult("缺少作品 ID（projectId / novelId）以读取风格方案", {
      source: "tool-layer",
    });
  }

  try {
    // 尝试获取激活的风格方案
    let activeStyle: unknown = null;
    let allStyles: unknown[] = [];
    const warnings: string[] = [];

    try {
      allStyles = await styleProfileService.getAll(novelId);
    } catch {
      warnings.push("无法读取风格方案列表");
    }

    // 查找激活的风格方案
    if (allStyles && allStyles.length > 0) {
      const active = (allStyles as Record<string, unknown>[]).find(
        (s) => s.isActive === true || s.isActive === 1
      );
      if (active) {
        activeStyle = {
          id: active.id,
          name: active.name,
          narrativePerspective: active.narrativePerspective ?? "未指定",
          tone: active.tone ?? "未指定",
          pace: active.pace ?? "未指定",
          dialogueRatio: active.dialogueRatio ?? 0,
          descriptionRatio: active.descriptionRatio ?? 0,
          battleStyle: active.battleStyle ?? "未指定",
          battleIntensity: active.battleIntensity ?? "未指定",
          emotionTendency: active.emotionTendency ?? "未指定",
          forbiddenStyles: active.forbiddenStyles ?? [],
          sourceType: active.sourceType ?? "unknown",
          styleSummary: active.styleSummary ?? "",
        };
      } else {
        warnings.push("未找到激活的风格方案，将使用第一个可用方案");
        const first = (allStyles as Record<string, unknown>[])[0];
        if (first) {
          activeStyle = {
            id: first.id, name: first.name, sourceType: first.sourceType,
          };
        }
      }
    } else {
      warnings.push("该作品没有已配置的风格方案");
    }

    // 风格方案计数
    const styleCount = (allStyles as unknown[]).length;

    return successResult(
      {
        activeStyle,
        styleCount,
        hasActiveStyle: activeStyle !== null,
      },
      {
        source: "database",
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    );
  } catch (err) {
    return errorResult(
      `读取风格方案失败: ${err instanceof Error ? err.message : String(err)}`,
      { source: "database" }
    );
  }
}

/**
 * 读取输出控制配置
 * 包括：目标字数、叙事视角、时态、结尾钩子要求等
 *
 * @param context - Agent Tool 执行上下文
 * @returns Promise<AgentToolResult> — 输出控制配置信息
 */
export async function readOutputControl(
  context: AgentToolContext
): Promise<AgentToolResult<Record<string, unknown>>> {
  const novelId = resolveNovelId(context);
  if (!novelId) {
    return errorResult("缺少作品 ID", { source: "tool-layer" });
  }

  try {
    const warnings: string[] = [];
    let profiles: unknown[] = [];

    try {
      profiles = await outputProfileService.getAll(novelId);
    } catch {
      warnings.push("无法读取输出控制方案");
    }

    if (profiles.length === 0) {
      warnings.push("该作品没有输出控制方案");
      return successResult(
        { profiles: [], count: 0, hasDefault: false },
        { source: "database", warnings }
      );
    }

    const defaultProfile = (profiles as Record<string, unknown>[]).find(
      (p) => p.isDefault === true || p.isDefault === 1
    );
    const activeProfile = defaultProfile ?? (profiles as Record<string, unknown>[])[0];

    return successResult(
      {
        activeProfile: activeProfile
          ? {
              id: activeProfile.id,
              name: activeProfile.name,
              targetWordCount: activeProfile.targetWordCount ?? 0,
              minWordCount: activeProfile.minWordCount ?? 0,
              maxWordCount: activeProfile.maxWordCount ?? 0,
              paceLevel: activeProfile.paceLevel ?? "medium",
              dialogueRatio: activeProfile.dialogueRatio ?? 0.35,
              descriptionRatio: activeProfile.descriptionRatio ?? 0.4,
              povType: activeProfile.povType ?? "未指定",
              tenseType: activeProfile.tenseType ?? "未指定",
              endingHookRequired: activeProfile.endingHookRequired ?? true,
              battleIntensity: activeProfile.battleIntensity ?? "未指定",
            }
          : null,
        count: profiles.length,
        hasDefault: defaultProfile !== undefined,
      },
      {
        source: "database",
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    );
  } catch (err) {
    return errorResult(
      `读取输出控制失败: ${err instanceof Error ? err.message : String(err)}`,
      { source: "database" }
    );
  }
}
