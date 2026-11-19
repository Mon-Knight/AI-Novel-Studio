import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const windows = process.platform === 'win32';
const checklistNames = [
  'feature-development',
  'release',
  'ui-review',
  'verification',
  'docs-sync',
  'database-change',
  'tauri-build',
  'bugfix',
];

function runFixture(args) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'ans-local-verifier-'));
  let failure;
  try {
    const bin = path.join(root, 'bin');
    const scriptDirectory = path.join(root, 'scripts', 'agent-workflow');
    const qualityDirectory = path.join(root, 'scripts', 'quality');
    const checklists = path.join(root, '.github', 'checklists');
    for (const directory of [
      bin,
      scriptDirectory,
      qualityDirectory,
      checklists,
      path.join(root, 'src-tauri'),
    ])
      fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"3.7.0"}\n');
    for (const name of checklistNames)
      fs.writeFileSync(path.join(checklists, `${name}.checklist.md`), '# Isolated fixture\n');
    const script = path.join(scriptDirectory, 'verify_project.ps1');
    fs.copyFileSync('scripts/agent-workflow/verify_project.ps1', script);
    fs.writeFileSync(
      path.join(qualityDirectory, 'run-cargo-tests.mjs'),
      "console.log('isolated discovery fixture');\n",
    );
    for (const command of ['npm', 'cargo', 'npx']) {
      const extra =
        command === 'npx'
          ? 'if not exist "%ANS_FIXTURE_ROOT%\\src-tauri\\target\\release" mkdir "%ANS_FIXTURE_ROOT%\\src-tauri\\target\\release"\r\necho fixture>"%ANS_FIXTURE_ROOT%\\src-tauri\\target\\release\\AI Novel Studio.exe"\r\n'
          : '';
      fs.writeFileSync(
        path.join(bin, `${command}.cmd`),
        // Put the redirection before the command: `echo ... 1>>file` would let
        // cmd.exe consume a trailing "1" (e.g. --test-threads=1) as a stream
        // handle instead of echoing it into the trace.
        `@echo off\r\n>>"%ANS_FIXTURE_TRACE%" echo ${command} %*\r\n>>"%ANS_FIXTURE_TRACE%" echo target=%CARGO_TARGET_DIR%\r\n${extra}exit /b 0\r\n`,
      );
    }
    fs.writeFileSync(
      path.join(bin, 'git.cmd'),
      '@echo off\r\necho  M preserved-user-change.txt\r\nexit /b 0\r\n',
    );
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const powershell = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const trace = path.join(root, 'commands.log');
    const result = spawnSync(
      powershell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      {
        cwd: root,
        encoding: 'utf8',
        // The no-bundle fixture exercises the complete local verification matrix
        // through Windows PowerShell. Hosted Windows runners can take slightly
        // longer to start the isolated shell while coverage is active.
        timeout: args.includes('-NoBundle') ? 90_000 : 30_000,
        windowsHide: true,
        env: {
          SystemRoot: systemRoot,
          WINDIR: systemRoot,
          ComSpec: path.join(systemRoot, 'System32', 'cmd.exe'),
          PATH: [bin, path.dirname(process.execPath), path.join(systemRoot, 'System32')].join(
            path.delimiter,
          ),
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
          PSModuleAnalysisCachePath: 'NUL',
          TEMP: os.tmpdir(),
          TMP: os.tmpdir(),
          USERPROFILE: path.join(root, 'isolated-profile'),
          CARGO_TARGET_DIR: path.join(root, 'unapproved-target'),
          ANS_FIXTURE_ROOT: root,
          ANS_FIXTURE_TRACE: trace,
        },
      },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    // Dirty source remains a release blocker; this is not an authorization to commit/clean it.
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[DIRTY\] git status/u);
    assert.match(result.stdout, /RELEASE BLOCKED/u);
    assert.doesNotMatch(result.stdout, /\[FAIL\]/u);
    return fs.readFileSync(trace, 'utf8');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(root));
    assert.ok(relative.startsWith('ans-local-verifier-') && !relative.includes(path.sep));
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (cleanupError) {
      throw failure
        ? new AggregateError(
            [failure, cleanupError],
            'Verifier fixture failed and cleanup was blocked',
          )
        : cleanupError;
    }
  }
}

test(
  'local verification mode uses the normal matrix and only a repository release executable',
  { skip: !windows },
  () => {
    const trace = runFixture(['-NoBundle']);
    assert.match(trace, /npm run test:coverage/u);
    assert.match(trace, /cargo test --locked --workspace -- --test-threads=1/u);
    assert.match(trace, /npm run test:e2e\r?\n/u);
    assert.match(trace, /npm run test:e2e:writing-faults/u);
    assert.match(trace, /npm run dsh:assets\r?\ntarget=\r?\n/u);
    assert.match(trace, /npx tauri build --no-bundle\r?\ntarget=\r?\n/u);
    assert.doesNotMatch(trace, /npm run tauri:build|--bundles/u);
  },
);

test(
  'default release verification retains installer and clean-tree gates',
  { skip: !windows },
  () => {
    const trace = runFixture([]);
    assert.match(trace, /npm run tauri:build\r?\n/u);
    assert.doesNotMatch(trace, /npx tauri build --no-bundle/u);
  },
);
