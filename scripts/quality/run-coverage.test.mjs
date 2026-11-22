import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildCoveragePlan, runCoverageGate } from './run-coverage.mjs';

const root = process.cwd();

test('coverage plan collects critical-component coverage in the first pass without rerunning Vitest', () => {
  const plan = buildCoveragePlan(root, {
    PATH: process.env.PATH,
    ANS_SKIP_CRITICAL_COMPONENT_COVERAGE: '1',
  });
  assert.deepEqual(plan.cleanDirs, [
    path.join(root, 'coverage/tmp'),
    path.join(root, 'coverage/critical-components'),
  ]);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['c8-test-all', 'c8-core-report', 'critical-components-gate'],
  );
  const first = plan.steps[0];
  assert.equal(first.env.ANS_COLLECT_CRITICAL_COVERAGE, '1');
  assert.equal(first.env.ANS_SKIP_CRITICAL_COMPONENT_COVERAGE, undefined);
  assert.ok(first.args.includes('test:all'));
  assert.ok(first.args.includes('--lines'));
  assert.ok(first.args.includes('34'));
  assert.ok(first.args.includes('64'));
  assert.ok(plan.steps[1].args.includes('test:coverage:core'));
  assert.ok(
    plan.steps[2].args.some((arg) =>
      arg.replaceAll('\\', '/').endsWith('scripts/check-critical-component-coverage.mjs'),
    ),
  );
});

test('runCoverageGate cleans stale coverage directories and propagates step failures closed', () => {
  const removed = [];
  const executed = [];
  const plan = runCoverageGate(
    { root, env: { PATH: process.env.PATH } },
    {
      rmSync: (directory, options) => removed.push({ directory, options }),
      run: (executable, args) => {
        executed.push({ executable, args });
        return { status: 0 };
      },
    },
  );
  assert.equal(removed.length, 2);
  assert.deepEqual(
    removed.map((entry) => entry.directory),
    plan.cleanDirs,
  );
  assert.equal(executed.length, 3);

  const stopped = [];
  assert.throws(
    () =>
      runCoverageGate(
        { root, env: { PATH: process.env.PATH } },
        {
          rmSync: () => {},
          run: (_executable, args) => {
            stopped.push(args);
            return { status: args.includes('test:coverage:core') ? 2 : 0 };
          },
        },
      ),
    /c8-core-report failed \(2\)/u,
  );
  assert.equal(stopped.length, 2);
});
