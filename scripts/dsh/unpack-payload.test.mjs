import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const UNPACKER = fileURLToPath(new URL('./unpack-payload.mjs', import.meta.url));
const PINNED_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';
const RUNTIME_RELATIVE = 'packages/examples/jsonrpc-demo/lib/bin.js';
const GATEWAY_RELATIVE = 'gateway/novel-domain-gateway.exe';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function resolveTar() {
  if (process.platform === 'win32') {
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(systemTar)) return systemTar;
  }
  return 'tar';
}

function fixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), 'ans-unpack-payload-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, destination: path.join(root, 'app-data') };
}

function archive(
  fixture,
  name,
  { gateway = name, runtime = 'pinned-runtime', matrix, junctions = [] } = {},
) {
  const source = path.join(fixture.root, name, 'dsh-runtime');
  for (const relative of [
    RUNTIME_RELATIVE,
    GATEWAY_RELATIVE,
    'packages/sdk/server/lib/index.js',
    'packages/sdk/protocol/lib/index.js',
    'packages/core/agent/lib/index.js',
    'packages/llm/llm/lib/index.js',
    'packages/core/session/lib/index.js',
    'node_modules/.pnpm/placeholder',
    'packages/examples/jsonrpc-demo/node_modules/@deepseek-ai/dsh-app-boot/index.js',
  ]) {
    const target = path.join(source, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      relative === RUNTIME_RELATIVE ? runtime : relative === GATEWAY_RELATIVE ? gateway : 'fixture',
    );
  }
  const expected = {
    sourceCommit: PINNED_COMMIT,
    runtimeBinSha256: sha256(runtime),
    gatewaySha256: sha256(gateway),
    ...matrix,
  };
  writeFileSync(path.join(source, 'VERSION_MATRIX.json'), JSON.stringify(expected));
  writeFileSync(path.join(source, 'JUNCTIONS.json'), JSON.stringify(junctions));
  const zip = path.join(fixture.root, `${name}.zip`);
  const result = spawnSync(
    resolveTar(),
    ['-a', '-cf', path.basename(zip), '-C', name, 'dsh-runtime'],
    {
      encoding: 'utf8',
      cwd: fixture.root,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return zip;
}

function unpack(fixture, zip, script = UNPACKER) {
  const result = spawnSync(process.execPath, [script, zip, fixture.destination], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

function installedGateway(fixture) {
  return readFileSync(path.join(fixture.destination, 'dsh-runtime', GATEWAY_RELATIVE), 'utf8');
}

function installOld(context) {
  const result = fixture(context);
  const old = archive(result, 'old', { gateway: 'old-gateway' });
  const installation = unpack(result, old);
  assert.equal(installation.status, 0, installation.stderr);
  assert.equal(installedGateway(result), 'old-gateway');
  return result;
}

test('a standalone packaged unpacker starts without neighbouring checkout modules', (context) => {
  const result = fixture(context);
  const packaged = path.join(result.root, 'packaged', 'unpack-payload.mjs');
  mkdirSync(path.dirname(packaged));
  copyFileSync(UNPACKER, packaged);
  const usage = spawnSync(process.execPath, [packaged], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node unpack-payload/u);
  assert.doesNotMatch(usage.stderr, /ERR_MODULE_NOT_FOUND/u);
  assert.deepEqual(readdirSync(path.dirname(packaged)), ['unpack-payload.mjs']);
});

test('a newer carrier replaces an internally consistent older installed Gateway', (context) => {
  const result = installOld(context);
  const current = archive(result, 'current', { gateway: 'current-gateway' });
  const replacement = unpack(result, current);
  assert.equal(replacement.status, 0, replacement.stderr);
  assert.match(replacement.stdout, /runtime carrier installed/u);
  assert.equal(installedGateway(result), 'current-gateway');
  assert.deepEqual(readdirSync(result.destination), ['dsh-runtime']);

  const repeated = unpack(result, current);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /runtime carrier already verified/u);
});

test('a changed runtime hash also invalidates the installed carrier fast path', (context) => {
  const result = installOld(context);
  const current = archive(result, 'runtime-updated', {
    gateway: 'old-gateway',
    runtime: 'new-runtime',
  });
  const replacement = unpack(result, current);
  assert.equal(replacement.status, 0, replacement.stderr);
  assert.equal(
    readFileSync(path.join(result.destination, 'dsh-runtime', RUNTIME_RELATIVE), 'utf8'),
    'new-runtime',
  );
});

test('valid junctions are rebuilt for the final installed location', (context) => {
  const result = fixture(context);
  const current = archive(result, 'junction-carrier', {
    junctions: [{ link: 'protocol-alias', target: 'packages/sdk/protocol' }],
  });
  const installation = unpack(result, current);
  assert.equal(installation.status, 0, installation.stderr);
  const installed = path.join(result.destination, 'dsh-runtime');
  assert.equal(
    realpathSync(path.join(installed, 'protocol-alias')),
    realpathSync(path.join(installed, 'packages/sdk/protocol')),
  );
});

test('a carrier missing its Gateway hash fails closed and preserves the old runtime', (context) => {
  const result = installOld(context);
  const invalid = archive(result, 'missing-hash', { matrix: { gatewaySha256: null } });
  const rejected = unpack(result, invalid);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /runtime carrier identity is missing or invalid/u);
  assert.equal(installedGateway(result), 'old-gateway');
});

test('a corrupt archive fails closed without deleting the previous valid runtime', (context) => {
  const result = installOld(context);
  const invalid = path.join(result.root, 'corrupt.zip');
  writeFileSync(invalid, 'not an archive');
  const rejected = unpack(result, invalid);
  assert.notEqual(rejected.status, 0);
  assert.equal(installedGateway(result), 'old-gateway');
});

test('an archive binary not matching its valid matrix is rejected before replacement', (context) => {
  const result = installOld(context);
  const invalid = archive(result, 'wrong-binary', {
    matrix: { gatewaySha256: sha256('other-build') },
  });
  const rejected = unpack(result, invalid);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /extracted runtime carrier verification failed/u);
  assert.equal(installedGateway(result), 'old-gateway');
  assert.deepEqual(readdirSync(result.destination), ['dsh-runtime']);
});

test('escaping junctions are rejected before any old runtime is replaced', (context) => {
  const result = installOld(context);
  const invalid = archive(result, 'escaping-junction', {
    junctions: [{ link: '../escaped', target: 'packages' }],
  });
  const rejected = unpack(result, invalid);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /junction path escapes runtime root/u);
  assert.equal(installedGateway(result), 'old-gateway');
  assert.equal(existsSync(path.join(result.destination, 'escaped')), false);
});

