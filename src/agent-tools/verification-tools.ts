// src/agent-tools/verification-tools.ts
// AI Novel Studio — 验证相关 Agent Tools（基础非 AI 检查）
// 版本：v1.0.46
// 用途：提供大纲符合度和风格符合度的基础检查（不调用外部 AI）
// 安全：只检查，不自动修改正文，不写数据库

import type { AgentToolResult, AgentToolContext } from "./tool-types";
import { errorResult, resolveNovelId, successResult } from "./tool-types";

interface VerificationDetail {
  rule: string;
  passed: boolean;
  message: string;
}

export interface ChapterReadinessMissingItem {
  code: string;
  label: string;
  blocking: boolean;
}

export interface ChapterReadinessResult {
  ready: boolean;
  score: number;
  missing: ChapterReadinessMissingItem[];
  warnings: string[];
  summary: string;
}

function objectData(result: AgentToolResult): Record<string, unknown> | undefined {
  return result.ok && result.data && typeof result.data === "object"
    ? result.data as Record<string, unknown>
    : undefined;
}

/**
 * 对章节生成所需的本地事实执行确定性准备度检查。
 *
 * 该工具只读取当前作品数据，不调用 Provider、不生成正文、不写业务表。
 * Planner 会把结果作为最终只读 checkpoint 保存，用户仍决定是否进入生成。
 */
export async function checkChapterReadiness(
  context: AgentToolContext
): Promise<AgentToolResult<ChapterReadinessResult>> {
  const novelId = resolveNovelId(context);
  const chapterId = context.chapterId;
  if (!novelId || !chapterId) {
    return errorResult("章节准备度检查需要作品 ID 和章节 ID", {
      source: "tool-layer",
    });
  }

  try {
    const [projectResult, outlineResult, contextResult, styleResult, outputResult] =
      await Promise.all([
        import("./project-tools").then(({ readProjectContext }) =>
          readProjectContext({ novelId, chapterId, dryRun: true })),
        import("./chapter-tools").then(({ readChapterOutline }) =>
          readChapterOutline({ novelId, chapterId, dryRun: true })),
        import("./chapter-tools").then(({ readChapterContext }) =>
          readChapterContext({ novelId, chapterId, dryRun: true })),
        import("./style-tools").then(({ readStyleProfile }) =>
          readStyleProfile({ novelId, chapterId, dryRun: true })),
        import("./style-tools").then(({ readOutputControl }) =>
          readOutputControl({ novelId, chapterId, dryRun: true })),
      ]);

    const project = objectData(projectResult);
    const outline = objectData(outlineResult);
    const chapterContext = objectData(contextResult);
    const style = objectData(styleResult);
    const output = objectData(outputResult);
    const missing: ChapterReadinessMissingItem[] = [];
    const warnings = [
      ...(projectResult.warnings ?? []),
      ...(outlineResult.warnings ?? []),
      ...(contextResult.warnings ?? []),
      ...(styleResult.warnings ?? []),
      ...(outputResult.warnings ?? []),
    ];

    const chapter = outline?.chapter as Record<string, unknown> | undefined;
    const projectNovel = project?.novel as Record<string, unknown> | undefined;
    if (!projectNovel || !chapterContext?.chapter) {
      missing.push({ code: "core_context", label: "作品或章节上下文", blocking: true });
    }
    if (!chapter || typeof chapter.outline !== "string" || !chapter.outline.trim()) {
      missing.push({ code: "chapter_outline", label: "章节大纲", blocking: true });
    }
    const worldSettings = project?.worldSettings;
    if (!Array.isArray(worldSettings) || worldSettings.length === 0) {
      missing.push({ code: "world_setting", label: "世界设定", blocking: true });
    }
    const protagonists = project?.protagonists;
    if (!Array.isArray(protagonists) || protagonists.length === 0) {
      missing.push({ code: "protagonist", label: "主角设定", blocking: true });
    }
    if (style?.hasActiveStyle !== true) {
      missing.push({ code: "style_profile", label: "风格方案", blocking: false });
    }
    const outputCount = typeof output?.count === "number" ? output.count : 0;
    if (outputCount === 0) {
      missing.push({ code: "output_profile", label: "输出控制方案", blocking: false });
    }

    const blockingCount = missing.filter((item) => item.blocking).length;
    const optionalCount = missing.length - blockingCount;
    const score = Math.max(0, 100 - blockingCount * 25 - optionalCount * 10);
    const ready = blockingCount === 0;
    const summary = ready
      ? optionalCount === 0
        ? "章节生成所需的核心上下文、风格和输出控制均已准备。"
        : `核心上下文已准备，仍有 ${optionalCount} 项可选配置建议补充。`
      : `尚缺少 ${blockingCount} 项生成前必需信息，请先补齐后再生成正文。`;

    return successResult(
      { ready, score, missing, warnings: [...new Set(warnings)], summary },
      { source: "database" },
    );
  } catch (err) {
    return errorResult(
      `章节准备度检查失败: ${err instanceof Error ? err.message : String(err)}`,
      { source: "database" },
    );
  }
}

