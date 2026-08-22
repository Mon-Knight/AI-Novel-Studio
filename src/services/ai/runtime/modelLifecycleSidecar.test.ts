import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { LocalChapterModelSettings } from '../../../types/ai';
import { localModelEndpoint, localModelRef } from './modelCatalog';
import { modelLifecycleManager } from './modelLifecycle';
import { routeCreativeTask } from './modelRouter';
import {
  benchmarkAuthorizesAvailability,
  parseLocalModelLifecycleSidecar,
  syncLocalModelLifecycleSidecar,
} from './modelLifecycleSidecar';

const local: LocalChapterModelSettings = {
  enabled: true,
  providerId: 'local_llama_cpp',
  baseUrl: 'http://127.0.0.1:8080/v1',
  apiKey: 'local-no-key-required',
  modelName: 'qwen35-9b-novel-v4',
  timeoutSeconds: 120,
  contextTokens: 4096,
  maxTokens: 1024,
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  repeatPenalty: 1.08,
};

const endpoint = localModelRef(local);
const passedBenchmark = {
  status: 'passed' as const,
  casesTotal: 10,
  casesPassed: 9,
  passRate: 0.9,
  threshold: 0.9,
  completedAt: '2026-08-22T00:00:00.000Z',
  reportHash: 'a'.repeat(64),
};

function sidecar(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    endpointId: endpoint.endpointId,
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    lifecycle: 'TRAINING',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...patch,
  });
}

beforeEach(() => modelLifecycleManager.reset());

test('local OpenAI-compatible endpoint registers writer capabilities only', () => {
  const registered = localModelEndpoint(local);
  assert.equal(registered.providerFamily, 'local_openai_compatible');
  assert.equal(registered.loopbackRequired, true);
  assert.deepEqual(registered.capabilities, ['writer.scene_prose', 'writer.beat_prose']);
  assert.equal(
    registered.capabilities.some((capability) => capability.startsWith('director.')),
    false,
  );
});

test('parser accepts a credential-free TRAINING sidecar', () => {
  const parsed = parseLocalModelLifecycleSidecar(sidecar());
  assert.equal(parsed.lifecycle, 'TRAINING');
  assert.equal(parsed.endpointId, endpoint.endpointId);
});

test('parser rejects unknown fields so credentials cannot enter the sidecar', () => {
  assert.throws(
    () => parseLocalModelLifecycleSidecar(sidecar({ apiKey: 'must-not-persist' })),
    /未知字段：apiKey/,
  );
});

test('AVAILABLE requires a passed benchmark with a SHA-256 report identity', () => {
  assert.equal(benchmarkAuthorizesAvailability(passedBenchmark), true);
  assert.equal(benchmarkAuthorizesAvailability({ ...passedBenchmark, status: 'failed' }), false);
  assert.throws(
    () =>
      parseLocalModelLifecycleSidecar(
        sidecar({ lifecycle: 'AVAILABLE', benchmark: { ...passedBenchmark, reportHash: 'bad' } }),
      ),
    /SHA-256/,
  );
});

test('TRAINING sidecar takes the local writer out of service', async () => {
  const result = await syncLocalModelLifecycleSidecar(local, { read: async () => sidecar() });
  assert.equal(result.status, 'applied');
  assert.equal(result.lifecycle, 'TRAINING');
  assert.equal(modelLifecycleManager.getLifecycle(endpoint.endpointId, true), 'TRAINING');
});

test('unbenchmarked AVAILABLE sidecar stays in TESTING', async () => {
  const result = await syncLocalModelLifecycleSidecar(local, {
    read: async () => sidecar({ lifecycle: 'AVAILABLE' }),
  });
  assert.equal(result.status, 'benchmark_required');
  assert.equal(result.lifecycle, 'TESTING');
  assert.equal(modelLifecycleManager.getLifecycle(endpoint.endpointId, true), 'TESTING');
});

test('passed benchmark promotes TESTING model to AVAILABLE', async () => {
  const result = await syncLocalModelLifecycleSidecar(local, {
    read: async () => sidecar({ lifecycle: 'AVAILABLE', benchmark: passedBenchmark }),
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.lifecycle, 'AVAILABLE');
  assert.equal(modelLifecycleManager.getLifecycle(endpoint.endpointId, true), 'AVAILABLE');
  assert.equal(modelLifecycleManager.getHealth(endpoint.endpointId), 'ok');
});

test('passed benchmark recovers a previously unhealthy writer for the next Beat', async () => {
  modelLifecycleManager.observeHealth(endpoint.endpointId, 'down');
  await syncLocalModelLifecycleSidecar(local, {
    read: async () => sidecar({ lifecycle: 'AVAILABLE', benchmark: passedBenchmark }),
  });
  const decision = routeCreativeTask(
    {
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'cloud-secret',
      modelName: 'deepseek-v4-flash',
      mockMode: false,
      localChapterModel: local,
    },
    'chapter_scene_generate',
  );
  assert.equal(decision.selected.endpointId, endpoint.endpointId);
  assert.equal(decision.reason, 'local_available');
});

test('re-reading unchanged AVAILABLE evidence does not erase a later live outage', async () => {
  const availableSidecar = sidecar({ lifecycle: 'AVAILABLE', benchmark: passedBenchmark });
  await syncLocalModelLifecycleSidecar(local, { read: async () => availableSidecar });
  modelLifecycleManager.observeHealth(endpoint.endpointId, 'down');
  await syncLocalModelLifecycleSidecar(local, { read: async () => availableSidecar });
  assert.equal(modelLifecycleManager.getHealth(endpoint.endpointId), 'down');
  const decision = routeCreativeTask(
    {
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'cloud-secret',
      modelName: 'deepseek-v4-flash',
      mockMode: false,
      localChapterModel: local,
    },
    'chapter_scene_generate',
  );
  assert.equal(decision.selected.kind, 'cloud');
  assert.equal(decision.reason, 'local_unhealthy');
});

test('sidecar identity mismatch never changes the configured endpoint', async () => {
  modelLifecycleManager.markLifecycle(endpoint.endpointId, 'AVAILABLE');
  const result = await syncLocalModelLifecycleSidecar(local, {
    read: async () => sidecar({ endpointId: 'local.other.model', lifecycle: 'FAILED' }),
  });
  assert.equal(result.status, 'identity_mismatch');
  assert.equal(modelLifecycleManager.getLifecycle(endpoint.endpointId, true), 'AVAILABLE');
});

test('malformed sidecar fails closed', async () => {
  const result = await syncLocalModelLifecycleSidecar(local, { read: async () => '{bad' });
  assert.equal(result.status, 'invalid');
  assert.equal(result.lifecycle, 'FAILED');
  assert.match(result.error ?? '', /不是有效 JSON/);
});

test('missing sidecar keeps an unproven local writer out of production traffic', async () => {
  const result = await syncLocalModelLifecycleSidecar(local, { read: async () => null });
  assert.equal(result.status, 'absent');
  assert.equal(result.lifecycle, 'TESTING');
  const decision = routeCreativeTask(
    {
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'cloud-secret',
      modelName: 'deepseek-v4-flash',
      mockMode: false,
      localChapterModel: local,
    },
    'chapter_scene_generate',
  );
  assert.equal(decision.selected.kind, 'cloud');
  assert.equal(decision.reason, 'local_testing');
});
