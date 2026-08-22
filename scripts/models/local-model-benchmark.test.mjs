import assert from 'node:assert/strict';
import test from 'node:test';
import {
  benchmarkReportHash,
  buildBenchmarkPrompt,
  buildCompletedSidecar,
  buildTestingSidecar,
  evaluateBenchmarkOutput,
  LOCAL_PROSE_BENCHMARK_FIXTURES,
  summarizeBenchmark,
} from './local-model-benchmark-lib.mjs';

function validText(fixture) {
  return (
    fixture.requiredTerms.join('，') +
    '。雨水沿着屋檐连续落下，人物没有停在想法里，而是完成眼前动作并确认变化已经发生。' +
    '现场的声音、光线和呼吸逐渐收紧，所有反应都围绕当前目标展开，没有提前进入下一段行动。'.repeat(3)
  );
}

test('benchmark prompt freezes current Beat and required facts', () => {
  const fixture = LOCAL_PROSE_BENCHMARK_FIXTURES[0];
  const prompt = buildBenchmarkPrompt(fixture, 1);
  assert.match(prompt, /只续写当前一个 Beat/);
  assert.match(prompt, /沈岚/);
  assert.match(prompt, /列车/);
});

test('output evaluator accepts bounded prose with required facts', () => {
  const fixture = LOCAL_PROSE_BENCHMARK_FIXTURES[0];
  const result = evaluateBenchmarkOutput({
    fixture,
    text: validText(fixture),
    finishReason: 'stop',
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test('output evaluator rejects thinking, truncation and missing facts', () => {
  const fixture = LOCAL_PROSE_BENCHMARK_FIXTURES[0];
  const result = evaluateBenchmarkOutput({
    fixture,
    text: '<think>分析</think>短文',
    finishReason: 'length',
  });
  assert.equal(result.passed, false);
  assert.ok(result.issues.includes('OUTPUT_TOO_SHORT'));
  assert.ok(result.issues.includes('OUTPUT_TRUNCATED'));
  assert.ok(result.issues.includes('NON_PROSE_LEAKAGE'));
  assert.ok(result.issues.includes('REQUIRED_FACT_MISSING'));
});

test('benchmark summary applies the configured pass-rate gate', () => {
  const passed = { passed: true };
  const failed = { passed: false };
  assert.equal(summarizeBenchmark([...Array(9).fill(passed), failed], 0.9).status, 'passed');
  assert.equal(
    summarizeBenchmark([...Array(8).fill(passed), failed, failed], 0.9).status,
    'failed',
  );
});

test('TESTING and completed sidecars use stable endpoint and report identities', () => {
  const testing = buildTestingSidecar({
    providerId: 'local_llama_cpp',
    modelId: 'qwen-v2',
    casesTotal: 10,
    threshold: 0.9,
    now: '2026-08-22T00:00:00.000Z',
  });
  assert.equal(testing.lifecycle, 'TESTING');
  assert.equal(testing.endpointId, 'local.local_llama_cpp.qwen-v2');

  const fixture = LOCAL_PROSE_BENCHMARK_FIXTURES[0];
  const results = Array.from({ length: 10 }, () =>
    evaluateBenchmarkOutput({ fixture, text: validText(fixture), finishReason: 'stop' }),
  );
  const completed = buildCompletedSidecar({
    providerId: 'local_llama_cpp',
    modelId: 'qwen-v2',
    results,
    threshold: 0.9,
    now: '2026-08-22T00:01:00.000Z',
  });
  assert.equal(completed.sidecar.lifecycle, 'AVAILABLE');
  assert.match(completed.reportHash, /^[0-9a-f]{64}$/);
  assert.equal(completed.reportHash, benchmarkReportHash(completed.report));
});
