import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  E2E_BUILD_INPUT_PATHS,
  canReuseE2eBuild,
  computeE2eBuildInputFingerprint,
  writeE2eBuildStamp,
} from './e2e-build-stamp.ts';

function withTempWorkspace(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-e2e-stamp-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('computeE2eBuildInputFingerprint changes when build inputs change and ignores test-only files', () => {
  withTempWorkspace((root) => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const appFile = path.join(root, 'src', 'App.tsx');
    const unitTestFile = path.join(root, 'src', 'example.test.ts');
    fs.writeFileSync(appFile, 'export const v = 1;\n', 'utf8');
    fs.writeFileSync(unitTestFile, 'export const testCase = 1;\n', 'utf8');

    let changedFiles = ['src/App.tsx'];
    const mockGit = (args: string[]) => {
      if (args[0] === 'rev-parse') return 'abc123\n';
      assert.ok(E2E_BUILD_INPUT_PATHS.every((entry) => args.includes(entry)));
      if (args[0] === 'diff') return `${changedFiles.join('\0')}\0`;
      return '';
    };

    const first = computeE2eBuildInputFingerprint(root, mockGit);
    assert.ok(first);
    assert.equal(computeE2eBuildInputFingerprint(root, mockGit), first);

    changedFiles = ['src/App.tsx', 'src/example.test.ts'];
    assert.equal(computeE2eBuildInputFingerprint(root, mockGit), first);

    changedFiles = ['src/App.tsx', 'src/example.test.ts', 'src-tauri/src/runtime_tests.rs'];
    assert.equal(computeE2eBuildInputFingerprint(root, mockGit), first);

    fs.writeFileSync(appFile, 'export const v = 2;\n', 'utf8');
    const second = computeE2eBuildInputFingerprint(root, mockGit);
    assert.ok(second);
    assert.notEqual(second, first);

    const failed = computeE2eBuildInputFingerprint(root, () => {
      throw new Error('git unavailable');
    });
    assert.equal(failed, null);
  });
});

test('canReuseE2eBuild validates matching stamp, binary bytes, and rejects stale or tampered binaries', () => {
  withTempWorkspace((root) => {
    const appPath = path.join(root, 'release', 'AI Novel Studio.exe');
    const stampPath = path.join(root, 'release', '.ans-e2e-build-stamp.json');
    fs.mkdirSync(path.dirname(appPath), { recursive: true });
    fs.writeFileSync(appPath, 'binary-v1', 'utf8');

    writeE2eBuildStamp({ stampPath, appPath, inputFingerprint: 'fp-1' });

    assert.equal(canReuseE2eBuild({ stampPath, appPath, inputFingerprint: 'fp-1' }), true);
    assert.equal(canReuseE2eBuild({ stampPath, appPath, inputFingerprint: 'fp-2' }), false);
    assert.equal(canReuseE2eBuild({ stampPath, appPath, inputFingerprint: null }), false);

    fs.writeFileSync(appPath, 'binary-v2', 'utf8');
    assert.equal(canReuseE2eBuild({ stampPath, appPath, inputFingerprint: 'fp-1' }), false);
  });
});
