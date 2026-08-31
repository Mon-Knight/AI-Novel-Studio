import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  REAL_ACCEPTANCE_TAURI_DRIVER_VERSION,
  resolveRealAcceptanceTauriDriver,
  retainSafeRealAcceptanceDiagnostics,
} from './real-conversation-runner-support.ts';

function temporaryDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ans-real-runner-support-'));
}

function installDriver(root: string, version: string, name = 'tauri-driver.exe'): string {
  const executable = path.join(root, 'bin', name);
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'fixture-binary', 'utf8');
  fs.writeFileSync(
    path.join(root, '.crates2.json'),
    JSON.stringify({
      installs: {
        [`tauri-driver ${version} (registry+https://github.com/rust-lang/crates.io-index)`]: {
          version_req: `=${version}`,
          bins: [name],
        },
      },
    }),
    'utf8',
  );
  return executable;
}

test('real acceptance defaults to the repository-pinned tauri-driver version', () => {
  const workspaceRoot = temporaryDirectory();
  try {
    const installRoot = path.join(workspaceRoot, '.e2e-tools', 'tauri-driver');
    const executable = installDriver(installRoot, REAL_ACCEPTANCE_TAURI_DRIVER_VERSION);
    const resolution = resolveRealAcceptanceTauriDriver({ workspaceRoot, platform: 'win32' });

    assert.equal(resolution.executable, executable);
    assert.equal(resolution.source, 'repository-pinned');
    assert.equal(resolution.version, REAL_ACCEPTANCE_TAURI_DRIVER_VERSION);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('real acceptance keeps an explicit driver override but rejects version drift', () => {
  const workspaceRoot = temporaryDirectory();
  try {
    const accepted = installDriver(
      path.join(workspaceRoot, 'accepted'),
      REAL_ACCEPTANCE_TAURI_DRIVER_VERSION,
    );
    const resolution = resolveRealAcceptanceTauriDriver({
      workspaceRoot,
      explicit: accepted,
      platform: 'win32',
    });
    assert.equal(resolution.executable, accepted);
    assert.equal(resolution.source, 'explicit');

    const drifted = installDriver(path.join(workspaceRoot, 'drifted'), '2.0.6');
    assert.throws(
      () =>
        resolveRealAcceptanceTauriDriver({
          workspaceRoot,
          explicit: drifted,
          platform: 'win32',
        }),
      /expected 0\.1\.5, received 2\.0\.6/,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('retained failure diagnostics contain only bounded sanitized scalar evidence', () => {
  const root = temporaryDirectory();
  const dataDirectory = path.join(root, 'data');
  const evidenceDirectory = path.join(root, 'evidence');
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    const credential = `agt_${'Z'.repeat(24)}`;
    fs.writeFileSync(
      path.join(dataDirectory, 'e2e-rust.log'),
      [
        'runtime: E2E marker and isolated directories verified',
        'startup-timing: scope=database stage=open phase_ms=12 total_ms=34',
        `credential=${credential}`,
        'chapter=这是一段不应进入诊断证据的正文',
        'path=C:\\Users\\Private\\novel.db',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dataDirectory, 'native-crash-reports.jsonl'),
      `${JSON.stringify({
        schemaVersion: 1,
        capturedAt: '2026-08-30T10:33:22.000Z',
        kind: 'rust_panic',
        appVersion: '3.6.0',
        sourceFile: 'task_runtime.rs',
        sourceLine: 3166,
        sourceColumn: 13,
        message: credential,
      })}\n${JSON.stringify({
        schemaVersion: 1,
        capturedAt: '2026-08-30T10:33:23.000Z',
        kind: 'rust_panic',
        appVersion: '3.6.0',
        sourceFile: 'C:\\private\\main.rs',
        sourceLine: 1,
        sourceColumn: 1,
      })}\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(dataDirectory, 'ai-novel-studio.db'), credential, 'utf8');

    const retained = retainSafeRealAcceptanceDiagnostics({ dataDirectory, evidenceDirectory });
    assert.equal(retained.files.length, 2);
    const encoded = retained.files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(encoded, /agt_/);
    assert.doesNotMatch(encoded, /C:\\Users|C:\\private/i);
    assert.doesNotMatch(encoded, /不应进入诊断证据/);
    assert.match(encoded, /E2E marker and isolated directories verified/);
    assert.match(encoded, /startup-timing: scope=database stage=open phase_ms=12 total_ms=34/);
    assert.match(encoded, /"rejectedLineCount": 3/);
    assert.match(encoded, /task_runtime\.rs/);
    assert.match(encoded, /"reportCount": 1/);
    assert.equal(
      fs.existsSync(path.join(evidenceDirectory, 'diagnostics', 'ai-novel-studio.db')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
