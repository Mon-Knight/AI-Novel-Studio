// Builds the read-only gateway, creates a relocatable pinned DSH carrier and
// verifies a real unpack before Tauri release packaging starts.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTar, verifyReusableCarrier } from './carrier-freshness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcTauri = path.join(root, 'src-tauri');
const binDir = path.join(srcTauri, 'bin');
const staging = path.join(srcTauri, '.payload-staging');
const payload = path.join(staging, 'dsh-runtime');
const gateway = path.join(srcTauri, 'target', 'release', 'novel-domain-gateway.exe');
const checkout = process.env.DSH_CHECKOUT?.trim();
const pinnedCommit = '47f943859bef60e4160492346772ded9b24f765a';
const verifyDir = path.join(srcTauri, '.payload-verify');

function junctionEntries() {
  const entries = JSON.parse(readFileSync(path.join(payload, 'JUNCTIONS.json'), 'utf8'));
  if (!Array.isArray(entries)) throw new Error('JUNCTIONS.json must contain an array');
  return entries;
}

function junctionPath(relative) {
  return path.join(payload, ...relative.split('/'));
}

// Windows tar follows directory junctions. Remove only the link objects while
// archiving; the payload targets remain real directories and the unpacker
// recreates every link from JUNCTIONS.json at the final writable location.
function stripJunctions(entries) {
  for (const entry of [...entries].sort((left, right) => right.link.length - left.link.length)) {
    const link = junctionPath(entry.link);
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function restoreJunctions(entries) {
  for (const entry of [...entries].sort((left, right) => left.link.length - right.link.length)) {
    const link = junctionPath(entry.link);
    try {
      const current = lstatSync(link);
      if (current.isSymbolicLink()) unlinkSync(link);
      else throw new Error('junction path is occupied by a regular entry: ' + entry.link);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(path.resolve(payload, ...entry.target.split('/')), link, 'junction');
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' failed with exit ' + String(result.status));
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || command + ' failed').trim());
  }
  return result.stdout.trim();
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function isZip(file) {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(4);
    return readSync(fd, header, 0, 4, 0) === 4 && header.equals(Buffer.from([0x50, 0x4b, 3, 4]));
  } finally {
    closeSync(fd);
  }
}

function writeGatewayHash(root) {
  const matrixPath = path.join(root, 'VERSION_MATRIX.json');
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  matrix.gatewaySha256 = sha256(gateway);
  writeFileSync(matrixPath, JSON.stringify(matrix, null, 2) + '\n');
}

function stageBundleResources(gatewaySha256) {
  cpSync(
    path.join(root, 'scripts', 'dsh', 'unpack-payload.mjs'),
    path.join(binDir, 'unpack-payload.mjs'),
    { force: true },
  );
  writeFileSync(path.join(binDir, 'gateway-sha256.txt'), gatewaySha256 + '\n');
  rmSync(verifyDir, { recursive: true, force: true });
  console.log('[dsh-assets] verifying staged unpacker and relocation');
  run('node', [path.join(binDir, 'unpack-payload.mjs'), zip, verifyDir], { cwd: root });
  // Keep this independently unpacked, verified carrier for isolated desktop
  // gates. The assembly staging tree may be absent or old in ZIP-reuse mode.
}

function refreshLegacyCarrier() {
  const refreshRoot = path.join(staging, `.legacy-refresh-${process.pid}`);
  const refreshedZip = `${zip}.fresh-${process.pid}.zip`;
  rmSync(refreshRoot, { recursive: true, force: true });
  rmSync(refreshedZip, { force: true });
  mkdirSync(refreshRoot, { recursive: true });
  try {
    run(resolveTar(), ['-xf', path.resolve(zip), '-C', refreshRoot], { cwd: srcTauri });
    const extractedPayload = path.join(refreshRoot, 'dsh-runtime');
    const matrixPath = path.join(extractedPayload, 'VERSION_MATRIX.json');
    const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
    if (matrix.sourceCommit !== pinnedCommit) {
      throw new Error('reusable DSH carrier source commit does not match the pinned source');
    }
    const currentGatewaySha256 = sha256(gateway);
    if (matrix.gatewaySha256?.toLowerCase() !== currentGatewaySha256 || !isZip(zip)) {
      mkdirSync(path.join(extractedPayload, 'gateway'), { recursive: true });
      cpSync(gateway, path.join(extractedPayload, 'gateway', 'novel-domain-gateway.exe'), {
        force: true,
      });
      matrix.gatewaySha256 = currentGatewaySha256;
      writeFileSync(matrixPath, JSON.stringify(matrix, null, 2) + '\n');
      run(resolveTar(), ['-a', '-c', '-f', refreshedZip, '-C', refreshRoot, 'dsh-runtime'], {
        cwd: srcTauri,
      });
      renameSync(refreshedZip, zip);
      console.log('[dsh-assets] refreshed legacy carrier Gateway and VERSION_MATRIX');
    }
  } finally {
    rmSync(refreshRoot, { recursive: true, force: true });
    rmSync(refreshedZip, { force: true });
  }
}

