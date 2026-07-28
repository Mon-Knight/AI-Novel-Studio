import { beforeEach, describe, expect, it } from 'vitest';
import { aiPerformanceMonitor } from '../../services/observability/aiPerformanceMonitor';

describe('AI performance monitor', () => {
  beforeEach(() => {
    localStorage.clear();
    aiPerformanceMonitor.clear();
  });

  it('keeps a bounded safe sample window and reports deterministic percentiles', () => {
    for (let index = 1; index <= 520; index += 1) {
      aiPerformanceMonitor.record({
        recordedAt: `2026-07-28T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        providerId: 'provider',
        modelId: 'model',
        taskType: 'chapter_generate',
        outcome: index % 10 === 0 ? 'failed' : 'success',
        durationMs: index,
        tokenTotal: 100,
      });
    }

    expect(aiPerformanceMonitor.list()).toHaveLength(500);
    expect(aiPerformanceMonitor.summary()).toEqual({
      sampleCount: 500,
      successCount: 450,
      cancelledCount: 0,
      failedCount: 50,
      p50DurationMs: 270,
      p95DurationMs: 495,
      maxDurationMs: 520,
    });
  });
});
