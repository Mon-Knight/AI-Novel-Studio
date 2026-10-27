import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildTestInventory, executionBatches, runDiscoveredTests } from './test-ownership.mjs';

const nodeTest = "import test from 'node:test'; test('fixture', () => {});";
const vitest = "import { test } from 'vitest'; test('fixture', () => {});";
const scripts = {
  'test:all': 'npm test && npm run test:discovered',
  test: 'node --test src/existing.test.mjs',
  'test:discovered': 'node scripts/quality/test-ownership.mjs --run',
};
const inventory = (files, overrides = {}) =>
  buildTestInventory({
    files: { 'src/existing.test.mjs': nodeTest, ...files },
    scripts,
    ...overrides,
  });

test('a newly discovered failing test really executes and propagates a nonzero child exit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ans-discovered-test-'));
  try {
    await writeFile(
      path.join(root, 'new.test.mjs'),
      "import test from 'node:test'; test('negative fixture', () => { throw new Error('expected failure'); });",
    );
    await assert.rejects(
      runDiscoveredTests(root, [{ file: 'new.test.mjs', runner: 'node' }], { stdio: 'ignore' }),
      /failed \(exit 1\)/u,
    );
    await writeFile(
      path.join(root, 'new.test.mjs'),
      "import test from 'node:test'; test('fixed fixture', () => {});",
    );
    await assert.doesNotReject(
      runDiscoveredTests(root, [{ file: 'new.test.mjs', runner: 'node' }], { stdio: 'ignore' }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the retired experimental desktop file is explicitly NOT_RUN, not default acceptance', () => {
  const result = inventory({ 'tests/e2e/creative-agent-workflow.spec.ts': '' });
  assert.equal(result.excluded[0].runner, 'legacy-experimental (NOT_RUN)');
  assert.match(result.excluded[0].reason, /NOT desktop acceptance/u);
});

test('new tests are actually assigned executable Node/tsx/Vitest supplemental batches', () => {
  const result = inventory({ 'src/new.test.ts': nodeTest, 'src/new.test.tsx': vitest });
  assert.deepEqual(
    result.supplemental.map(({ file, runner }) => [file, runner]),
    [
      ['src/new.test.ts', 'tsx'],
      ['src/new.test.tsx', 'vitest'],
    ],
  );
  const batches = executionBatches(result.supplemental);
  assert.deepEqual(
    batches.map(({ runner, files }) => [runner, files]),
    [
      ['tsx', ['src/new.test.ts']],
      ['vitest', ['src/new.test.tsx']],
    ],
  );
});

test('missing supplemental entry fails instead of silently omitting new tests', () => {
  assert.throws(
    () =>
      inventory(
        { 'src/new.test.ts': nodeTest },
        {
          scripts: { ...scripts, 'test:all': 'npm test' },
        },
      ),
    /not reachable.*test:discovered/u,
  );
});

test('the same test assigned by two default commands fails closed instead of running twice', () => {
  assert.throws(
    () =>
      inventory(
        { 'src/shared.test.mjs': nodeTest },
        {
          scripts: {
            ...scripts,
            test: 'node --test src/existing.test.mjs src/shared.test.mjs && node --test src/shared.test.mjs',
          },
        },
      ),
    /duplicate assignment.*src\/shared\.test\.mjs/u,
  );
  assert.throws(
    () =>
      inventory(
        { 'src/shared.test.mjs': nodeTest },
        {
          scripts: {
            ...scripts,
            test: 'node --test src/existing.test.mjs src/shared.test.mjs src/shared.test.mjs',
          },
        },
      ),
    /listed twice in one command/u,
  );
});

test('rejects stale paths, unknown runners and Node tests sent to Vitest folder filters', () => {
  assert.throws(
    () => inventory({}, { scripts: { ...scripts, test: 'node --test src/deleted.test.mjs' } }),
    /missing test/u,
  );
  assert.throws(
    () => inventory({ 'src/new.test.ts': "const text = 'node:test';" }),
    /unknown test runner/u,
  );
  assert.throws(
    () =>
      inventory(
        { 'src/new.test.ts': nodeTest },
        {
          scripts: { ...scripts, test: 'vitest run src' },
        },
      ),
    /runner mismatch/u,
  );
});

test('performance discovery preserves expose-gc and never invokes live or desktop specs', () => {
  const result = inventory(
    {
      'scripts/performance/new.test.ts': nodeTest,
      'tests/e2e/example.spec.ts': 'describe("desktop", () => {});',
      'tests/real-acceptance/conversation-60000.spec.ts': 'describe("live", () => {});',
      'tests/real-acceptance/writing-subagent-real-profile.spec.ts':
        'describe("real profile", () => {});',
      'tests/real-acceptance/writing-subagent-fault-injection.spec.ts':
        'describe("fault injection", () => {});',
    },
    {
      desktopRunner: "const allSpecs = ['example.spec.ts'];",
      liveRunner: "'conversation-60000.spec.ts'",
      realProfileRunner:
        "specs: ['writing-subagent-real-profile.spec.ts']\nspecs: ['writing-subagent-fault-injection.spec.ts']",
    },
  );
  assert.equal(result.supplemental[0].runner, 'performance');
  assert.equal(result.excluded.length, 4);
  assert.ok(result.excluded.some(({ runner }) => runner === 'test:real-profile:writing-subagent'));
  assert.ok(
    result.excluded.some(({ runner }) => runner === 'test:fault-injection:writing-subagent'),
  );
  assert.ok(result.excluded.every(({ reason }) => reason.length > 20));
  assert.equal(executionBatches(result.supplemental)[0].runner, 'performance');
});

test('unregistered desktop spec and unrecognized spec scope fail closed', () => {
  assert.throws(() => inventory({ 'tests/e2e/new.spec.ts': '' }), /not registered/u);
  assert.throws(() => inventory({ 'src/new.spec.ts': '' }), /unowned spec/u);
  assert.throws(
    () => inventory({ 'tests/real-acceptance/writing-subagent-real-profile.spec.ts': '' }),
    /unowned spec/u,
  );
});

test('bounded batches cover every selected file once without exceeding Windows command budget', () => {
  const entries = Array.from({ length: 250 }, (_, index) => ({
    file: `src/${'long-directory/'.repeat(8)}${index}.test.ts`,
    runner: 'tsx',
  }));
  const batches = executionBatches(entries, 1500);
  assert.deepEqual(
    batches.flatMap(({ files }) => files),
    entries.map(({ file }) => file),
  );
  assert.ok(batches.every(({ files }) => files.join(' ').length < 1500));
});
