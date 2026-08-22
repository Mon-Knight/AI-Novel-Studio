import type { LocalChapterModelSettings } from '../../../types/ai';
import type {
  LocalModelBenchmarkSummaryV1,
  LocalModelLifecycleSidecarV1,
  ModelLifecycle,
} from '../../../types/modelRuntime';
import { isTauriRuntime } from '../../tauri/runtime';
import { localModelRef } from './modelCatalog';
import { modelLifecycleManager } from './modelLifecycle';

export const LOCAL_MODEL_LIFECYCLE_SIDECAR_NAME = '.ai-novel-studio-local-model-lifecycle.json';
export const LOCAL_MODEL_LIFECYCLE_BROWSER_KEY = 'ai_novel_studio_local_model_lifecycle_v1';

const LIFECYCLES = new Set<ModelLifecycle>([
  'AVAILABLE',
  'TRAINING',
  'TESTING',
  'FAILED',
  'DISABLED',
]);
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'endpointId',
  'providerId',
  'modelId',
  'lifecycle',
  'updatedAt',
  'benchmark',
  'failureReason',
]);
const BENCHMARK_KEYS = new Set([
  'status',
  'casesTotal',
  'casesPassed',
  'passRate',
  'threshold',
  'completedAt',
  'reportHash',
]);

export interface LifecycleSidecarReadPort {
  read(): Promise<string | null>;
}

export interface LocalModelLifecycleSyncResult {
  status: 'absent' | 'applied' | 'benchmark_required' | 'identity_mismatch' | 'invalid';
  lifecycle: ModelLifecycle;
  endpointId: string;
  error?: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' 必须是对象。');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(label + ' 包含未知字段：' + unknown);
}

function text(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(label + ' 无效。');
  }
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const normalized = text(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(label + ' 不是有效时间。');
  return normalized;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(label + ' 无效。');
  }
  return value as number;
}

function ratio(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(label + ' 无效。');
  }
  return value;
}

function parseBenchmark(value: unknown): LocalModelBenchmarkSummaryV1 {
  const source = record(value, 'benchmark');
  exactKeys(source, BENCHMARK_KEYS, 'benchmark');
  const status = source.status;
  if (status !== 'pending' && status !== 'passed' && status !== 'failed') {
    throw new Error('benchmark.status 无效。');
  }
  const casesTotal = integer(source.casesTotal, 'benchmark.casesTotal', 1, 10_000);
  const casesPassed = integer(source.casesPassed, 'benchmark.casesPassed', 0, casesTotal);
  const passRate = ratio(source.passRate, 'benchmark.passRate');
  const threshold = ratio(source.threshold, 'benchmark.threshold');
  const completedAt =
    source.completedAt === undefined
      ? undefined
      : timestamp(source.completedAt, 'benchmark.completedAt');
  const reportHash =
    source.reportHash === undefined
      ? undefined
      : text(source.reportHash, 'benchmark.reportHash', 64);
  if (reportHash && !/^[0-9a-f]{64}$/.test(reportHash)) {
    throw new Error('benchmark.reportHash 必须是 SHA-256。');
  }
  if (Math.abs(passRate - casesPassed / casesTotal) > 0.000_001) {
    throw new Error('benchmark.passRate 与案例计数不一致。');
  }
  return { status, casesTotal, casesPassed, passRate, threshold, completedAt, reportHash };
}

