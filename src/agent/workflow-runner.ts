// src/agent/workflow-runner.ts
// AI Novel Studio — Workflow Runner（工作流摘要器 + 校验器）
// 版本：v1.0.46
// 用途：对 AgentWorkflow 进行统计摘要和结构校验
// 注意：不执行真实任务，只验证结构

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

/**
 * 校验 Workflow 结构
 *
 * 检查：
 * - 是否有 workflow id
 * - 是否有 task
 * - 是否有重复 task id
 * - dependsOn 是否指向存在的 task
 * - 是否存在明显循环依赖
 *
 * @param workflow - 要校验的工作流
 * @returns 校验结果
 */
export function validateWorkflow(workflow: AgentWorkflow): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tasks = workflow.tasks;

  // 1. 检查 workflow id
  if (!workflow.id || workflow.id.trim().length === 0) {
    errors.push("Workflow 缺少 id");
  }

  // 2. 检查是否有 task
  if (tasks.length === 0) {
    errors.push("Workflow 没有任何 task");
    return { ok: false, errors, warnings };
  }

  // 3. 检查重复 task id
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      errors.push(`重复的 task id: "${task.id}"`);
    } else {
      taskIds.add(task.id);
    }
  }

  // 4. 检查 dependsOn 是否指向存在的 task
  for (const task of tasks) {
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        if (!taskIds.has(depId)) {
          errors.push(
            `Task "${task.id}" 依赖了不存在的 task: "${depId}"`
          );
        }
        // 5. 检查自依赖
        if (depId === task.id) {
          errors.push(`Task "${task.id}" 不能依赖自身`);
        }
      }
    }
  }

  // 6. 检查简单循环依赖（直接 A→B, B→A）
  for (const task of tasks) {
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        const depTask = tasks.find((t) => t.id === depId);
        if (depTask?.dependsOn?.includes(task.id)) {
          errors.push(
            `检测到直接循环依赖: "${task.id}" ↔ "${depId}"`
          );
        }
      }
    }
  }

  // 7. 检查 task id 为空
  for (const task of tasks) {
    if (!task.id || task.id.trim().length === 0) {
      errors.push("存在 id 为空的 task");
    }
    if (!task.title || task.title.trim().length === 0) {
      warnings.push(`Task (id: ${task.id || "?"}) 缺少 title`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
