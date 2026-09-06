import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, parseVersion, assertRollback } from './release-version.mjs';

test('semantic ordering handles numeric versions, prerelease identifiers and build metadata', () => {
  assert.equal(compareVersions('3.10.0', '3.9.0'), 1);
  assert.equal(compareVersions('3.10.0-beta.10', '3.10.0-beta.9'), 1);
  assert.equal(compareVersions('3.10.0-beta', '3.10.0-beta.1'), -1);
  assert.equal(compareVersions('3.10.0-9', '3.10.0-beta'), -1);
  assert.equal(compareVersions('3.10.0', '3.10.0-rc.9'), 1);
  assert.equal(compareVersions('3.10.0+first', '3.10.0+second'), 0);
  for (const invalid of ['01.2.3', '1.2.3-beta.01', '1.2.3-', '1.2.3+']) {
    assert.throws(() => parseVersion(invalid), /Invalid semantic/u);
  }
});

test('rollback requires an older same-channel version and its matching retained installer', () => {
  const input = { version: '3.10.0', channel: 'stable', repository: 'owner/repo' };
  const previous = {
    previousVersion: '3.9.0',
    previousInstallerUrl: 'https://github.com/owner/repo/releases/download/v3.9.0/app.msi',
  };
  assert.doesNotThrow(() => assertRollback({ ...input, ...previous }));
  for (const patch of [
    { previousVersion: '3.10.0' },
    { previousVersion: '3.11.0' },
    { previousVersion: '3.10.0+build' },
    { previousVersion: '3.9.0-beta.1' },
    { previousInstallerUrl: null },
    { previousVersion: null },
    { previousInstallerUrl: 'https://github.com/owner/repo/releases/download/v3.8.0/app.msi' },
    { previousInstallerUrl: 'https://github.com/untrusted/repo/releases/download/v3.9.0/app.msi' },
  ])
    assert.throws(() => assertRollback({ ...input, ...previous, ...patch }));
});
