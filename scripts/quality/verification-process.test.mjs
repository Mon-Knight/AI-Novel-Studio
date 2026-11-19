import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { npmCommand } from './verification-process.mjs';

test('npm commands ignore an inherited non-npm entry even when that file exists', () => {
  const previous = process.env.npm_execpath;
  const otherPackageManager = fileURLToPath(import.meta.url);
  try {
    process.env.npm_execpath = otherPackageManager;
    const command = npmCommand('test:ownership');
    assert.equal(command.executable, process.execPath);
    assert.notEqual(command.args[0], otherPackageManager);
    assert.match(command.args[0].replaceAll('\\', '/'), /\/npm\/bin\/npm-cli\.js$/u);
    assert.deepEqual(command.args.slice(1), ['run', 'test:ownership']);
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  }
});
