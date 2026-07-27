/**
 * Token Aggregation Service
 * v2.8.0 - Phase 1: Quality Auto-Scoring & Auto-Polish
 *
 * 从 ai_task_records 聚合 Token 消耗统计，更新到 autonomous_generation_jobs
 */

import { dbCall } from '../database/db';
import { autonomousJobService } from './autonomousJobService';
import { aiTaskService } from '../ai/aiTaskService';

// 内部使用的简化类型（包含 Token 信息）
interface AiTaskWithTokens {
  id?: string;
  taskId?: string;
  taskType?: string;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  taskBreakdown: Array<{
    taskType: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

/**
 * 模型定价（USD per 1M tokens）
 * 基于 Claude 3.5 Sonnet 定价
 */
const MODEL_PRICING = {
  'claude-3-5-sonnet-20241022': {
    input: 3.0,   // $3 / 1M input tokens
    output: 15.0, // $15 / 1M output tokens
  },
  'claude-3-5-haiku-20241022': {
    input: 1.0,
    output: 5.0,
  },
  'claude-3-opus-20240229': {
    input: 15.0,
    output: 75.0,
  },
  // 默认定价（用于未知模型）
  default: {
    input: 3.0,
    output: 15.0,
  },
};

export class TokenAggregationService {
  /**
   * Estimate the incremental cost for a single provider result.
   *
   * Autonomous job progress stores token deltas, so callers need a matching
   * delta-cost helper instead of re-aggregating every historical chapter task.
   * The optional model keeps the current legacy pricing contract until the
   * formal execution-fact usage query supplies provider/model identities.
   */
  estimateCostUsd(
    inputTokens: number,
    outputTokens: number,
    model: string = 'default',
  ): number {
    const pricing = (MODEL_PRICING as Record<string, { input: number; output: number }>)[model]
      ?? MODEL_PRICING.default;
    const inputCost = (Math.max(0, inputTokens) / 1_000_000) * pricing.input;
    const outputCost = (Math.max(0, outputTokens) / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * 聚合指定 operation_id 的 Token 消耗
   */
  async aggregateTokensByOperation(operationId: string): Promise<TokenStats> {
    // 查询所有匹配的 AI Task Records
    const allTasks = await aiTaskService.getAll(1, 1000);
    const tasks: AiTaskWithTokens[] = allTasks.items
      .filter((task) => task.id.startsWith(operationId) || task.inputSummary?.includes(operationId))
      .map((task) => ({
        id: task.id,
        taskType: task.taskType,
        status: task.status === 'succeeded' ? 'completed' : task.status,
        inputTokens: task.tokenInput,
        outputTokens: task.tokenOutput,
        model: task.modelName,
      }));

    return this._aggregateTokens(tasks);
  }

  /**
   * 聚合指定章节的 Token 消耗（跨多个 operation）
   */
  async aggregateTokensByChapter(chapterId: string): Promise<TokenStats> {
    const tasks: AiTaskWithTokens[] = (await aiTaskService.getByChapterId(chapterId)).map((task) => ({
      id: task.id,
      taskType: task.taskType,
      status: task.status === 'succeeded' ? 'completed' : task.status,
      inputTokens: task.tokenInput,
      outputTokens: task.tokenOutput,
      model: task.modelName,
    }));

    return this._aggregateTokens(tasks);
  }

  /**
   * 更新 Job 的 Token 统计
   */
  async updateJobTokens(jobId: string, operationId: string): Promise<void> {
    const stats = await this.aggregateTokensByOperation(operationId);
    const currentJob = await autonomousJobService.get(jobId);
    if (!currentJob) throw new Error(`Autonomous job ${jobId} not found`);

    await dbCall('update_autonomous_job_progress', {
      input: {
        jobId,
        // 这里只更新 Token 字段，其他字段从当前 Job 获取
        completedChapters: currentJob.completedChapters,
        currentChapterId: currentJob.currentChapterId,
        currentChapterAttempt: currentJob.currentChapterAttempt,
        tokensInput: Math.max(0, stats.totalInputTokens - currentJob.totalTokensInput),
        tokensOutput: Math.max(0, stats.totalOutputTokens - currentJob.totalTokensOutput),
        estimatedCostUsd: stats.estimatedCostUsd,
      },
    });
  }

  /**
   * 内部聚合逻辑
   */
  private _aggregateTokens(tasks: AiTaskWithTokens[]): TokenStats {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let estimatedCostUsd = 0;

    const breakdownMap = new Map<string, { input: number; output: number }>();

    for (const task of tasks) {
      // 跳过未完成的任务
      if (task.status !== 'completed') continue;

      const inputTokens = task.inputTokens ?? 0;
      const outputTokens = task.outputTokens ?? 0;
      const model = task.model ?? 'default';

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      // 计算成本
      estimatedCostUsd += this.estimateCostUsd(inputTokens, outputTokens, model);

      // 按任务类型分类
      const taskType = task.taskType ?? 'unknown';
      const existing = breakdownMap.get(taskType) ?? { input: 0, output: 0 };
      breakdownMap.set(taskType, {
        input: existing.input + inputTokens,
        output: existing.output + outputTokens,
      });
    }

    const taskBreakdown = Array.from(breakdownMap.entries()).map(([taskType, tokens]) => ({
      taskType,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
    }));

    return {
      totalInputTokens,
      totalOutputTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100, // 保留两位小数
      taskBreakdown,
    };
  }
}

export const tokenAggregationService = new TokenAggregationService();
