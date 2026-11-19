import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { ensureDist } from './ensure-dist.mjs';

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), 'ensure-dist-'));
}

test('an existing dist/index.html is left alone without spawning a build', () => {
  const root = scratch();
  try {
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html>');
    let spawned = 0;
    const result = ensureDist(root, () => {
      spawned += 1;
      return { status: 0 };
    });
    assert.equal(result.built, false);
    assert.equal(spawned, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing dist/ runs the npm CLI through node once and verifies the marker afterwards', () => {
  const root = scratch();
  try {
    const calls = [];
    const result = ensureDist(root, (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, shell: options.shell });
      mkdirSync(path.join(root, 'dist'), { recursive: true });
      writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html>');
      return { status: 0 };
    });
    assert.equal(result.built, true);
    assert.equal(calls.length, 1);
    // Never `npm.cmd`: Node 22+ on Windows rejects .cmd spawns without a shell (EINVAL).
    assert.equal(calls[0].command, process.execPath);
    assert.match(calls[0].args[0], /npm-cli\.js$/u);
    assert.deepEqual(calls[0].args.slice(1), ['run', 'build']);
    assert.equal(calls[0].cwd, root);
    assert.equal(calls[0].shell, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing or marker-less build fails closed', () => {
  const root = scratch();
  try {
    assert.throws(() => ensureDist(root, () => ({ status: 3 })), /exit 3/u);
    assert.throws(() => ensureDist(root, () => ({ status: 0 })), /still missing/u);
    assert.throws(() => ensureDist(root, () => ({ error: new Error('spawn ENOENT') })), /ENOENT/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