/**
 * 验证大纲符合度（基础非 AI 检查）
 *
 * 检查内容：
 * - 是否有章节大纲
 * - 是否有正文草稿
 * - 字数是否明显过短（低于目标的 50%）
 * - 主角名是否出现在正文中
 *
 * @param context - Agent Tool 执行上下文
 * @param draft - 待验证的草稿文本
 * @returns Promise<AgentToolResult> — 验证结果
 */
export async function verifyOutlineCompliance(
  context: AgentToolContext,
  draft: string
): Promise<AgentToolResult<{ details: VerificationDetail[]; passedCount: number; failedCount: number }>> {
  const details: VerificationDetail[] = [];
  const warnings: string[] = [];
  const chapterId = context.chapterId;
  const novelId = resolveNovelId(context);

  if (!chapterId) {
    return errorResult("缺少章节 ID，无法验证大纲符合度", {
      source: "tool-layer",
    });
  }

  try {
    // 1. 检查是否有章节大纲
    const { chapterRepository } = await import(
      "../services/database/chapterRepository"
    );
    const chapter = await chapterRepository.getById(chapterId);
    if (!chapter) {
      details.push({
        rule: "章节存在性",
        passed: false,
        message: `章节 ${chapterId} 不存在`,
      });
      return successResult({ details, passedCount: 0, failedCount: 1 }, {
        source: "database", warnings: ["章节不存在"],
      });
    }
    details.push({
      rule: "章节存在性",
      passed: true,
      message: `章节 "${chapter.title}" 已找到`,
    });

    // 2. 检查是否有正文草稿
    if (!draft || draft.trim().length === 0) {
      details.push({
        rule: "正文草稿",
        passed: false,
        message: "未提供正文草稿内容",
      });
    } else {
      details.push({
        rule: "正文草稿",
        passed: true,
        message: `草稿长度: ${draft.length} 字符`,
      });
    }

    // 3. 检查字数是否明显不足
    if ((chapter.targetWordCount ?? 0) > 0 && draft.length > 0) {
      const targetWC = chapter.targetWordCount ?? 0;
      const estimatedWords = draft.length;
      const minAcceptable = targetWC * 0.5;
      if (estimatedWords < minAcceptable) {
        details.push({
          rule: "字数检查",
          passed: false,
          message: `当前约 ${estimatedWords} 字，低于目标 ${chapter.targetWordCount} 字的 50%（${minAcceptable} 字）`,
        });
      } else {
        details.push({
          rule: "字数检查",
          passed: true,
          message: `字数约 ${estimatedWords}，目标 ${chapter.targetWordCount} 字，达标`,
        });
      }
    } else if (draft.length > 0) {
      details.push({
        rule: "字数检查",
        passed: true,
        message: `未设定目标字数，跳过检查（当前约 ${draft.length} 字）`,
      });
    } else {
      details.push({
        rule: "字数检查",
        passed: false,
        message: "正文为空，无法检查字数",
      });
    }

    // 4. 检查主角名是否出现
    if (novelId && draft.length > 0) {
      try {
        const { protagonistRepository } = await import(
          "../services/database/protagonistRepository"
        );
        const protagonists = await protagonistRepository.getByNovelId(novelId);
        if (protagonists && Array.isArray(protagonists) && protagonists.length > 0) {
          const names = (protagonists as Record<string, unknown>[])
            .map((p) => p.name as string)
            .filter(Boolean);
          if (names.length > 0) {
            const missingNames = names.filter(
              (name) => !draft.includes(name)
            );
            if (missingNames.length === names.length) {
              details.push({
                rule: "主角出场",
                passed: false,
                message: `主角 "${names.join(", ")}" 未在正文中出现`,
              });
              warnings.push("主角名缺失于正文");
            } else if (missingNames.length > 0) {
              details.push({
                rule: "主角出场",
                passed: true,
                message: `部分主角出现: ${missingNames.join(", ")} 未出现`,
              });
            } else {
              details.push({
                rule: "主角出场",
                passed: true,
                message: `主角 "${names.join(", ")}" 已在正文中出现`,
              });
            }
          }
        } else {
          details.push({
            rule: "主角出场",
            passed: true,
            message: "未找到主角信息，跳过检查",
          });
        }
      } catch {
        warnings.push("无法读取主角信息以验证主角出场");
        details.push({
          rule: "主角出场",
          passed: true,
          message: "无法读取主角信息，跳过检查",
        });
      }
    }

    const passedCount = details.filter((d) => d.passed).length;
    const failedCount = details.filter((d) => !d.passed).length;

    return successResult(
      { details, passedCount, failedCount },
      {
        source: "database",
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    );
  } catch (err) {
    return errorResult(
      `大纲符合度验证失败: ${err instanceof Error ? err.message : String(err)}`,
      { source: "database" }
    );
  }
}

/**
 * 验证风格符合度（基础非 AI 检查）
 *
 * 检查内容：
 * - 是否有风格方案
 * - 是否有正文草稿
 * - 是否检测到可能的禁用写法（简单关键词匹配）
 *
 * @param context - Agent Tool 执行上下文
 * @param draft - 待验证的草稿文本
 * @returns Promise<AgentToolResult> — 验证结果
 */
export async function verifyStyleCompliance(
  context: AgentToolContext,
  draft: string
): Promise<AgentToolResult<{ details: VerificationDetail[]; passedCount: number; failedCount: number }>> {
  const details: VerificationDetail[] = [];
  const warnings: string[] = [];
  const novelId = resolveNovelId(context);

  try {
    // 1. 检查是否有正文
    if (!draft || draft.trim().length === 0) {
      details.push({
        rule: "正文存在性",
        passed: false,
        message: "未提供正文草稿",
      });
      return successResult({ details, passedCount: 0, failedCount: 1 }, {
        source: "database",
        warnings: ["正文为空"],
      });
    }
    details.push({
      rule: "正文存在性",
      passed: true,
      message: "正文已提供",
    });

    // 2. 检查是否有风格方案
    if (novelId) {
      try {
        const { readStyleProfile } = await import("./style-tools");
        const styleResult = await readStyleProfile({ novelId });
        if (styleResult.ok && styleResult.data) {
          const sData = styleResult.data as Record<string, unknown>;
          if (sData.activeStyle) {
            details.push({
              rule: "风格方案",
              passed: true,
              message: `已应用风格方案 "${
                (sData.activeStyle as Record<string, unknown>).name ?? "?"
              }"`,
            });

            // 3. 简单禁用写法检查
            const style = sData.activeStyle as Record<string, unknown>;
            const forbidden = style.forbiddenStyles as string[] | undefined;
            if (forbidden && Array.isArray(forbidden) && forbidden.length > 0) {
              const foundForbidden: string[] = [];
              for (const fb of forbidden) {
                if (draft.includes(fb)) {
                  foundForbidden.push(fb);
                }
              }
              if (foundForbidden.length > 0) {
                details.push({
                  rule: "禁用写法",
                  passed: false,
                  message: `检测到可能禁用的写法: ${foundForbidden.join(", ")}`,
                });
                warnings.push(`检测到禁用写法: ${foundForbidden.join(", ")}`);
              } else {
                details.push({
                  rule: "禁用写法",
                  passed: true,
                  message: `未检测到 ${forbidden.length} 项禁用写法`,
                });
              }
            }
          } else {
            warnings.push("未配置风格方案");
            details.push({
              rule: "风格方案",
              passed: true,
              message: "未配置风格方案，跳过风格检查",
            });
          }
        }
      } catch {
        warnings.push("无法读取风格方案");
        details.push({
          rule: "风格方案",
          passed: true,
          message: "无法读取风格方案，跳过风格检查",
        });
      }
    }

    const passedCount = details.filter((d) => d.passed).length;
    const failedCount = details.filter((d) => !d.passed).length;

    return successResult(
      { details, passedCount, failedCount },
      {
        source: "database",
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    );
  } catch (err) {
    return errorResult(
      `风格符合度验证失败: ${err instanceof Error ? err.message : String(err)}`,
      { source: "database" }
    );
  }
}

