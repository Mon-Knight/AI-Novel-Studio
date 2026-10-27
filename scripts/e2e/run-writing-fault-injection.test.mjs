import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  writingFaultEnvironment,
  writingFaultPlan,
  executeWritingFaultPlan,
  parseWritingFaultArgs,
  verifyWritingFaultCarrier,
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
    ['assets', 'production-carrier-build', 'isolated-writing-faults'],
  );
  assert.ok(plan.steps[1].args.includes('none'));
  assert.ok(!plan.steps[1].args.includes('--features'));
  assert.equal(plan.steps[1].env.CARGO_TARGET_DIR, path.join(root, '.e2e-tools', 'target'));
  const carrier = plan.steps[2];
  assert.ok(carrier.args.includes('tests/real-acceptance/wdio.fault-injection.conf.ts'));
  assert.equal(carrier.env.AI_NOVEL_STUDIO_FAULT_INJECTION, '1');
  assert.equal(carrier.env.AI_NOVEL_STUDIO_FAULT_INJECTION_APP, plan.appPath);
  assert.equal(carrier.env.AI_NOVEL_STUDIO_E2E_DRIVER, 'known-driver');
  assert.equal(carrier.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER, 'known-edge');
  assert.equal(
    carrier.env.DSH_GATEWAY_BIN,
    path.join(root, 'src-tauri', 'target', 'release', 'novel-domain-gateway.exe'),
  );
  assert.equal(
    carrier.env.AI_NOVEL_STUDIO_FAULT_INJECTION_DSH_RUNTIME_ROOT,
    path.join(root, 'src-tauri', '.payload-verify', 'dsh-runtime'),
  );
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

test('failed production prerequisites cannot run the fault spec against an old binary', async () => {
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
  assert.deepEqual(calls, ['assets', 'production-carrier-build']);
});

test('a missing carrier and a failing spec both fail the standard fault gate', async () => {
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
      () => 'fixture-verified',
    ),
    /isolated-writing-faults.*1/u,
  );
  await assert.rejects(
    executeWritingFaultPlan(
      plan,
      async () => {
        calls++;
        return 0;
      },
      () => true,
      () => {
        throw new Error('unverified carrier');
      },
    ),
    /unverified carrier/u,
  );
  assert.equal(calls, 0);
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

function carrierFixture(context) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'ans-writing-fault-carrier-'));
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const gateway = path.join(
    fixtureRoot,
    'src-tauri',
    'target',
    'release',
    'novel-domain-gateway.exe',
  );
  mkdirSync(path.dirname(gateway), { recursive: true });
  writeFileSync(gateway, 'current-gateway');
  const gatewaySha256 = createHash('sha256').update('current-gateway').digest('hex');
  const sourceCommit = '47f943859bef60e4160492346772ded9b24f765a';
  const writeCarrier = (directory, bytes, matrix) => {
    const payload = path.join(fixtureRoot, 'src-tauri', directory, 'dsh-runtime');
    mkdirSync(path.join(payload, 'gateway'), { recursive: true });
    writeFileSync(path.join(payload, 'gateway', 'novel-domain-gateway.exe'), bytes);
    writeFileSync(path.join(payload, 'VERSION_MATRIX.json'), JSON.stringify(matrix));
  };
  // ZIP fallback does not update the assembly tree. It must not become a
  // substitute for the carrier that actually passed standalone relocation.
  writeCarrier('.payload-staging', 'old-gateway', { sourceCommit });
  return { root: fixtureRoot, gateway, gatewaySha256, sourceCommit, writeCarrier };
}

test('fault preflight uses the independently verified carrier, not old assembly staging', (context) => {
  const fixture = carrierFixture(context);
  fixture.writeCarrier('.payload-verify', 'current-gateway', {
    sourceCommit: fixture.sourceCommit,
    gatewaySha256: fixture.gatewaySha256,
  });
  assert.equal(verifyWritingFaultCarrier(fixture.root), fixture.gatewaySha256);
});

test('skip-build cannot spawn with only assembly staging or a stale verified carrier', async (context) => {
  const fixture = carrierFixture(context);
  const plan = writingFaultPlan({
    root: fixture.root,
    platform: 'win32',
    env: {},
    skipBuild: true,
    app: 'fresh-production.exe',
  });
  let spawns = 0;
  const run = async () => {
    spawns++;
    return 0;
  };
  await assert.rejects(
    executeWritingFaultPlan(plan, run, () => true),
    /carrier Gateway binary is missing or empty/u,
  );
  assert.equal(spawns, 0);

  fixture.writeCarrier('.payload-verify', 'current-gateway', {
    sourceCommit: fixture.sourceCommit,
    gatewaySha256: fixture.gatewaySha256,
  });
  writeFileSync(fixture.gateway, 'new-build-after-assets');
  await assert.rejects(
    executeWritingFaultPlan(plan, run, () => true),
    /Gateway SHA-256 does not match the current release build/u,
  );
  assert.equal(spawns, 0);
});

test('fault preflight retains matrix hash and pinned-source checks', (context) => {
  const fixture = carrierFixture(context);
  fixture.writeCarrier('.payload-verify', 'current-gateway', {
    sourceCommit: fixture.sourceCommit,
    gatewaySha256: '0'.repeat(64),
  });
  assert.throws(
    () => verifyWritingFaultCarrier(fixture.root),
    /Gateway SHA-256 does not match the current release build/u,
  );
  fixture.writeCarrier('.payload-verify', 'current-gateway', {
    sourceCommit: 'wrong-source',
    gatewaySha256: fixture.gatewaySha256,
  });
  assert.throws(
    () => verifyWritingFaultCarrier(fixture.root),
    /sourceCommit does not match the pinned DSH source/u,
  );
});
