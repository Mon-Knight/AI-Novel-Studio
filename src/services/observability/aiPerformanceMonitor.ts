import type { AiTaskType } from '../../types/ai';

const STORAGE_KEY = 'ai_novel_studio_ai_performance_v1';
const MAX_SAMPLES = 500;

export interface AiPerformanceSample {
  recordedAt: string;
  providerId: string;
  modelId: string;
  taskType?: AiTaskType;
  outcome: 'success' | 'cancelled' | 'failed';
  durationMs: number;
  tokenTotal?: number;
}

export interface AiPerformanceSummary {
  sampleCount: number;
  successCount: number;
  cancelledCount: number;
  failedCount: number;
  p50DurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
}

let memorySamples: AiPerformanceSample[] = [];

function isSample(value: unknown): value is AiPerformanceSample {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const sample = value as Partial<AiPerformanceSample>;
  return (
    typeof sample.recordedAt === 'string' &&
    typeof sample.providerId === 'string' &&
    typeof sample.modelId === 'string' &&
    (sample.outcome === 'success' ||
      sample.outcome === 'cancelled' ||
      sample.outcome === 'failed') &&
    typeof sample.durationMs === 'number' &&
    Number.isFinite(sample.durationMs) &&
    sample.durationMs >= 0
  );
}

function readSamples(): AiPerformanceSample[] {
  let parsed: unknown = memorySamples;
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) parsed = JSON.parse(stored) as unknown;
  } catch {
    // The process-local buffer remains available when storage is unavailable.
  }
  return Array.isArray(parsed) ? parsed.filter(isSample).slice(-MAX_SAMPLES) : [];
}

function writeSamples(samples: AiPerformanceSample[]): void {
  memorySamples = samples.slice(-MAX_SAMPLES);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(memorySamples));
  } catch {
    // Metrics never change the Provider result.
  }
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export const aiPerformanceMonitor = {
  record(sample: AiPerformanceSample): void {
    if (!isSample(sample)) return;
    writeSamples([...readSamples(), sample]);
  },

  list(): readonly AiPerformanceSample[] {
    return readSamples();
  },

  summary(): AiPerformanceSummary {
    const samples = readSamples();
    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    return {
      sampleCount: samples.length,
      successCount: samples.filter((sample) => sample.outcome === 'success').length,
      cancelledCount: samples.filter((sample) => sample.outcome === 'cancelled').length,
      failedCount: samples.filter((sample) => sample.outcome === 'failed').length,
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      maxDurationMs: durations[durations.length - 1] ?? 0,
    };
  },

  clear(): void {
    memorySamples = [];
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort diagnostics cleanup.
    }
  },
};

export const aiPerformanceStorageKey = STORAGE_KEY;
