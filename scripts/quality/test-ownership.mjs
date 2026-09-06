import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import ts from 'typescript';

const testFile = /\.(?:test|spec)\.(?:mjs|js|ts|tsx)$/u;
const specFile = /\.spec\.(?:mjs|js|ts|tsx)$/u;

function importedRunner(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const modules = parsed.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier.text);
  const node = modules.includes('node:test');
  const vitest = modules.includes('vitest');
  if (node === vitest) throw new Error(`unknown test runner (or mixed imports): ${file}`);
  if (vitest) return 'vitest';
  if (file.startsWith('scripts/performance/')) return 'performance';
  return /\.[cm]?js$/u.test(file) ? 'node' : 'tsx';
}

function defaultCommands(scripts, name = 'test:all', stack = []) {
  if (stack.includes(name)) throw new Error(`Recursive test script: ${name}`);
  const script = scripts[name];
  if (!script) throw new Error(`Missing default test script: ${name}`);
  return script.split(/\s*&&\s*/u).flatMap((command) => {
    const nested = command.match(/^npm\s+(?:run\s+([^\s]+)|test)$/u);
    if (!nested) return [command];
    const next = nested[1] || 'test';
    if (next === 'test:discovered') return ['@discovered'];
    return defaultCommands(scripts, next, [...stack, name]);
  });
}

export function buildTestInventory({
  files,
  scripts,
  desktopRunner = '',
  browserRunner = '',
  liveRunner = '',
}) {
  const commands = defaultCommands(scripts);
  const discovered = commands.includes('@discovered');
  const assigned = new Map();
  const excluded = [];
  const executable = Object.keys(files).filter((file) => !specFile.test(file));
  const runners = new Map(executable.map((file) => [file, importedRunner(file, files[file])]));
  for (const command of commands) {
    const tokens =
      command.match(/"[^"]*"|'[^']*'|\S+/gu)?.map((token) => token.replace(/^["']|["']$/gu, '')) ||
      [];
    const runner =
      tokens[0] === 'vitest'
        ? 'vitest'
        : tokens[0] === 'tsx'
          ? 'tsx'
          : tokens[0] === 'node' && tokens.includes('--test')
            ? tokens.includes('--expose-gc')
              ? 'performance'
              : tokens.includes('tsx')
                ? 'tsx'
                : 'node'
            : undefined;
    if (!runner) continue;
    for (const token of tokens.filter((value) => /^(?:src|scripts|tests)(?:\/|$)/u.test(value))) {
      if (testFile.test(token) && !(token in files))
        throw new Error(`missing test referenced by default script: ${token}`);
      const members = testFile.test(token)
        ? [token]
        : runner === 'vitest'
          ? executable.filter((file) => file.startsWith(`${token.replace(/\/$/u, '')}/`))
          : [];
      for (const file of members) {
        if (runners.get(file) !== runner)
          throw new Error(
            `runner mismatch: ${file} requires ${runners.get(file)}, received ${runner}`,
          );
        assigned.set(file, command);
      }
    }
  }
  const desktopNames = desktopRunner.match(/const allSpecs\s*=\s*\[([\s\S]*?)\]/u)?.[1] || '';
  for (const file of Object.keys(files).filter((entry) => specFile.test(entry))) {
    if (file === 'tests/e2e/creative-agent-workflow.spec.ts') {
      excluded.push({
        file,
        runner: 'legacy-experimental (NOT_RUN)',
        reason:
          'Historical experimental Agent UI, not the production writing workbench. Component behavior is covered by src/features/agent/agentConversationWorkbench.test.tsx; this is NOT desktop acceptance.',
      });
    } else if (file.startsWith('tests/e2e/')) {
      if (!desktopNames.includes(`'${path.posix.basename(file)}'`))
        throw new Error(`desktop spec not registered in allSpecs: ${file}`);
      excluded.push({
        file,
        runner: 'test:e2e',
        reason:
          'Real Windows Tauri/SQLite and isolated driver required; not a Node/Vitest unit test.',
      });
    } else if (
      file.startsWith('tests/browser/') &&
      file.endsWith('.browser.spec.ts') &&
      browserRunner.includes('*.browser.spec.ts')
    ) {
      excluded.push({
        file,
        runner: 'test:e2e:browser',
        reason: 'Real browser and Vite fixture required; executed by the dedicated browser CI.',
      });
    } else if (
      file === 'tests/real-acceptance/conversation-60000.spec.ts' &&
      liveRunner.includes('conversation-60000.spec.ts')
    ) {
      excluded.push({
        file,
        runner: 'test:e2e:real-conversation',
        reason:
          'Explicit opt-in real Provider authorization, credentials and budget required; never run in test:all.',
      });
    } else throw new Error(`unowned spec: ${file}`);
  }
  const supplemental = executable
    .filter((file) => !assigned.has(file))
    .sort()
    .map((file) => ({ file, runner: runners.get(file) }));
  if (supplemental.length && !discovered)
    throw new Error('New tests are not reachable: test:discovered must be in test:all.');
  return { assigned: [...assigned.keys()].sort(), supplemental, excluded };
}

export function executionBatches(entries, maxCharacters = 12000) {
  const result = [];
  for (const runner of ['node', 'tsx', 'vitest', 'performance']) {
    let files = [];
    for (const { file } of entries.filter((entry) => entry.runner === runner)) {
      if (files.length && [...files, file].join(' ').length > maxCharacters) {
        result.push({ runner, files });
        files = [];
      }
      files.push(file);
    }
    if (files.length) result.push({ runner, files });
  }
  return result;
}

async function collectTests(root, directory, files) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectTests(root, relative, files);
    else if (entry.isFile() && testFile.test(relative))
      files[relative] = await readFile(path.join(root, relative), 'utf8');
  }
}

export async function inspectWorkspace(root) {
  const files = {};
  for (const directory of ['src', 'scripts', 'tests']) await collectTests(root, directory, files);
  const read = (file) => readFile(path.join(root, file), 'utf8');
  return buildTestInventory({
    files,
    scripts: JSON.parse(await read('package.json')).scripts,
    desktopRunner: await read('scripts/e2e/run-e2e.ts'),
    browserRunner: await read('tests/browser/wdio.conf.ts'),
    liveRunner: await read('scripts/e2e/run-real-conversation-acceptance.ts'),
  });
}

async function execute(root, { runner, files }, stdio) {
  // A nested Node test process must start a real runner, not inherit its parent's IPC role.
  // Keep NODE_V8_COVERAGE intact so the existing c8 aggregator receives child coverage.
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
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
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio, env: environment });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (status !== 0) throw new Error(`Discovered ${runner} tests failed (exit ${status}).`);
}

export async function runDiscoveredTests(root, entries, { stdio = 'inherit' } = {}) {
  for (const batch of executionBatches(entries)) await execute(root, batch, stdio);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const result = await inspectWorkspace(root);
    console.log(
      `Test ownership: ${result.assigned.length} existing, ${result.supplemental.length} discovered, ${result.excluded.length} dedicated E2E/opt-in specs.`,
    );
    if (process.argv.includes('--list')) console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes('--run')) {
      await runDiscoveredTests(root, result.supplemental);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
