/**
 * Token Aggregation Service Tests
 * v2.8.0 - Phase 1: Quality Auto-Scoring & Auto-Polish
 */

import { describe, it, expect } from 'vitest';
import { tokenAggregationService } from './tokenAggregationService';

// 使用简化的内部类型
interface AiTaskWithTokens {
  id?: string;
  taskId?: string;
  taskType?: string;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

describe('TokenAggregationService', () => {
  it('should aggregate tokens correctly', () => {
    const mockTasks: AiTaskWithTokens[] = [
      {
        id: 't1',
        taskType: 'chapter_generation',
        status: 'completed',
        inputTokens: 1000,
        outputTokens: 2000,
        model: 'claude-3-5-sonnet-20241022',
      },
      {
        id: 't2',
        taskType: 'quality_check',
        status: 'completed',
        inputTokens: 500,
        outputTokens: 300,
        model: 'claude-3-5-sonnet-20241022',
      },
    ];

    const stats = (tokenAggregationService as any)._aggregateTokens(mockTasks);

    expect(stats.totalInputTokens).toBe(1500);
    expect(stats.totalOutputTokens).toBe(2300);
    expect(stats.estimatedCostUsd).toBeGreaterThan(0);
    expect(stats.taskBreakdown.length).toBe(2);
  });

  it('should calculate cost correctly for different models', () => {
    const mockTasks: AiTaskWithTokens[] = [
      {
        id: 't1',
        taskType: 'test',
        status: 'completed',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: 'claude-3-5-sonnet-20241022',
      },
    ];

    const stats = (tokenAggregationService as any)._aggregateTokens(mockTasks);

    // 1M input * $3 + 1M output * $15 = $18
    expect(stats.estimatedCostUsd).toBe(18.0);
  });

  it('should skip incomplete tasks', () => {
    const mockTasks: AiTaskWithTokens[] = [
      {
        id: 't1',
        taskType: 'test',
        status: 'completed',
        inputTokens: 1000,
        outputTokens: 2000,
        model: 'claude-3-5-sonnet-20241022',
      },
      {
        id: 't2',
        taskType: 'test',
        status: 'running',
        inputTokens: 500,
        outputTokens: 300,
        model: 'claude-3-5-sonnet-20241022',
      },
    ];

    const stats = (tokenAggregationService as any)._aggregateTokens(mockTasks);

    // Only completed task counted
    expect(stats.totalInputTokens).toBe(1000);
    expect(stats.totalOutputTokens).toBe(2000);
  });
});
