import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verificationEnvironment } from './verification-process.mjs';

export function selectRustTests(output, { exact = [], filters = [] }) {
  if (!exact.length && !filters.length) throw new Error('An exact test or filter is required.');
  const listed = output
    .split(/\r?\n/u)
    .filter((line) => line.endsWith(': test'))
    .map((line) => line.slice(0, -6));
  const selected = new Set();
  for (const name of new Set(exact)) {
    if (listed.filter((item) => item === name).length !== 1)
      throw new Error(`Required Rust test '${name}' is missing or ambiguous.`);
    selected.add(name);
  }
  for (const filter of new Set(filters)) {
    if (!filter.trim()) throw new Error('Empty Rust filter is not allowed.');
    const matches = listed.filter((name) => name.includes(filter));
    if (!matches.length) throw new Error(`Rust filter '${filter}' matched zero tests.`);
    matches.forEach((name) => selected.add(name));
  }
  return [...selected].sort();
}

export function runCargoTests(
  { exact = [], filters = [], listOnly = false, root = process.cwd() },
  run = spawnSync,
) {
  const common = [
    'test',
    '--locked',
    '--manifest-path',
    path.join(root, 'src-tauri/Cargo.toml'),
    '-p',
    'ai-novel-studio',
  ];
  const invoke = (args, capture = false) => {
    const result = run('cargo', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: verificationEnvironment(),
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!capture && result.stdout) process.stdout.write(result.stdout);
    if (result.error || result.status !== 0)
      throw new Error(
        `cargo failed (${result.status ?? 'not started'}): ${result.error?.message ?? args.join(' ')}`,
      );
    if (!capture && !/test result:.*? [1-9]\d* passed;/u.test(result.stdout ?? ''))
      throw new Error('Rust execution reported zero passed tests; discovery alone is not a pass.');
    return result.stdout ?? '';
  };
  const selected = selectRustTests(invoke([...common, '--', '--list'], true), { exact, filters });
  console.log(
    `Rust selection: ${selected.length} tests${listOnly ? ' (discovery only; not execution evidence)' : ''}`,
  );
  if (!listOnly) {
    // A single substring can execute its validated set in one Cargo invocation.
    // Mixed/overlapping selections use unique exact names so no case executes twice.
    if (filters.length === 1 && !exact.length)
      invoke([...common, filters[0], '--', '--nocapture', '--test-threads=1']);
    else
      for (const name of selected)
        invoke([...common, name, '--', '--exact', '--nocapture', '--test-threads=1']);
  }
  return selected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = { exact: [], filters: [], listOnly: false };
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--list-only') options.listOnly = true;
      else if (['--exact', '--filter'].includes(arg)) {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
        options[arg === '--exact' ? 'exact' : 'filters'].push(value);
      } else throw new Error(`Unknown Rust selection argument: ${arg}`);
    }
    runCargoTests(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
