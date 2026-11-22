import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { npmCommand, verificationEnvironment } from './verification-process.mjs';

export function buildCoveragePlan(root, env = process.env) {
  const c8Entry = path.join(root, 'node_modules/c8/bin/c8.js');
  const testAll = npmCommand('test:all');
  const coreReport = npmCommand('test:coverage:core');
  const criticalGate = path.join(root, 'scripts/check-critical-component-coverage.mjs');

  const c8Env = verificationEnvironment(env);
  delete c8Env.ANS_SKIP_CRITICAL_COMPONENT_COVERAGE;
  c8Env.ANS_COLLECT_CRITICAL_COVERAGE = '1';

  const reportEnv = verificationEnvironment(env);

  return {
    cleanDirs: [path.join(root, 'coverage/tmp'), path.join(root, 'coverage/critical-components')],
    steps: [
      {
        id: 'c8-test-all',
        executable: process.execPath,
        args: [
          c8Entry,
          '--temp-directory',
          'coverage/tmp',
          '--all',
          '--src',
          'src',
          '--include',
          'src/**/*.ts',
          '--include',
          'src/**/*.tsx',
          '--exclude',
          'src/**/*.test.ts',
          '--exclude',
          'src/**/*.test.tsx',
          '--exclude',
          'src/test/**',
          '--exclude',
          'src/**/*.d.ts',
          '--check-coverage',
          '--lines',
          '34',
          '--statements',
          '34',
          '--functions',
          '44',
          '--branches',
          '64',
          '--reporter',
          'text-summary',
          testAll.executable,
          ...testAll.args,
        ],
        env: c8Env,
      },
      {
        id: 'c8-core-report',
        executable: coreReport.executable,
        args: coreReport.args,
        env: reportEnv,
      },
      {
        id: 'critical-components-gate',
        executable: process.execPath,
        args: [criticalGate],
        env: reportEnv,
      },
    ],
  };
}

export function runCoverageGate(
  { root = process.cwd(), env = process.env } = {},
  { rmSync = fs.rmSync, run = spawnSync } = {},
) {
  const plan = buildCoveragePlan(root, env);
  for (const directory of plan.cleanDirs) {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const step of plan.steps) {
    const result = run(step.executable, step.args, {
      cwd: root,
      env: step.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Coverage step ${step.id} failed (${result.status ?? 'not started'}): ${result.error?.message ?? 'non-zero exit'}`,
      );
    }
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCoverageGate();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
