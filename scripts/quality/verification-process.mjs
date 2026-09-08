import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export function verificationEnvironment(env = process.env) {
  const environment = { ...env };
  delete environment.NODE_TEST_CONTEXT;
  if (process.platform === 'win32') {
    const cargoBin = path.join(env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'bin');
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') || 'PATH';
    if (fs.existsSync(path.join(cargoBin, 'cargo.exe')))
      environment[pathKey] = `${environment[pathKey] || ''}${path.delimiter}${cargoBin}`;
  }
  return environment;
}

export function npmCommand(script) {
  const bin = path.dirname(process.execPath);
  const entry = [
    process.env.npm_execpath,
    path.join(bin, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ].find((candidate) => candidate && fs.existsSync(candidate));
  if (!entry) throw new Error('npm CLI could not be resolved; run through npm run verify:change.');
  return { executable: process.execPath, args: [entry, 'run', script] };
}

export function testCommand(root, { runner, files }) {
  const args =
    runner === 'vitest'
      ? [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...files]
      : runner === 'node'
        ? ['--experimental-strip-types', '--test', ...files]
        : runner === 'performance'
          ? ['--expose-gc', '--import', 'tsx', '--test', ...files]
          : [
              path.join(root, 'node_modules/tsx/dist/cli.mjs'),
              '--test',
              '--test-concurrency=1',
              ...files,
            ];
  return { executable: process.execPath, args };
}

export async function runVerificationCommand(command, root, env = process.env) {
  const started = performance.now();
  let tail = '';
  let cases = 0;
  let pending = '';
  const collect = (chunk) => {
    const text = chunk.toString().replace(/\u001b\[[0-9;]*m/gu, '');
    tail = (tail + text).slice(-4000);
    const lines = (pending + text).split(/\r?\n/u);
    pending = lines.pop();
    for (const line of lines) {
      const count =
        line.match(/^(?:#|ℹ) tests (\d+)/u) ||
        line.match(/^\s*Tests\s+.*\((\d+)\)\s*$/u) ||
        line.match(/^test result: .*? (\d+) passed;/u) ||
        line.match(/^\[[^\]]+\]\s+(\d+) passing\b/u);
      if (count) cases += Number(count[1]);
    }
  };
  const environment = verificationEnvironment(env);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      collect(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      tail = (tail + chunk.toString()).slice(-4000);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      collect('\n');
      resolve(code ?? 1);
    });
  });
  return { exitCode, durationMs: Math.round(performance.now() - started), cases, tail };
}
