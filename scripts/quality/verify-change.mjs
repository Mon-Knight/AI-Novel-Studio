import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  verificationScopes,
  isDocumentation,
  isVersionDocument,
  packageScope,
} from './verification-scopes.mjs';
import { importedRunner, executionBatches } from './test-ownership.mjs';
import { npmCommand, testCommand, runVerificationCommand } from './verification-process.mjs';

const unitFile = /\.test\.(?:mjs|js|ts|tsx)$/u;
const formattable = /\.(?:[cm]?js|jsx|ts|tsx|json|md|mdc|css|ya?ml|html)$/u;
const sourceFile = /^src\/.*\.(?:ts|tsx)$/u;
const normalize = (file) => {
  const normalized = file.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/u.test(normalized)
  )
    throw new Error(`Expected repository-relative file: ${file}`);
  return normalized;
};

export function changedFiles(
  root,
  base,
  git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
) {
  const files = [];
  if (base) {
    const revision = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
    files.push(
      ...git(['diff', '--name-only', '--no-renames', '-z', `${revision}...HEAD`]).split('\0'),
    );
  }
  files.push(...git(['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--']).split('\0'));
  files.push(...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'));
  return [...new Set(files.filter(Boolean).map(normalize))].sort();
}

export function createVerificationPlan(
  files,
  testFiles,
  { full = false, existing = () => true, manifests } = {},
) {
  const plan = {
    files: [...new Set(files.map(normalize))].sort(),
    reasons: [],
    tests: [],
    e2e: [],
    coverage: full,
    rustFull: full,
    rustCheck: full,
    rustFilters: [],
    desktopFull: full,
    production: full,
    docs: full,
    version: full,
    browser: full,
    typecheck: full,
    build: full,
    lint: [],
    format: [],
  };
  const units = testFiles.filter((file) => unitFile.test(file));
  for (const file of plan.files) {
    plan.rustCheck ||= /^src-tauri\/.*\.rs$/u.test(file);
    if (existing(file) && formattable.test(file) && !file.endsWith('.mdc')) plan.format.push(file);
    if (sourceFile.test(file) && !unitFile.test(file)) {
      plan.typecheck = true;
      if (existing(file)) plan.lint.push(file);
    }
    if (isDocumentation(file)) {
      plan.docs = true;
      plan.version ||= isVersionDocument(file);
      plan.reasons.push({
        file,
        scope: 'documentation',
        evidence: 'docs-sync; version sync only where applicable',
      });
      continue;
    }
    if (
      [
        '.gitignore',
        '.gitattributes',
        '.editorconfig',
        '.npmrc',
        '.nvmrc',
        '.node-version',
      ].includes(file)
    ) {
      plan.reasons.push({ file, scope: 'repository configuration', evidence: 'diff check' });
      continue;
    }
    // Changed executable unit tests run directly, using their declared runner.
    if (unitFile.test(file) && existing(file)) {
      plan.tests.push(file);
      plan.reasons.push({ file, scope: 'changed unit test', evidence: file });
      continue;
    }
    if (/^tests\/e2e\/.*\.spec\.ts$/u.test(file) && existing(file)) {
      if (file.endsWith('/creative-agent-workflow.spec.ts')) {
        plan.tests.push('src/features/agent/agentConversationWorkbench.test.tsx');
      } else plan.e2e.push(path.posix.basename(file, '.spec.ts'));
      plan.reasons.push({
        file,
        scope: 'desktop scenario',
        evidence: 'real Tauri with isolated SQLite',
      });
      continue;
    }
    const rule =
      file === 'package.json' && manifests
        ? packageScope(manifests.before, manifests.after)
        : verificationScopes.find((candidate) => candidate.match.test(file));
    if (!rule)
      throw new Error(
        `Unmapped change: ${file}. Add its behavior ownership to verification-scopes.mjs.`,
      );
    const stem = file.replace(/\.[^.]+$/u, '');
    const adjacent = units.filter((candidate) => candidate.startsWith(`${stem}.test.`));
    const moduleTests = units.filter((candidate) =>
      (rule.tests ?? []).some((prefix) => candidate.startsWith(prefix)),
    );
    const selected = [...(adjacent.length ? adjacent : moduleTests), ...(rule.safety ?? [])];
    if (
      !selected.length &&
      !rule.coverage &&
      !rule.rustFull &&
      !rule.rustFilters?.length &&
      !rule.desktopFull &&
      !rule.e2e?.length &&
      !rule.browser &&
      !rule.metadataOnly
    )
      throw new Error(
        `No behavior tests for ${file} (${rule.name}). Add a test or explicit scenario owner.`,
      );
    for (const test of selected)
      if (!units.includes(test)) throw new Error(`Missing owned test: ${test}`);
    plan.tests.push(...selected);
    plan.e2e.push(...(rule.e2e ?? []));
    plan.rustFilters.push(...(rule.rustFilters ?? []));
    for (const key of [
      'coverage',
      'rustFull',
      'desktopFull',
      'production',
      'docs',
      'version',
      'browser',
    ])
      plan[key] ||= Boolean(rule[key]);
    plan.build ||= Boolean(rule.production || rule.coverage);
    plan.reasons.push({
      file,
      scope: rule.name,
      evidence: adjacent.length
        ? 'adjacent behavior tests plus domain safety/journeys'
        : (rule.reason ?? 'owned domain tests/journeys'),
    });
  }
  for (const key of ['tests', 'e2e', 'rustFilters', 'lint', 'format'])
    plan[key] = [...new Set(plan[key])].sort();
  // Full aggregators subsume targeted executions. Discovery gates still verify ownership.
  if (plan.coverage) plan.tests = [];
  if (plan.rustFull) plan.rustFilters = [];
  if (plan.desktopFull) plan.e2e = [];
  return plan;
}

/**
 * The C8 coverage thresholds (`test:coverage`) are calibrated on the Windows/Node 24
 * release toolchain; on Linux, C8 does not attribute the `tsx --test` child-process
 * coverage the same way and the core-set gate reports ~10 points lower for identical
 * tests. Other platforms therefore execute the identical full matrix (`test:all`) and
 * leave threshold enforcement to the Windows release gate, exactly as before the
 * change-scoped selector existed.
 */
export function coverageCommandFor(platform) {
  return platform === 'win32'
    ? { script: 'test:coverage', thresholds: true }
    : { script: 'test:all', thresholds: false };
}

export function verificationCommands(
  plan,
  {
    root,
    lane = 'all',
    source = (file) => fs.readFileSync(path.join(root, file), 'utf8'),
    platform = process.platform,
  },
) {
  if (!['all', 'frontend', 'native', 'desktop'].includes(lane))
    throw new Error(`Unknown verification lane: ${lane}`);
  const steps = [];
  const add = (id, target, command, extra = {}) => {
    if (lane === 'all' || lane === target) steps.push({ id, lane: target, ...command, ...extra });
  };
  const node = (args) => ({ executable: process.execPath, args });
  const bin = (name, args = []) => node([path.join(root, 'node_modules', name), ...args]);
  const ps = (file) => ({
    executable: process.platform === 'win32' ? 'powershell' : 'pwsh',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
  });
  if (plan.files.length || plan.coverage)
    add('diff', 'frontend', { executable: 'git', args: ['diff', '--check'] });
  if (plan.format.length)
    add('format', 'frontend', bin('prettier/bin/prettier.cjs', ['--check', '--', ...plan.format]));
  if (plan.docs) {
    add('capability-docs', 'native', node(['scripts/quality/check-capability-docs.mjs']));
    add('docs-sync', 'native', ps('scripts/agent-workflow/test_docs_sync.ps1'));
  }
  if (plan.version)
    add('version-sync', 'native', ps('scripts/agent-workflow/check_version_sync.ps1'));
  if (plan.coverage) {
    const coverage = coverageCommandFor(platform);
    add('coverage', 'frontend', npmCommand(coverage.script), {
      requiresCases: true,
      ...(coverage.thresholds
        ? {}
        : {
            note: 'coverage thresholds are calibrated on the Windows release toolchain; this platform runs the same full matrix without threshold enforcement',
          }),
    });
  } else {
    const entries = plan.tests.map((file) => ({
      file,
      runner: importedRunner(file, source(file)),
    }));
    for (const [index, batch] of executionBatches(entries).entries())
      add(`behavior-${index + 1}`, 'frontend', testCommand(root, batch), {
        testFiles: batch.files.length,
        requiresCases: true,
      });
  }
  if (plan.coverage) add('lint', 'frontend', npmCommand('lint:ci'));
  else if (plan.lint.length)
    add(
      'lint',
      'frontend',
      bin('eslint/bin/eslint.js', ['--max-warnings', '0', '--', ...plan.lint]),
    );
  if (plan.build) {
    add('frontend-build', 'frontend', npmCommand('build'));
    add('bundle-budget', 'frontend', npmCommand('test:bundle-size'));
    add('component-size', 'frontend', npmCommand('test:component-size'));
  } else if (plan.typecheck) add('types', 'frontend', bin('typescript/bin/tsc', ['--noEmit']));
  if (plan.browser)
    add('browser', 'frontend', npmCommand('test:e2e:browser'), { requiresCases: true });
  const cargo = (args) => ({
    executable: 'cargo',
    args: [...args, '--manifest-path', 'src-tauri/Cargo.toml'],
  });
  if (plan.rustCheck || plan.rustFull || plan.rustFilters.length)
    add('rust-check', 'native', cargo(['check', '--locked']));
  if (plan.rustFull) {
    add('gateway-clean', 'native', cargo(['clean', '-p', 'novel-domain-gateway']));
    add('gateway-build', 'native', cargo(['build', '--locked', '-p', 'novel-domain-gateway']));
    add(
      'rust-discovery',
      'native',
      node([
        'scripts/quality/run-cargo-tests.mjs',
        '--list-only',
        '--filter',
        'ai_task_delete',
        '--filter',
        'project_backup_',
      ]),
    );
    add('rust-full', 'native', {
      requiresCases: true,
      executable: 'cargo',
      args: [
        'test',
        '--locked',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--',
        '--test-threads=1',
      ],
    });
  } else if (plan.rustFilters.length)
    add(
      'rust-selected',
      'native',
      node([
        'scripts/quality/run-cargo-tests.mjs',
        ...plan.rustFilters.flatMap((filter) => ['--filter', filter]),
      ]),
      { requiresCases: true },
    );
  if (plan.desktopFull || plan.e2e.length)
    add(
      'desktop',
      'desktop',
      node([
        'node_modules/tsx/dist/cli.mjs',
        'scripts/e2e/run-e2e.ts',
        ...(plan.desktopFull ? [] : plan.e2e.flatMap((spec) => ['--spec', spec])),
      ]),
      { requiresCases: true },
    );
  if (plan.production) add('production-build', 'native', npmCommand('tauri:build'));
  return steps;
}

export async function executeVerification(steps, root, run = runVerificationCommand) {
  const results = [];
  for (const step of steps) {
    console.log(`[verify:change] ${step.id}: ${JSON.stringify([step.executable, ...step.args])}`);
    if (step.note) console.log(`[verify:change] ${step.id}: ${step.note}`);
    try {
      const result = await run(step, root);
      const empty = step.requiresCases && result.exitCode === 0 && !result.cases;
      results.push({
        id: step.id,
        testFiles: step.testFiles,
        ...result,
        status: result.exitCode === 0 && !empty ? 'PASS' : 'FAIL',
        ...(empty ? { error: 'Zero executed test cases; selection or runner must be fixed.' } : {}),
      });
    } catch (error) {
      results.push({ id: step.id, status: 'FAIL', exitCode: 1, error: error.message });
    }
    // Independent checks still supply useful evidence after a failure. Do not build
    // downstream artifacts from failed builds or run Rust against a stale gateway.
    if (
      results.at(-1).status === 'FAIL' &&
      ['gateway-clean', 'gateway-build', 'frontend-build'].includes(step.id)
    )
      break;
  }
  const executed = new Set(results.map(({ id }) => id));
  results.push(
    ...steps
      .filter(({ id }) => !executed.has(id))
      .map(({ id }) => ({ id, status: 'NOT_RUN', reason: 'prerequisite failed' })),
  );
  return results;
}

export function parseVerificationArgs(args) {
  const options = { lane: 'all' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--dry-run', '--full', '--json', '--github-output'].includes(arg))
      options[arg.slice(2)] = true;
    else if (['--base', '--lane', '--report'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown verification argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseVerificationArgs(process.argv.slice(2));
  const root = process.cwd();
  const files = changedFiles(root, options.base);
  let manifests;
  if (files.includes('package.json')) {
    // Use the same merge base as --base; a local run compares against HEAD.
    const revision = options.base
      ? execFileSync('git', ['merge-base', '--', options.base, 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim()
      : 'HEAD';
    manifests = {
      before: JSON.parse(
        execFileSync('git', ['show', `${revision}:package.json`], { cwd: root, encoding: 'utf8' }),
      ),
      after: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    };
  }
  const testFiles = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'src',
      'scripts',
      'tests',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => unitFile.test(file) && fs.existsSync(path.join(root, file)));
  const plan = createVerificationPlan(files, [...new Set(testFiles)], {
    full: options.full,
    manifests,
    existing: (file) => fs.existsSync(path.join(root, file)),
  });
  const steps = verificationCommands(plan, { root, lane: options.lane });
  if (options['github-output']) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
    const values = {
      coverage: plan.coverage,
      rust: plan.rustCheck || plan.rustFull || plan.rustFilters.length > 0 || plan.production,
      rust_full: plan.rustFull,
      desktop: plan.desktopFull || plan.e2e.length > 0,
      desktop_full: plan.desktopFull,
      production: plan.production,
      docs: plan.docs,
      version: plan.version,
    };
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  console.log(
    options.json
      ? JSON.stringify({ plan, steps }, null, 2)
      : `Verification selection: ${files.length} changed files, ${steps.length} commands, ${plan.tests.length} targeted test files.\n` +
          plan.reasons.map(({ file, scope }) => `  ${file} -> ${scope}`).join('\n'),
  );
  if (options['dry-run']) {
    if (!options.json)
      for (const step of steps) {
        console.log(`  ${step.id}: ${JSON.stringify([step.executable, ...step.args])}`);
        if (step.note) console.log(`    ${step.note}`);
      }
    return;
  }
  const results = await executeVerification(steps, root);
  if (!steps.length)
    console.log(
      'NOT_APPLICABLE: no checks in this lane for the selected change; no tests claimed.',
    );
  for (const result of results)
    console.log(
      `[${result.status}] ${result.id}: ${result.durationMs ?? 0} ms; ${result.cases ?? 0} reported test cases`,
    );
  if (options.report) {
    const report = path.resolve(root, options.report);
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify({ plan, results }, null, 2) + '\n');
  }
  if (results.some(({ status }) => status !== 'PASS')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
