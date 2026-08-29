import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readDriverExitReport,
  waitForDriverExitReport,
  writeDriverExitReport,
  writeUnexpectedDriverExitReport,
} from './driver-liveness-guard.ts';

test('driver exit report is bounded, sanitized, and immutable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-driver-liveness-'));
  const reportPath = path.join(root, 'driver-exit.json');
  try {
    assert.equal(
      writeDriverExitReport(reportPath, {
        kind: 'process_exit',
        exitCode: 134,
        signal: null,
        observedAt: '2026-08-29T00:00:00.000Z',
      }),
      true,
    );
    assert.deepEqual(readDriverExitReport(reportPath), {
      schemaVersion: 1,
      kind: 'process_exit',
      exitCode: 134,
      signal: null,
      observedAt: '2026-08-29T00:00:00.000Z',
    });

    assert.equal(
      writeDriverExitReport(reportPath, {
        kind: 'process_error',
        observedAt: '2026-08-29T00:01:00.000Z',
      }),
      false,
    );
    assert.equal(readDriverExitReport(reportPath)?.kind, 'process_exit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('driver exit report rejects unbounded or malformed diagnostics', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-driver-liveness-'));
  const reportPath = path.join(root, 'driver-exit.json');
  try {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'process_exit',
        exitCode: 1,
        signal: null,
        observedAt: '2026-08-29T00:00:00.000Z',
        apiKey: 'agt_must_not_be_accepted',
      }),
      'utf8',
    );
    assert.throws(() => readDriverExitReport(reportPath), /unexpected fields/);

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'process_exit',
        exitCode: 1,
        signal: null,
        observedAt: 'not-a-timestamp',
      }),
      'utf8',
    );
    assert.throws(() => readDriverExitReport(reportPath), /invalid timestamp/);

    fs.writeFileSync(reportPath, 'x'.repeat(4097), 'utf8');
    assert.throws(() => readDriverExitReport(reportPath), /bounded regular file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('driver exit report ignores credential-shaped input and normal shutdowns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-driver-liveness-'));
  const reportPath = path.join(root, 'driver-exit.json');
  const credential = 'agt_driver_liveness_secret_123456';
  try {
    assert.equal(
      writeUnexpectedDriverExitReport(
        reportPath,
        { ready: false, shutdownRequested: false, exitReported: false },
        {
          kind: 'process_error',
          observedAt: '2026-08-29T00:01:00.000Z',
        },
      ),
      false,
    );
    assert.equal(
      writeUnexpectedDriverExitReport(
        reportPath,
        { ready: true, shutdownRequested: true, exitReported: false },
        {
          kind: 'process_exit',
          exitCode: 0,
          observedAt: '2026-08-29T00:02:00.000Z',
        },
      ),
      false,
    );
    assert.equal(fs.existsSync(reportPath), false);

    assert.equal(
      writeUnexpectedDriverExitReport(
        reportPath,
        { ready: true, shutdownRequested: false, exitReported: false },
        {
          kind: 'process_exit',
          exitCode: 134,
          signal: null,
          observedAt: '2026-08-29T00:03:00.000Z',
          apiKey: credential,
        } as Parameters<typeof writeUnexpectedDriverExitReport>[2] & { apiKey: string },
      ),
      true,
    );
    assert.doesNotMatch(fs.readFileSync(reportPath, 'utf8'), new RegExp(credential));
    assert.deepEqual(readDriverExitReport(reportPath), {
      schemaVersion: 1,
      kind: 'process_exit',
      exitCode: 134,
      signal: null,
      observedAt: '2026-08-29T00:03:00.000Z',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('driver liveness wait resolves promptly and can be cancelled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-driver-liveness-'));
  const reportPath = path.join(root, 'driver-exit.json');
  try {
    const waiting = waitForDriverExitReport(reportPath, { pollIntervalMs: 5 });
    setTimeout(
      () =>
        writeDriverExitReport(reportPath, {
          kind: 'process_error',
          observedAt: '2026-08-29T00:02:00.000Z',
        }),
      10,
    );
    assert.equal((await waiting)?.kind, 'process_error');

    fs.rmSync(reportPath, { force: true });
    const controller = new AbortController();
    const cancelled = waitForDriverExitReport(reportPath, {
      signal: controller.signal,
      pollIntervalMs: 1000,
    });
    setTimeout(() => controller.abort(), 10);
    assert.equal(await cancelled, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