export function parseLocalModelLifecycleSidecar(raw: string): LocalModelLifecycleSidecarV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('本地模型生命周期 sidecar 不是有效 JSON。');
  }
  const source = record(parsed, 'sidecar');
  exactKeys(source, TOP_LEVEL_KEYS, 'sidecar');
  if (source.schemaVersion !== 1) throw new Error('sidecar.schemaVersion 不受支持。');
  if (!LIFECYCLES.has(source.lifecycle as ModelLifecycle)) {
    throw new Error('sidecar.lifecycle 无效。');
  }
  return {
    schemaVersion: 1,
    endpointId: text(source.endpointId, 'sidecar.endpointId'),
    providerId: text(source.providerId, 'sidecar.providerId'),
    modelId: text(source.modelId, 'sidecar.modelId'),
    lifecycle: source.lifecycle as ModelLifecycle,
    updatedAt: timestamp(source.updatedAt, 'sidecar.updatedAt'),
    benchmark: source.benchmark === undefined ? undefined : parseBenchmark(source.benchmark),
    failureReason:
      source.failureReason === undefined
        ? undefined
        : text(source.failureReason, 'sidecar.failureReason', 500),
  };
}

export function benchmarkAuthorizesAvailability(
  benchmark: LocalModelBenchmarkSummaryV1 | undefined,
): boolean {
  return Boolean(
    benchmark &&
    benchmark.status === 'passed' &&
    benchmark.completedAt &&
    benchmark.reportHash &&
    benchmark.casesPassed / benchmark.casesTotal >= benchmark.threshold,
  );
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|cannot find|os error 2|系统找不到指定的文件/i.test(message);
}

async function readDefaultSidecar(): Promise<string | null> {
  if (!isTauriRuntime()) {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LOCAL_MODEL_LIFECYCLE_BROWSER_KEY);
  }
  const [{ readTextFile }, { homeDir, join }] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);
  const filePath = await join(await homeDir(), LOCAL_MODEL_LIFECYCLE_SIDECAR_NAME);
  try {
    return await readTextFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

const defaultPort: LifecycleSidecarReadPort = { read: readDefaultSidecar };

export async function syncLocalModelLifecycleSidecar(
  local: LocalChapterModelSettings,
  port: LifecycleSidecarReadPort = defaultPort,
): Promise<LocalModelLifecycleSyncResult> {
  const endpoint = localModelRef(local);
  try {
    const raw = await port.read();
    if (raw === null) {
      return {
        status: 'absent',
        lifecycle: modelLifecycleManager.getLifecycle(endpoint.endpointId, local.enabled),
        endpointId: endpoint.endpointId,
      };
    }
    const sidecar = parseLocalModelLifecycleSidecar(raw);
    if (
      sidecar.endpointId !== endpoint.endpointId ||
      sidecar.providerId !== endpoint.providerId ||
      sidecar.modelId !== endpoint.modelId
    ) {
      return {
        status: 'identity_mismatch',
        lifecycle: modelLifecycleManager.getLifecycle(endpoint.endpointId, local.enabled),
        endpointId: endpoint.endpointId,
      };
    }
    const benchmarkRequired =
      sidecar.lifecycle === 'AVAILABLE' && !benchmarkAuthorizesAvailability(sidecar.benchmark);
    const lifecycle: ModelLifecycle = benchmarkRequired ? 'TESTING' : sidecar.lifecycle;
    const availabilityEvidence =
      lifecycle === 'AVAILABLE'
        ? `${sidecar.updatedAt}:${sidecar.benchmark?.reportHash ?? ''}`
        : undefined;
    const lifecycleChanged = modelLifecycleManager.markLifecycle(
      endpoint.endpointId,
      lifecycle,
      availabilityEvidence,
    );
    if (lifecycle === 'AVAILABLE' && lifecycleChanged) {
      // New benchmark evidence can recover a prior endpoint. Re-reading the
      // same sidecar must not erase a later live health failure.
      modelLifecycleManager.observeHealth(endpoint.endpointId, 'ok');
    }
    return {
      status: benchmarkRequired ? 'benchmark_required' : 'applied',
      lifecycle,
      endpointId: endpoint.endpointId,
    };
  } catch (error) {
    modelLifecycleManager.markLifecycle(endpoint.endpointId, 'FAILED');
    return {
      status: 'invalid',
      lifecycle: 'FAILED',
      endpointId: endpoint.endpointId,
      error: error instanceof Error ? error.message : '生命周期 sidecar 读取失败。',
    };
  }
}
