import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { splitChapterText } from '../../src/services/ai/chapterTextSegmentation';
import { aiPerformanceMonitor } from '../../src/services/observability/aiPerformanceMonitor';
import { buildChapterListIndex, visibleChapterWindow } from '../../src/utils/chapterListWindow';
import type { Chapter } from '../../src/types/chapter';

const PERFORMANCE_BUDGETS = Object.freeze({
  longTextP95Ms: 300,
  thousandChapterIndexBatchMs: 100,
  aiTelemetryBatchMs: 150,
  aiProviderP95Ms: 30_000,
  retainedHeapBytes: 64 * 1024 * 1024,
});

function chapter(index: number): Chapter {
  const volumeNumber = Math.floor(index / 50);
  return {
    id: `chapter-${index}`,
    novelId: 'novel-performance',
    volumeId: `volume-${volumeNumber}`,
    title: `Chapter ${index + 1}`,
    outline: '',
    goal: '',
    chapterNumber: index + 1,
    orderIndex: index,
    sortOrder: index,
    status: 'editing',
    wordCount: 0,
    currentWords: 0,
    targetWords: 3_000,
    drafts: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

function manuscriptAtLeast(minimumCharacters: number): string {
  const paragraph =
    'A character acts, the situation changes, and a traceable consequence remains. '.repeat(20);
  const paragraphs = Math.ceil(minimumCharacters / (paragraph.length + 2));
  return Array.from({ length: paragraphs }, (_, index) => `${index}: ${paragraph}`).join('\n\n');
}

function percentile95(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

test('10k+ long text segmentation stays lossless within the calibrated p95 budget', () => {
  const manuscript = manuscriptAtLeast(1_200_000);
  assert.ok(manuscript.length >= 10_000, 'fixture must exercise the 10k+ path');
  splitChapterText(manuscript.slice(0, 20_000));

  const durations: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const startedAt = performance.now();
    const segments = splitChapterText(manuscript);
    durations.push(performance.now() - startedAt);
    assert.equal(segments.map((segment) => segment.text).join(''), manuscript);
    assert.ok(segments.length > 100);
  }

  const p95 = percentile95(durations);
  assert.ok(
    p95 < PERFORMANCE_BUDGETS.longTextP95Ms,
    `10k+ segmentation p95 ${p95.toFixed(1)}ms exceeded ${PERFORMANCE_BUDGETS.longTextP95Ms}ms`,
  );
});

test('500+ chapter navigation indexes repeatedly while rendering a bounded window', () => {
  const chapters = Array.from({ length: 1_000 }, (_, index) => chapter(index));
  assert.ok(chapters.length >= 500, 'fixture must exercise the 500+ chapter path');
  const startedAt = performance.now();

  for (let run = 0; run < 25; run += 1) {
    const index = buildChapterListIndex(chapters);
    const lastVolume = index.byVolume.get('volume-19') ?? [];
    const visible = visibleChapterWindow(lastVolume, 20, 'chapter-999');
    assert.equal(index.byVolume.size, 20);
    assert.equal(lastVolume.length, 50);
    assert.equal(visible.length, 20, 'the chapter window must stay bounded');
    assert.ok(
      visible.some((chapter) => chapter.id === 'chapter-999'),
      'the active chapter must remain reachable',
    );
  }

  const durationMs = performance.now() - startedAt;
  assert.ok(
    durationMs < PERFORMANCE_BUDGETS.thousandChapterIndexBatchMs,
    `25 indexes of 1,000 chapters took ${durationMs.toFixed(1)}ms`,
  );
});

test('AI response latency telemetry enforces a 30-second p95 service budget cheaply', () => {
  aiPerformanceMonitor.clear();
  const startedAt = performance.now();
  for (let index = 0; index < 500; index += 1) {
    aiPerformanceMonitor.record({
      recordedAt: new Date(1_785_196_800_000 + index).toISOString(),
      providerId: 'provider-performance',
      modelId: 'model-performance',
      taskType: 'chapter_generate',
      outcome: 'success',
      durationMs: 5_000 + (index % 100) * 200,
      tokenTotal: 2_000,
    });
  }
  const summary = aiPerformanceMonitor.summary();
  const durationMs = performance.now() - startedAt;

  assert.equal(summary.sampleCount, 500);
  assert.ok(
    summary.p95DurationMs <= PERFORMANCE_BUDGETS.aiProviderP95Ms,
    `AI provider p95 ${summary.p95DurationMs}ms exceeded ${PERFORMANCE_BUDGETS.aiProviderP95Ms}ms`,
  );
  assert.ok(
    durationMs < PERFORMANCE_BUDGETS.aiTelemetryBatchMs,
    `recording and summarizing 500 AI samples took ${durationMs.toFixed(1)}ms`,
  );
  aiPerformanceMonitor.clear();
});

test(
  'repeated long-text work retains less than 64 MiB after garbage collection',
  {
    skip: !global.gc,
  },
  () => {
    const manuscript = manuscriptAtLeast(180_000);
    splitChapterText(manuscript);
    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    for (let index = 0; index < 100; index += 1) {
      const segments = splitChapterText(manuscript);
      assert.equal(segments.map((segment) => segment.text).join(''), manuscript);
    }

    global.gc?.();
    const growth = process.memoryUsage().heapUsed - before;
    assert.ok(
      growth < PERFORMANCE_BUDGETS.retainedHeapBytes,
      `heap grew by ${(growth / 1024 / 1024).toFixed(1)}MiB`,
    );
  },
);