console.log('[dsh-assets] building read-only gateway');
run('cargo', ['build', '--locked', '--release', '-p', 'novel-domain-gateway'], { cwd: srcTauri });
if (!existsSync(gateway) || statSync(gateway).size === 0) {
  throw new Error('gateway binary missing after release build: ' + gateway);
}

const zip = path.join(binDir, 'dsh-runtime.zip');
if (!checkout || !existsSync(path.join(checkout, 'pnpm-lock.yaml'))) {
  if (existsSync(zip) && statSync(zip).size > 1_000_000) {
    let gatewaySha256;
    try {
      gatewaySha256 = verifyReusableCarrier({ zip, currentGateway: gateway, pinnedCommit });
      if (!isZip(zip)) refreshLegacyCarrier();
    } catch {
      refreshLegacyCarrier();
      gatewaySha256 = verifyReusableCarrier({ zip, currentGateway: gateway, pinnedCommit });
    }
    stageBundleResources(gatewaySha256);
    console.log('[dsh-assets] using verified pinned DSH carrier zip; gateway=' + gatewaySha256);
    process.exit(0);
  }
  throw new Error('DSH_CHECKOUT must point to a built checkout of the pinned DSH source');
}
const actualCommit = capture('git', ['rev-parse', 'HEAD'], { cwd: checkout });
if (actualCommit !== pinnedCommit) {
  throw new Error(`DSH checkout drift: expected ${pinnedCommit}, got ${actualCommit}`);
}
const trackedChanges = capture('git', ['status', '--porcelain', '--untracked-files=no'], {
  cwd: checkout,
});
if (trackedChanges) {
  throw new Error('DSH_CHECKOUT has tracked changes; use a clean pinned build checkout');
}

console.log('[dsh-assets] assembling pinned runtime carrier');
run(
  'node',
  [
    path.join(root, 'scripts', 'dsh', 'build-runtime-payload.mjs'),
    checkout,
    payload,
    pinnedCommit,
    '--if-missing',
  ],
  { cwd: root },
);
mkdirSync(path.join(payload, 'gateway'), { recursive: true });
cpSync(gateway, path.join(payload, 'gateway', 'novel-domain-gateway.exe'), { force: true });
for (const required of ['VERSION_MATRIX.json', 'JUNCTIONS.json']) {
  if (!existsSync(path.join(payload, required))) {
    throw new Error('runtime carrier is missing ' + required);
  }
}
writeGatewayHash(payload);

mkdirSync(binDir, { recursive: true });
rmSync(zip, { force: true });
console.log('[dsh-assets] creating zip64 runtime carrier');
const entries = junctionEntries();
stripJunctions(entries);
try {
  run(resolveTar(), ['-a', '-c', '-f', zip, '-C', staging, 'dsh-runtime'], { cwd: srcTauri });
} finally {
  restoreJunctions(entries);
}
if (!existsSync(zip) || statSync(zip).size === 0) {
  throw new Error('runtime carrier zip was not created');
}
const gatewaySha256 = verifyReusableCarrier({
  zip,
  currentGateway: gateway,
  pinnedCommit,
});
console.log('[dsh-assets] verified carrier Gateway SHA-256: ' + gatewaySha256);
stageBundleResources(gatewaySha256);
console.log('[dsh-assets] release resources ready: ' + binDir);
