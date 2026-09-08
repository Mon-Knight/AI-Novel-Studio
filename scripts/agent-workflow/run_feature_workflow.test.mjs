import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptDir = path.join(root, 'scripts/agent-workflow');
const read = (name) => fs.readFileSync(path.join(scriptDir, name), 'utf8');

function powershell() {
  for (const candidate of process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return undefined;
}
const shell = powershell();
// The nested selector must start as a normal Node process, not inherit this runner's IPC role.
const environment = { ...process.env };
delete environment.NODE_TEST_CONTEXT;
const run = (script, args) =>
  spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    timeout: 120_000,
  });

test('feature preflight is read-only and never invokes the release matrix', () => {
  const source = read('run_feature_workflow.ps1');
  assert.ok(!source.includes('verify_project'), 'preflight must not call verify_project.ps1');
  assert.ok(!/cargo\s+test/u.test(source), 'preflight must not run Rust tests');
  assert.ok(!/npm\s+(?:run\s+)?test/u.test(source), 'preflight must not run npm tests');
  assert.match(source, /verify-change\.mjs/u);
  assert.match(source, /\$code = \$LASTEXITCODE/u);
  assert.match(source, /exit \$code/u);
});

test('workspace suites execute listed Rust cases exactly instead of the whole crate', () => {
  const source = read('run_workspace_test_suite.ps1');
  assert.ok(!/cargo\s+test/u.test(source), 'suite script must not run cargo test directly');
  assert.match(source, /run-cargo-tests\.mjs/u);
  assert.match(source, /'--exact'/u);
  assert.match(source, /exit \$cargoExitCode/u);
  const listed = [...source.matchAll(/^\s+'([a-z_]+::[A-Za-z0-9_:]+)'/gmu)].map(([, name]) => name);
  assert.ok(listed.length >= 16, `expected the full Rust case list, found ${listed.length}`);
  assert.ok(listed.every((name) => /::tests::db\d{2}_/u.test(name)));
  for (const name of ['runtime_check_ai_task_delete.ps1', 'runtime_check_project_backup.ps1']) {
    const runtime = read(name);
    assert.match(runtime, /run-cargo-tests\.mjs --filter (?:ai_task_delete|project_backup_)/u);
    assert.ok(!/cargo\s+test/u.test(runtime));
  }
});

test('release matrix discovers required Rust regressions without executing them early', () => {
  const source = read('verify_project.ps1');
  const discovery = source.indexOf('run-cargo-tests.mjs", "--list-only"');
  const fullRust = source.indexOf('@("test", "--locked", "--", "--test-threads=1")');
  assert.ok(discovery > 0 && fullRust > discovery, 'discovery precedes the single full cargo test');
  assert.ok(!source.includes('test:ai-tasks-delete'), 'aggregator must not rerun delete cases');
  assert.ok(!source.includes('test:project-backup'), 'aggregator must not rerun backup cases');
  assert.equal((source.match(/npm run test:coverage/gu) ?? []).length, 1);
  assert.ok(
    !source.includes('test:coverage:components'),
    'component coverage is read from the first pass',
  );
});

test(
  'verify phase propagates the selector exit code',
  { skip: shell ? false : 'PowerShell is not available on this machine' },
  () => {
    const script = path.join(scriptDir, 'run_feature_workflow.ps1');
    const dryRun = run(script, ['-Phase', 'Verify', '-DryRun']);
    assert.equal(dryRun.status, 0, dryRun.stdout + dryRun.stderr);
    assert.match(dryRun.stdout, /Verification selection:/u);
    const invalid = run(script, ['-Phase', 'Verify', '-DryRun', '-Base', 'refs/no-such-base']);
    assert.notEqual(invalid.status, 0, 'an invalid base must fail instead of returning success');
    const prepare = run(script, ['-Phase', 'Prepare']);
    assert.equal(prepare.status, 0, prepare.stdout + prepare.stderr);
    assert.match(prepare.stdout, /no tests were run/u);
  },
);
