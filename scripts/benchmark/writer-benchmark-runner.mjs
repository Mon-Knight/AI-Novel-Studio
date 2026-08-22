#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatBenchmarkReportMarkdown,
  runComparativeBenchmark,
  WRITER_BENCHMARK_FIXTURES,
} from './writer-evaluator-lib.mjs';

function parseCliArgs(args) {
  const options = {
    model: 'qwen3.8-27b-writer',
    outPath: null,
    jsonOutput: false,
    markdownOutput: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' && args[i + 1]) {
      options.model = args[++i].trim();
    } else if (arg === '--out' && args[i + 1]) {
      options.outPath = resolve(args[++i].trim());
    } else if (arg === '--json') {
      options.jsonOutput = true;
    } else if (arg === '--markdown') {
      options.markdownOutput = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Novel Writer Benchmark Runner

Usage:
  node scripts/benchmark/writer-benchmark-runner.mjs [options]

Options:
  --model <name>    指定被评测作家模型名称 (默认: qwen3.8-27b-writer)
  --out <path>      输出报告文件保存路径
  --json            直接以 JSON 格式输出到控制台
  --markdown        直接以 Markdown 格式输出到控制台
  --help, -h        显示帮助信息
`);
      process.exit(0);
    }
  }

  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  console.log(`[Writer Benchmark] 正在对模型 [${options.model}] 启动长篇小说场景创作评测...`);
  console.log(`[Writer Benchmark] 加载测试用例: ${WRITER_BENCHMARK_FIXTURES.length} 组标准分镜场景.`);

  const report = await runComparativeBenchmark({
    modelName: options.model,
    fixtures: WRITER_BENCHMARK_FIXTURES,
  });

  const markdownReport = formatBenchmarkReportMarkdown(report);

  if (options.outPath) {
    writeFileSync(options.outPath, options.jsonOutput ? JSON.stringify(report, null, 2) : markdownReport, 'utf8');
    console.log(`[Writer Benchmark] 评测报告已成功保存至: ${options.outPath}`);
  }

  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.markdownOutput) {
    console.log(markdownReport);
  } else {
    console.log('\n' + '='.repeat(60));
    console.log(`评测完成! Benchmark ID: ${report.benchmarkId}`);
    console.log(`Baseline 综合得分:  ${report.summary.avgBaselineComposite}`);
    console.log(`Enhanced 综合得分:  ${report.summary.avgEnhancedComposite} (▲ +${report.summary.overallImprovement} / +${report.summary.improvementPercentage}%)`);
    console.log('='.repeat(60) + '\n');
  }
}

main().catch((err) => {
  console.error('[Writer Benchmark Error]:', err);
  process.exit(1);
});
