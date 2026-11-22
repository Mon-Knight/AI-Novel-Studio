import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  writingFaultEnvironment,
  writingFaultPlan,
  executeWritingFaultPlan,
  findAvailableFaultDriverPort,
  parseWritingFaultArgs,
} from './run-writing-fault-injection.mjs';

const root = process.cwd();
test('the standard fault gate can only select isolated loopback, never a live profile', () => {
  const plan = writingFaultPlan({
    root,
    platform: 'win32',
    env: {
      PATH: 'tool-path',
      DSH_E2E_API_KEY: 'synthetic-secret',
      DSH_E2E_BASE_URL: 'https://cloud.invalid',
      OPENAI_API_KEY: 'synthetic-key',
      AI_NOVEL_STUDIO_REAL_PROFILE: '1',
      AI_NOVEL_STUDIO_FAULT_INJECTION_APP: 'untrusted-old.exe',
      AI_NOVEL_STUDIO_E2E: '1',
      VITE_AI_NOVEL_STUDIO_E2E: '1',
      NODE_TEST_CONTEXT: 'child-v8',
      AI_NOVEL_STUDIO_E2E_DRIVER: 'known-driver',
      AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER: 'known-edge',
    },
  });
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['production-carrier-build', 'isolated-writing-faults'],
  );
  assert.ok(plan.steps[0].args.includes('--no-bundle'));
  assert.ok(!plan.steps[0].args.includes('--features'));
  assert.equal(
    plan.steps[0].env.CARGO_TARGET_DIR,
    path.join(root, '.e2e-tools', 'target-production'),
  );
  assert.notEqual(plan.steps[0].env.CARGO_TARGET_DIR, path.join(root, '.e2e-tools', 'target'));
  const carrier = plan.steps[1];
  assert.ok(carrier.args.includes('tests/real-acceptance/wdio.fault-injection.conf.ts'));
  assert.equal(carrier.env.AI_NOVEL_STUDIO_FAULT_INJECTION, '1');
  assert.equal(carrier.env.AI_NOVEL_STUDIO_FAULT_INJECTION_APP, plan.appPath);
  assert.equal(carrier.env.AI_NOVEL_STUDIO_E2E_DRIVER, 'known-driver');
  assert.equal(carrier.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER, 'known-edge');
  for (const step of plan.steps) {
    for (const key of [
      'DSH_E2E_API_KEY',
      'DSH_E2E_BASE_URL',
      'OPENAI_API_KEY',
      'AI_NOVEL_STUDIO_REAL_PROFILE',
      'AI_NOVEL_STUDIO_E2E',
      'VITE_AI_NOVEL_STUDIO_E2E',
      'NODE_TEST_CONTEXT',
    ]) {
      assert.equal(step.env[key], undefined, key);
    }
  }
});

test('fault gate rejects unsupported platforms and implicit reuse of a stale executable', () => {
  assert.throws(() => writingFaultPlan({ root, platform: 'linux' }), /Windows/u);
  assert.throws(
    () => writingFaultPlan({ root, platform: 'win32', skipBuild: true }),
    /explicitly freshly built/u,
  );
  assert.throws(
    () => writingFaultPlan({ root, platform: 'win32', app: 'old.exe' }),
    /explicit --skip-build/u,
  );
  const plan = writingFaultPlan({
    root,
    platform: 'win32',
    skipBuild: true,
    app: 'fresh-production.exe',
  });
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['isolated-writing-faults'],
  );
  assert.equal(plan.appPath, path.resolve(root, 'fresh-production.exe'));
});

test('failed production build cannot run the fault spec against an old binary', async () => {
  const plan = writingFaultPlan({ root, platform: 'win32' });
  const calls = [];
  await assert.rejects(
    executeWritingFaultPlan(
      plan,
      async (step) => {
        calls.push(step.id);
        return step.id === 'production-carrier-build' ? 9 : 0;
      },
      () => true,
    ),
    /production-carrier-build.*9/u,
  );
  assert.deepEqual(calls, ['production-carrier-build']);
});

test('a missing executable and a failing spec both fail the standard fault gate', async () => {
  const plan = writingFaultPlan({ root, platform: 'win32', skipBuild: true, app: 'fresh.exe' });
  let calls = 0;
  await assert.rejects(
    executeWritingFaultPlan(
      plan,
      async () => {
        calls++;
        return 0;
      },
      () => false,
    ),
    /missing/u,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    executeWritingFaultPlan(
      plan,
      async () => 1,
      () => true,
    ),
    /isolated-writing-faults.*1/u,
  );
});

test('fault runner options are explicit and credential stripping does not mutate the caller', () => {
  assert.deepEqual(parseWritingFaultArgs(['--app', 'fresh.exe', '--skip-build']), {
    app: 'fresh.exe',
    skipBuild: true,
  });
  assert.throws(() => parseWritingFaultArgs(['--app']), /requires/u);
  assert.throws(() => parseWritingFaultArgs(['--live']), /Unknown/u);
  const input = { PATH: 'tools', TOKEN: 'synthetic' };
  assert.deepEqual(writingFaultEnvironment(input), { PATH: 'tools' });
  assert.equal(input.TOKEN, 'synthetic');
});

test('fault runner reserves a dynamic non-excluded driver port when none is supplied', async () => {
  const autoPlan = writingFaultPlan({
    root,
    platform: 'win32',
    env: {},
    skipBuild: true,
    app: 'fresh.exe',
  });
  const recorded = [];
  await executeWritingFaultPlan(
    autoPlan,
    async (step) => {
      recorded.push(step.env.AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT);
      return 0;
    },
    () => true,
    async () => 28480,
  );
  assert.deepEqual(recorded, ['28480']);
  assert.equal(autoPlan.steps[0].env.AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT, undefined);

  const explicitPlan = writingFaultPlan({
    root,
    platform: 'win32',
    env: { AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT: '29999' },
    skipBuild: true,
    app: 'fresh.exe',
  });
  let selectorCalled = false;
  await executeWritingFaultPlan(
    explicitPlan,
    async (step) => {
      recorded.push(step.env.AI_NOVEL_STUDIO_FAULT_INJECTION_DRIVER_PORT);
      return 0;
    },
    () => true,
    async () => {
      selectorCalled = true;
      return 28481;
    },
  );
  assert.equal(selectorCalled, false);
  assert.deepEqual(recorded, ['28480', '29999']);

  const picked = await findAvailableFaultDriverPort();
  assert.ok(Number.isInteger(picked) && picked >= 20_000 && picked < 40_000);
});
