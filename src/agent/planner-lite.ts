// src/agent/planner-lite.ts
// AI Novel Studio — Planner Lite（最小规划器）
// 版本：v1.0.44
// 用途：返回固定的章节生成 Workflow，为未来 Planner 打基础
// 注意：不连接真实生成逻辑，当前只返回固定任务图

import type { AgentWorkflow, PlannerInput } from "./types";

/**
 * 创建固定的章节生成工作流
 *
 * 返回固定任务图：
 *   1. read_project_context
 *   2. read_chapter_outline
 *   3. read_style_profile
 *   4. generate_chapter_draft
 *   5. verify_outline_compliance
 *   6. verify_style_compliance
 *   7. save_candidate_draft
 *
 * @param input - 规划输入（当前仅 goal 字段被实际使用）
 * @returns 固定的 AgentWorkflow
 */
export function createChapterGenerationWorkflow(
  input: PlannerInput
): AgentWorkflow {
  const workflowId = `chapter-gen-${input.chapterId ?? "unknown"}-${Date.now()}`;

  return {
    id: workflowId,
    name: `章节生成: ${input.goal}`,
    description: `为项目 ${input.projectId ?? "(未指定)"} 的第 ${input.chapterId ?? "(未指定)"} 章生成正文的固定工作流`,
    tasks: [
      {
        id: "read_project_context",
        title: "读取项目上下文",
        description: "读取世界设定、主角信息、规则体系",
        status: "pending",
      },
      {
        id: "read_chapter_outline",
        title: "读取章节大纲",
        description: "读取当前章节的大纲和目标",
        dependsOn: ["read_project_context"],
        status: "pending",
      },
      {
        id: "read_style_profile",
        title: "读取风格方案",
        description: "读取当前应用的风格方案和输出控制方案",
        dependsOn: ["read_project_context"],
        status: "pending",
      },
      {
        id: "generate_chapter_draft",
        title: "生成章节草稿",
        description: "基于上下文、大纲、风格调用 AI 生成正文",
        dependsOn: ["read_chapter_outline", "read_style_profile"],
        status: "pending",
      },
      {
        id: "verify_outline_compliance",
        title: "验证大纲符合度",
        description: "检查生成的正文是否符合章节大纲",
        dependsOn: ["generate_chapter_draft"],
        status: "pending",
      },
      {
        id: "verify_style_compliance",
        title: "验证风格符合度",
        description: "检查生成的正文是否符合风格方案",
        dependsOn: ["generate_chapter_draft"],
        status: "pending",
      },
      {
        id: "save_candidate_draft",
        title: "保存候选草稿",
        description: "将验证通过的草稿保存为候选版本",
        dependsOn: ["verify_outline_compliance", "verify_style_compliance"],
        status: "pending",
      },
    ],
  };
}
