import assert from 'node:assert/strict';
import test from 'node:test';
import type { RouteRequest } from '../../../types/modelRuntime';
import { decideModelRoute, ModelRouteError, roleForTaskType } from './routeDecision';
import { modelLifecycleManager } from './modelLifecycle';
import { buildRouteRequest, routeCreativeTask } from './modelRouter';
import type { AiSettings } from '../../../types/ai';

const cloudRef = {
  endpointId: 'cloud.deepseek.v4',
  providerId: 'deepseek',
  modelId: 'v4',
  kind: 'cloud' as const,
};

const localRef = {
  endpointId: 'local.local_llama_cpp.qwen',
  providerId: 'local_llama_cpp',
  modelId: 'qwen',
  kind: 'local' as const,
};

const mockRef = {
  endpointId: 'cloud.mock.Mock',
  providerId: 'mock',
  modelId: 'Mock',
  kind: 'mock' as const,
};

function request(patch: Partial<RouteRequest> = {}): RouteRequest {
  return {
    role: 'writer.beat_prose',
    taskType: 'chapter_scene_generate',
    compiledContextTokens: 2000,
    localEnabled: true,
    localLifecycle: 'AVAILABLE',
    localHealth: 'unknown',
    localContextTokens: 4096,
    localMaxOutputTokens: 1024,
    cloudAvailable: true,
    runtimeMode: 'api',
    allowCloudWriterFallback: true,
    mockRef,
    cloudRef,
    localRef,
    ...patch,
  };
}

test('mock mode always selects mock and never local', () => {
  const decision = decideModelRoute(request({ runtimeMode: 'mock' }), () => 't0');
  assert.equal(decision.selected.kind, 'mock');
  assert.equal(decision.reason, 'mock');
  assert.equal(decision.fallbackUsed, false);
});

test('director and critic roles never select the local writer', () => {
  for (const role of [
    'director.world',
    'director.scene_plan',
    'director.repair',
    'critic.quality',
    'writer.chapter_fallback',
  ] as const) {
    const decision = decideModelRoute(request({ role, taskType: 'chapter_scene_plan_generate' }));
    assert.equal(decision.selected.kind, 'cloud');
    assert.equal(decision.reason, 'role_default');
    assert.equal(decision.fallbackUsed, false);
  }
});

test('available local writer is selected for beat prose', () => {
  const decision = decideModelRoute(request());
  assert.equal(decision.selected.kind, 'local');
  assert.equal(decision.reason, 'local_available');
  assert.equal(decision.fallbackUsed, false);
  assert.equal(decision.fallback?.kind, 'cloud');
});

test('TRAINING TESTING FAILED and endpoint DISABLED fall back to the cloud Beat contract', () => {
  const cases = [
    ['TRAINING', 'local_training'],
    ['TESTING', 'local_testing'],
    ['FAILED', 'local_failed'],
    ['DISABLED', 'local_disabled'],
  ] as const;
  for (const [lifecycle, reason] of cases) {
    const decision = decideModelRoute(request({ localLifecycle: lifecycle }));
    assert.equal(decision.selected.kind, 'cloud');
    assert.equal(decision.taskType, 'chapter_scene_generate');
    assert.equal(decision.reason, reason);
    assert.equal(decision.fallbackUsed, true);
  }
});

test('disabled or unconfigured local writer makes cloud the primary Beat writer', () => {
  for (const patch of [
    { localEnabled: false, localLifecycle: 'DISABLED' as const },
    { localEnabled: false, localLifecycle: 'DISABLED' as const, localRef: undefined },
  ]) {
    const decision = decideModelRoute(request(patch));
    assert.equal(decision.selected.kind, 'cloud');
    assert.equal(decision.reason, 'cloud_writer_primary');
    assert.equal(decision.fallbackUsed, false);
    assert.equal(decision.fallback, undefined);
  }
});

test('unhealthy local writer falls back to cloud', () => {
  const decision = decideModelRoute(request({ localHealth: 'down' }));
  assert.equal(decision.selected.kind, 'cloud');
  assert.equal(decision.reason, 'local_unhealthy');
  assert.equal(decision.fallbackUsed, true);
});

test('oversized beat context falls back instead of switching to chapter_generate', () => {
  const decision = decideModelRoute(request({ compiledContextTokens: 4000 }));
  assert.equal(decision.selected.kind, 'cloud');
  assert.equal(decision.taskType, 'chapter_scene_generate');
  assert.equal(decision.reason, 'context_too_large_for_local');
  assert.equal(decision.fallbackUsed, true);
});

test('disabled cloud writer fallback fails closed', () => {
  assert.throws(
    () =>
      decideModelRoute(request({ localLifecycle: 'TRAINING', allowCloudWriterFallback: false })),
    (error: unknown) => error instanceof ModelRouteError,
  );
});