function injectRenameFailure(result, permanent) {
  const script = path.join(result.root, 'unpacker-with-rename-lock.mjs');
  const original = readFileSync(UNPACKER, 'utf8');
  const injected = original
    .replace('  renameSync,', '  renameSync as nativeRenameSync,')
    .replace('const deadline = Date.now() + 5000;', 'const deadline = Date.now() + 300;');
  assert.notEqual(injected, original);
  writeFileSync(
    script,
    injected +
      `
function renameSync(source, target) {
  if (source.includes('.dsh-runtime-unpack-') && (${permanent} || !renameSync.failedOnce)) {
    renameSync.failedOnce = true;
    throw Object.assign(new Error('injected directory lock'), { code: 'EPERM' });
  }
  return nativeRenameSync(source, target);
}
`,
  );
  return script;
}

test('a transient directory rename lock is retried before verified installation', (context) => {
  const result = installOld(context);
  const current = archive(result, 'rename-current', { gateway: 'current-gateway' });
  const installed = unpack(result, current, injectRenameFailure(result, false));
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installedGateway(result), 'current-gateway');
  assert.deepEqual(readdirSync(result.destination), ['dsh-runtime']);
});

test('a persistent directory rename lock fails closed and restores the old carrier', (context) => {
  const result = installOld(context);
  const current = archive(result, 'locked-current', { gateway: 'current-gateway' });
  const rejected = unpack(result, current, injectRenameFailure(result, true));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /injected directory lock/u);
  assert.equal(installedGateway(result), 'old-gateway');
  assert.deepEqual(readdirSync(result.destination), ['dsh-runtime']);
});
