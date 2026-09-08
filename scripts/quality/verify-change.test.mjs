import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedFiles,
  createVerificationPlan,
  verificationCommands,
  executeVerification,
  parseVerificationArgs,
} from './verify-change.mjs';

const root = process.cwd();
const nodeTest = "import test from 'node:test'; test('behavior', () => {});";
const tests = [
  'src/pages/Workbench/example.test.tsx',
  'src/services/conversation/taskConversationService.test.ts',
  'src/features/workspace/documentSafety.test.mjs',
  'src/utils/uniqueId.test.ts',
  'scripts/quality/test-ownership.test.mjs',
];
const commands = (plan, lane = 'all') =>
  verificationCommands(plan, { root, lane, source: () => nodeTest });

test('documentation never selects frontend tests, Rust, desktop or packaging', () => {
  const plan = createVerificationPlan(
    [
      'docs/development-rules.md',
      '.github/workflows-docs/workflow-script-usage.md',
      '.github/instructions/testing.instructions.md',
      '.cursor/rules/testing-rules.mdc',
    ],
    tests,
  );
  assert.equal(plan.docs, true);
  assert.equal(plan.version, false);
  assert.ok(!plan.format.some((file) => file.endsWith('.mdc')));
  assert.ok(
    commands(plan).every(({ id }) =>
      ['diff', 'format', 'capability-docs', 'docs-sync'].includes(id),
    ),
  );
});
test('a small workbench change runs its adjacent test and production journeys once', () => {
  const plan = createVerificationPlan(
    ['src/pages/Workbench/example.tsx', 'src/pages/Workbench/example.tsx'],
    tests,
  );
  assert.deepEqual(plan.tests, ['src/pages/Workbench/example.test.tsx']);
  assert.deepEqual(plan.e2e, ['conversational-workbench', 'workbench-writing-smoke']);
  const steps = commands(plan);
  assert.equal(steps.filter(({ id }) => id === 'desktop').length, 1);
  assert.equal(steps.filter(({ id }) => id === 'types').length, 1);
  assert.ok(!steps.some(({ id }) => ['coverage', 'production-build', 'rust-full'].includes(id)));
});
test('SQLite changes expand their safety domain without a frontend coverage run', () => {
  const plan = createVerificationPlan(['src-tauri/src/migrations.rs'], tests);
  assert.equal(plan.rustFull, true);
  assert.equal(plan.coverage, false);
  const ids = commands(plan).map(({ id }) => id);
  assert.ok(ids.indexOf('gateway-build') < ids.indexOf('rust-full'));
  assert.ok(ids.includes('rust-discovery'));
  assert.ok(!ids.includes('production-build'));
});
test('full gates subsume unit/filter/spec selections and lanes partition commands', () => {
  const plan = createVerificationPlan(
    ['.github/workflows/ci.yml', 'src/pages/Workbench/example.tsx'],
    tests,
  );
  assert.deepEqual(plan.tests, []);
  assert.deepEqual(plan.rustFilters, []);
  assert.deepEqual(plan.e2e, []);
  const all = commands(plan)
    .map(({ id }) => id)
    .sort();
  const lanes = ['frontend', 'native', 'desktop']
    .flatMap((lane) => commands(plan, lane).map(({ id }) => id))
    .sort();
  assert.deepEqual(lanes, all);
  assert.equal(new Set(all).size, all.length);
});

test('script-only package changes do not select native tests or packaging', () => {
  const plan = createVerificationPlan(['package.json'], tests, {
    manifests: {
      before: { version: '3.6.2', scripts: { test: 'node --test' } },
      after: {
        version: '3.6.2',
        scripts: { test: 'node --test', 'verify:change': 'node selector.mjs' },
      },
    },
  });
  assert.equal(plan.coverage, true);
  assert.equal(plan.rustFull, false);
  assert.equal(plan.production, false);
  assert.equal(plan.desktopFull, false);
});

test('ordinary native services select only their validated module filters', () => {
  const plan = createVerificationPlan(
    ['src-tauri/src/services/memory_service.rs', 'src-tauri/src/repositories/memory_repository.rs'],
    tests,
  );
  assert.equal(plan.rustFull, false);
  assert.deepEqual(plan.rustFilters, ['services::memory_service::']);
  assert.equal(commands(plan).filter(({ id }) => id === 'rust-selected').length, 1);
  assert.ok(commands(plan).some(({ id }) => id === 'rust-check'));
});

test('a successful process with no executed cases cannot satisfy a behavior check', async () => {
  const result = await executeVerification(
    [{ id: 'behavior', executable: 'fixture', args: [], requiresCases: true }],
    root,
    async () => ({ exitCode: 0, cases: 0 }),
  );
  assert.equal(result[0].status, 'FAIL');
  assert.match(result[0].error, /Zero executed/u);
});
test('unknown domain, missing ownership and invalid options fail instead of widening or passing empty', () => {
  assert.throws(() => createVerificationPlan(['src/services/unknown/new.ts'], tests), /Unmapped/u);
  assert.throws(
    () => createVerificationPlan(['scripts/quality/new.mjs'], []),
    /No behavior tests/u,
  );
  assert.throws(() => parseVerificationArgs(['--base']), /requires/u);
  assert.throws(() => parseVerificationArgs(['--skip']), /Unknown/u);
  assert.throws(() => createVerificationPlan(['../outside.ts'], []));
});
test('new unit tests are selected directly and deleted paths are not linted/formatted', () => {
  const plan = createVerificationPlan(
    ['src/services/new/new.test.ts', 'src/pages/Workbench/removed.tsx'],
    [...tests, 'src/services/new/new.test.ts'],
    { existing: (file) => !file.includes('removed') },
  );
  assert.ok(plan.tests.includes('src/services/new/new.test.ts'));
  assert.ok(!plan.format.some((file) => file.includes('removed')));
  assert.ok(!plan.lint.some((file) => file.includes('removed')));
});
test('Git selection includes staged/unstaged/untracked and both sides of renames without reading source', () => {
  const calls = [];
  const files = changedFiles(root, 'main', (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
    if (args[0] === 'ls-files') return 'new file.ts\0';
    return args.includes('HEAD') ? 'staged.ts\0unstaged.ts\0' : 'old.ts\0renamed.ts\0';
  });
  assert.deepEqual(files, ['new file.ts', 'old.ts', 'renamed.ts', 'staged.ts', 'unstaged.ts']);
  assert.ok(
    calls.filter((args) => args[0] === 'diff').every((args) => args.includes('--no-renames')),
  );
});
test('failed checks remain failures, and stale gateway prerequisites block dependent execution', async () => {
  const calls = [];
  const steps = ['behavior-1', 'gateway-build', 'rust-full'].map((id) => ({
    id,
    executable: 'fixture',
    args: [],
  }));
  const results = await executeVerification(steps, root, async ({ id }) => {
    calls.push(id);
    return { exitCode: 9, durationMs: 1, cases: 1 };
  });
  assert.deepEqual(calls, ['behavior-1', 'gateway-build']);
  assert.deepEqual(
    results.map(({ status }) => status),
    ['FAIL', 'FAIL', 'NOT_RUN'],
  );
});