test('roleForTaskType keeps writer beats distinct from whole-chapter fallback', () => {
  assert.equal(roleForTaskType('chapter_scene_generate'), 'writer.beat_prose');
  assert.equal(roleForTaskType('chapter_generate'), 'writer.chapter_fallback');
  assert.equal(roleForTaskType('chapter_scene_plan_generate'), 'director.scene_plan');
});

test('lifecycle manager requires explicit availability and treats disabled as DISABLED', () => {
  modelLifecycleManager.reset();
  assert.equal(modelLifecycleManager.getLifecycle('local.x', false), 'DISABLED');
  assert.equal(modelLifecycleManager.getLifecycle('local.x', true), 'TESTING');
  assert.equal(modelLifecycleManager.getHealth('local.x'), 'unknown');
  modelLifecycleManager.markLifecycle('local.x', 'TRAINING');
  modelLifecycleManager.observeHealth('local.x', 'down');
  assert.equal(modelLifecycleManager.getLifecycle('local.x', true), 'TRAINING');
  assert.equal(modelLifecycleManager.getHealth('local.x'), 'down');
  modelLifecycleManager.reset();
});

test('router reads settings and declared lifecycle without probing', () => {
  modelLifecycleManager.reset();
  const settings: AiSettings = {
    runtimeMode: 'api',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'secret',
    modelName: 'deepseek-v4-flash',
    mockMode: false,
    localChapterModel: {
      enabled: true,
      providerId: 'local_llama_cpp',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'local-no-key-required',
      modelName: 'qwen35-9b-novel-v3',
      timeoutSeconds: 120,
      contextTokens: 4096,
      maxTokens: 1024,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.08,
      allowCloudWriterFallback: true,
    },
  };
  const pending = buildRouteRequest(settings, 'chapter_scene_generate');
  assert.equal(pending.localLifecycle, 'TESTING');
  assert.ok(pending.localRef);
  modelLifecycleManager.markLifecycle(pending.localRef.endpointId, 'AVAILABLE');
  const available = routeCreativeTask(settings, 'chapter_scene_generate');
  assert.equal(available.selected.kind, 'local');
  modelLifecycleManager.markLifecycle(available.selected.endpointId, 'TRAINING');
  const training = routeCreativeTask(settings, 'chapter_scene_generate');
  assert.equal(training.selected.kind, 'cloud');
  assert.equal(training.reason, 'local_training');
  assert.equal(
    buildRouteRequest(settings, 'chapter_scene_plan_generate').role,
    'director.scene_plan',
  );
  modelLifecycleManager.reset();
});

test('remote writer is selected as primary when local is disabled and remote is enabled', () => {
  const remoteRef = {
    endpointId: 'remote.remote_openai_compatible.qwen-32b',
    providerId: 'remote_openai_compatible',
    modelId: 'qwen-32b',
    kind: 'remote' as const,
  };
  const decision = decideModelRoute(
    request({
      localEnabled: false,
      localRef: undefined,
      remoteEnabled: true,
      remoteAvailable: true,
      remoteRef,
    }),
  );
  assert.equal(decision.selected.kind, 'remote');
  assert.equal(decision.reason, 'remote_writer_primary');
  assert.equal(decision.fallbackUsed, false);
  assert.equal(decision.fallback?.kind, 'cloud');
});

test('remote writer is selected as fallback when local writer is TRAINING or FAILED', () => {
  const remoteRef = {
    endpointId: 'remote.remote_openai_compatible.qwen-32b',
    providerId: 'remote_openai_compatible',
    modelId: 'qwen-32b',
    kind: 'remote' as const,
  };
  const decision = decideModelRoute(
    request({
      localLifecycle: 'TRAINING',
      remoteEnabled: true,
      remoteAvailable: true,
      remoteRef,
    }),
  );
  assert.equal(decision.selected.kind, 'remote');
  assert.equal(decision.reason, 'local_training');
  assert.equal(decision.fallbackUsed, true);
  assert.equal(decision.selected.modelId, 'qwen-32b');
});

test('available local writer takes priority over remote writer', () => {
  const remoteRef = {
    endpointId: 'remote.remote_openai_compatible.qwen-32b',
    providerId: 'remote_openai_compatible',
    modelId: 'qwen-32b',
    kind: 'remote' as const,
  };
  const decision = decideModelRoute(
    request({
      localEnabled: true,
      localLifecycle: 'AVAILABLE',
      remoteEnabled: true,
      remoteAvailable: true,
      remoteRef,
    }),
  );
  assert.equal(decision.selected.kind, 'local');
  assert.equal(decision.reason, 'local_available');
  assert.equal(decision.fallbackUsed, false);
});

