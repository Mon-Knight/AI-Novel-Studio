// src/agent/workflow-runner.ts
// AI Novel Studio — Workflow Runner（工作流摘要器）
// 版本：v1.0.44
// 用途：对 AgentWorkflow 进行统计摘要，不执行真实任务
// 注意：当前只做"可描述、可检查、可扩展"，不做自动执行

import type { AgentWorkflow, WorkflowSummary } from "./types";

/**
 * 对工作流进行统计摘要
 *
 * 输出内容：
 *   - workflow 名称
 *   - task 总数
 *   - 各状态统计 (pending/running/completed/failed/skipped)
 *   - 依赖关系摘要
 *
 * @param workflow - 要摘要的工作流
 * @returns WorkflowSummary
 */
export function summarizeWorkflow(workflow: AgentWorkflow): WorkflowSummary {
  const tasks = workflow.tasks;

  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of tasks) {
    switch (task.status) {
      case "pending":
        pending++;
        break;
      case "running":
        running++;
        break;
      case "completed":
        completed++;
        break;
      case "failed":
        failed++;
        break;
      case "skipped":
        skipped++;
        break;
    }
  }

  // 构建依赖关系摘要
  const dependencyLines: string[] = [];
  for (const task of tasks) {
    if (task.dependsOn && task.dependsOn.length > 0) {
      dependencyLines.push(
        `  ${task.id} → depends on: [${task.dependsOn.join(", ")}]`
      );
    }
  }

  return {
    name: workflow.name,
    totalTasks: tasks.length,
    pending,
    running,
    completed,
    failed,
    skipped,
    dependencyLines,
  };
}

/**
 * 将 WorkflowSummary 格式化为可读字符串
 */
export function formatSummary(summary: WorkflowSummary): string {
  const lines: string[] = [
    `Workflow: ${summary.name}`,
    `Tasks: ${summary.totalTasks} total`,
    `  pending:   ${summary.pending}`,
    `  running:   ${summary.running}`,
    `  completed: ${summary.completed}`,
    `  failed:    ${summary.failed}`,
    `  skipped:   ${summary.skipped}`,
  ];

  if (summary.dependencyLines.length > 0) {
    lines.push("Dependencies:");
    lines.push(...summary.dependencyLines);
  }

  return lines.join("\n");
}
