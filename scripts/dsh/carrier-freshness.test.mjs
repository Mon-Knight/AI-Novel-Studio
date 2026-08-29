import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyReusableCarrier } from './carrier-freshness.mjs';

const PINNED_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';

function makeFixture({ gatewayBytes = 'current-gateway', sourceCommit = PINNED_COMMIT } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ans-carrier-freshness-test-'));
  const carrierRoot = path.join(root, 'fixture', 'dsh-runtime');
  const carrierGateway = path.join(carrierRoot, 'gateway', 'novel-domain-gateway.exe');
  const currentGateway = path.join(root, 'current-gateway.exe');
  const zip = path.join(root, 'carrier.zip');
  const temporaryParent = path.join(root, 'verify');
  mkdirSync(path.dirname(carrierGateway), { recursive: true });
  mkdirSync(temporaryParent, { recursive: true });
  writeFileSync(carrierGateway, gatewayBytes);
  writeFileSync(currentGateway, gatewayBytes);
  writeFileSync(path.join(carrierRoot, 'VERSION_MATRIX.json'), JSON.stringify({ sourceCommit }));
  const archive = spawnSync(
    'tar',
    ['-c', '-f', zip, '-C', path.join(root, 'fixture'), 'dsh-runtime'],
    { encoding: 'utf8' },
  );
  assert.equal(archive.error, undefined);
  assert.equal(archive.status, 0, archive.stderr);
  return { root, currentGateway, zip, temporaryParent };
}

function verify(fixture) {
  return verifyReusableCarrier({
    zip: fixture.zip,
    currentGateway: fixture.currentGateway,
    pinnedCommit: PINNED_COMMIT,
    temporaryParent: fixture.temporaryParent,
  });
}

test('accepts a carrier whose Gateway exactly matches the current release build', (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  assert.match(verify(fixture), /^[0-9a-f]{64}$/u);
  assert.deepEqual(readdirSync(fixture.temporaryParent), []);
});

test('fails closed when the carrier Gateway is stale', (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(fixture.currentGateway, 'new-gateway-build');

  assert.throws(() => verify(fixture), /Gateway SHA-256 does not match/u);
  assert.deepEqual(readdirSync(fixture.temporaryParent), []);
});

test('fails closed when the carrier does not use the pinned DSH commit', (context) => {
  const fixture = makeFixture({ sourceCommit: 'wrong-commit' });
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  assert.throws(() => verify(fixture), /sourceCommit does not match/u);
});

test('fails closed when the carrier omits the Gateway entry', (context) => {
  const fixture = makeFixture();
  context.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  unlinkSync(fixture.zip);
  const carrierRoot = path.join(fixture.root, 'fixture', 'dsh-runtime');
  rmSync(path.join(carrierRoot, 'gateway'), { recursive: true, force: true });
  const archive = spawnSync(
    'tar',
    ['-c', '-f', fixture.zip, '-C', path.join(fixture.root, 'fixture'), 'dsh-runtime'],
    { encoding: 'utf8' },
  );
  assert.equal(archive.status, 0, archive.stderr);

  assert.throws(
    () => verify(fixture),
    /required Gateway freshness entries could not be extracted/u,
  );
});
