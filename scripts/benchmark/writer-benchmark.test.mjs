import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BENCHMARK_DIMENSIONS,
  evaluateProseOutput,
  formatBenchmarkReportMarkdown,
  generateMockBenchmarkProse,
  runComparativeBenchmark,
  WRITER_BENCHMARK_FIXTURES,
} from './writer-evaluator-lib.mjs';

test('evaluateProseOutput returns 0 scores for empty prose', () => {
  const fixture = WRITER_BENCHMARK_FIXTURES[0];
  const score = evaluateProseOutput('', fixture, false);
  assert.equal(score.compositeScore, 0);
  assert.equal(score.characterConsistency, 0);
  assert.equal(score.worldConsistency, 0);
});

test('evaluateProseOutput calculates all 5 dimensions and weights composite score', () => {
  const fixture = WRITER_BENCHMARK_FIXTURES[0];
  const enhancedProse = generateMockBenchmarkProse(fixture, true);
  const score = evaluateProseOutput(enhancedProse, fixture, true);

  for (const dim of BENCHMARK_DIMENSIONS) {
    assert.ok(typeof score[dim] === 'number', `维度 ${dim} 应为数字`);
    assert.ok(score[dim] >= 0 && score[dim] <= 10, `维度 ${dim} 分数应在 0~10 之间`);
  }

  assert.ok(score.characterConsistency >= 8.0, 'Enhanced 模式人物一致性应高分');
  assert.ok(score.worldConsistency >= 8.0, 'Enhanced 模式世界观一致性应高分');
  assert.ok(score.plotContinuity >= 8.0, 'Enhanced 模式剧情连贯性应高分');
  assert.ok(score.compositeScore >= 8.0, '综合得分应达标');
});

test('evaluateProseOutput applies penalties for forbidden breaches', () => {
  const fixture = WRITER_BENCHMARK_FIXTURES[0];
  const badProse = `林清玄大喝一声承认盗窃，与岳凌峰大打出手，随后直接御剑飞走。`;
  const score = evaluateProseOutput(badProse, fixture, false);

  assert.ok(score.characterConsistency < 6.0, '发生禁忌违背时人物一致性应扣分');
});

test('runComparativeBenchmark runs A/B benchmark and computes improvement delta', async () => {
  const report = await runComparativeBenchmark({
    modelName: 'test-qwen-writer-eval',
    fixtures: [WRITER_BENCHMARK_FIXTURES[0], WRITER_BENCHMARK_FIXTURES[1]],
  });

  assert.equal(report.model, 'test-qwen-writer-eval');
  assert.equal(report.totalCases, 2);
  assert.ok(report.benchmarkId.startsWith('bench-'));

  assert.ok(report.summary.avgEnhancedComposite > report.summary.avgBaselineComposite);
  assert.ok(report.summary.overallImprovement > 0);
  assert.ok(report.summary.improvementPercentage > 0);

  assert.equal(report.results.length, 2);
  const r0 = report.results[0];
  assert.equal(r0.baseline.memory_enabled, false);
  assert.equal(r0.enhanced.memory_enabled, true);
  assert.ok(r0.delta.compositeScoreDiff > 0);
  assert.ok(r0.delta.characterConsistencyDiff >= 0);
});

test('formatBenchmarkReportMarkdown outputs structured markdown report', async () => {
  const report = await runComparativeBenchmark({
    modelName: 'test-model',
    fixtures: [WRITER_BENCHMARK_FIXTURES[0]],
  });

  const md = formatBenchmarkReportMarkdown(report);

  assert.ok(md.includes('# Novel Writer Benchmark Report'));
  assert.ok(md.includes('**Model Under Test**: `test-model`'));
  assert.ok(md.includes('Baseline (无 Memory)'));
  assert.ok(md.includes('Enhanced (启用 Memory Layer)'));
  assert.ok(md.includes(WRITER_BENCHMARK_FIXTURES[0].title));
});
