// src/agent/types.ts
// AI Novel Studio — Agent 最小类型系统
// 版本：v1.0.44
// 用途：定义 Agent 工作流的核心类型，不连接 AI、不连接数据库

/**
 * Agent 任务状态
 */
export type AgentTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 单个 Agent 任务
 */
export interface AgentTask {
  /** 任务唯一标识 */
  id: string;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description?: string;
  /** 依赖的前置任务 ID 列表 */
  dependsOn?: string[];
  /** 任务状态 */
  status: AgentTaskStatus;
}

/**
 * Agent 工作流
 */
export interface AgentWorkflow {
  /** 工作流唯一标识 */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description?: string;
  /** 任务列表 */
  tasks: AgentTask[];
}

/**
 * Workflow 输入上下文（Planner 使用）
 */
export interface PlannerInput {
  /** 项目 ID（可选，未来使用） */
  projectId?: string;
  /** 章 ID（可选，未来使用） */
  chapterId?: string;
  /** 目标描述 */
  goal: string;
}

/**
 * Workflow 任务统计摘要
 */
export interface WorkflowSummary {
  /** 工作流名称 */
  name: string;
  /** 任务总数 */
  totalTasks: number;
  /** 各状态统计 */
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
  /** 依赖关系描述 */
  dependencyLines: string[];
}
