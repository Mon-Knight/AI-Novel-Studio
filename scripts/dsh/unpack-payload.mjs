// Atomically extracts a DSH carrier into a writable application-data folder,
// rebuilds Windows junctions for the final location and verifies the pinned
// runtime hash. Usage: node unpack-payload.mjs <zipPath> <destDir>
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const zipPath = process.argv[2]?.trim();
const destDir = process.argv[3]?.trim();
if (!zipPath || !destDir || !existsSync(zipPath)) {
  console.error('usage: node unpack-payload.mjs <existingZipPath> <destDir>');
  process.exit(2);
}

const destination = path.resolve(destDir);
const finalRoot = path.join(destination, 'dsh-runtime');
const runtimeRelative = path.join('packages', 'examples', 'jsonrpc-demo', 'lib', 'bin.js');
const gatewayRelative = path.join('gateway', 'novel-domain-gateway.exe');
const requiredRelatives = [
  runtimeRelative,
  path.join('packages', 'sdk', 'protocol', 'lib', 'index.js'),
  path.join('packages', 'core', 'agent', 'lib', 'index.js'),
  path.join('packages', 'llm', 'llm', 'lib', 'index.js'),
  path.join('packages', 'core', 'session', 'lib', 'index.js'),
  path.join('packages', 'examples', 'jsonrpc-demo', 'node_modules', '@deepseek-ai', 'dsh-app-boot'),
];
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// This script is shipped as a standalone Tauri resource. It must not import
// helpers that are only present in the development checkout.
function resolveTar() {
  if (process.platform === 'win32') {
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(systemTar)) return systemTar;
  }
  return 'tar';
}

function identity(matrix) {
  if (
    typeof matrix?.sourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/iu.test(matrix.sourceCommit) ||
    typeof matrix?.runtimeBinSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/iu.test(matrix.runtimeBinSha256) ||
    typeof matrix?.gatewaySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/iu.test(matrix.gatewaySha256)
  ) {
    throw new Error('runtime carrier identity is missing or invalid');
  }
  return Object.freeze({
    sourceCommit: matrix.sourceCommit.toLowerCase(),
    runtimeBinSha256: matrix.runtimeBinSha256.toLowerCase(),
    gatewaySha256: matrix.gatewaySha256.toLowerCase(),
  });
}

function readBundledIdentity() {
  const temporary = mkdtempSync(path.join(tmpdir(), 'ans-dsh-carrier-matrix-'));
  try {
    const archive = path.resolve(zipPath);
    const extraction = spawnSync(
      resolveTar(),
      ['-xf', path.basename(archive), '-C', temporary, 'dsh-runtime/VERSION_MATRIX.json'],
      { stdio: 'inherit', cwd: path.dirname(archive) },
    );
    if (extraction.error) throw extraction.error;
    if (extraction.status !== 0) {
      throw new Error('runtime carrier identity extraction failed');
    }
    return identity(
      JSON.parse(readFileSync(path.join(temporary, 'dsh-runtime', 'VERSION_MATRIX.json'), 'utf8')),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// A self-consistent installed matrix is not proof of freshness: compare it
// with the carrier shipped by this application before any fast-path return.
const expectedIdentity = readBundledIdentity();

function complete(root) {
  try {
    const actualIdentity = identity(
      JSON.parse(readFileSync(path.join(root, 'VERSION_MATRIX.json'), 'utf8')),
    );
    return (
      Object.keys(expectedIdentity).every((key) => actualIdentity[key] === expectedIdentity[key]) &&
      existsSync(path.join(root, 'JUNCTIONS.json')) &&
      requiredRelatives.every((relative) => existsSync(path.join(root, relative))) &&
      existsSync(path.join(root, gatewayRelative)) &&
      sha256(path.join(root, runtimeRelative)) === expectedIdentity.runtimeBinSha256 &&
      sha256(path.join(root, gatewayRelative)) === expectedIdentity.gatewaySha256
    );
  } catch {
    return false;
  }
}

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('invalid absolute junction path');
  }
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved === root || !resolved.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error('junction path escapes runtime root: ' + relative);
  }
  return resolved;
}

function rebuildJunctions(root) {
  const junctions = JSON.parse(readFileSync(path.join(root, 'JUNCTIONS.json'), 'utf8'));
  if (!Array.isArray(junctions)) throw new Error('JUNCTIONS.json must contain an array');
  // Validate every entry before touching any path. In particular, neither a
  // link nor its target may name the carrier root or escape it.
  const resolved = junctions.map((entry) => {
    const link = inside(root, entry?.link);
    const target = inside(root, entry?.target);
    if (link.toLowerCase() === target.toLowerCase()) {
      throw new Error('junction link and target must differ');
    }
    return { link, target };
  });
  for (const { link, target } of resolved) {
    rmSync(link, { recursive: true, force: true });
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link, 'junction');
    statSync(link);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(source, target) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || Date.now() >= deadline) {
        throw error;
      }
      sleep(250);
    }
  }
}

function withUnpackLock(fn) {
  const lockPath = path.join(destination, '.dsh-runtime.lock');
  mkdirSync(destination, { recursive: true });
  const deadline = Date.now() + 10 * 60 * 1000;
  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        return fn();
      } finally {
        closeSync(fd);
        try {
          unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (complete(finalRoot)) {
        console.log('runtime carrier already verified: ' + finalRoot);
        process.exit(0);
      }
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for DSH unpack lock');
      }
      sleep(500);
    }
  }
}

if (complete(finalRoot)) {
  console.log('runtime carrier already verified: ' + finalRoot);
  process.exit(0);
}

withUnpackLock(() => {
  if (complete(finalRoot)) {
    console.log('runtime carrier already verified: ' + finalRoot);
    return;
  }

  mkdirSync(destination, { recursive: true });
  const temporary = path.join(destination, `.dsh-runtime-unpack-${process.pid}-${Date.now()}`);
  const previous = path.join(destination, `.dsh-runtime-previous-${process.pid}-${Date.now()}`);
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: true });
  try {
    const archive = path.resolve(zipPath);
    const extraction = spawnSync(resolveTar(), ['-xf', path.basename(archive), '-C', temporary], {
      stdio: 'inherit',
      cwd: path.dirname(archive),
    });
    if (extraction.error) throw extraction.error;
    if (extraction.status !== 0) {
      throw new Error('tar extraction failed with exit ' + String(extraction.status));
    }
    const stagedRoot = path.join(temporary, 'dsh-runtime');
    if (!existsSync(path.join(stagedRoot, 'JUNCTIONS.json'))) {
      throw new Error('extracted runtime carrier is missing JUNCTIONS.json');
    }
    rebuildJunctions(stagedRoot);
    if (!complete(stagedRoot)) throw new Error('extracted runtime carrier verification failed');
    // Retain the old carrier until the replacement passes final-location
    // verification. A corrupt archive must not destroy a working runtime.
    const hadPrevious = existsSync(finalRoot);
    if (hadPrevious) renameWithRetry(finalRoot, previous);
    try {
      renameWithRetry(stagedRoot, finalRoot);
      rebuildJunctions(finalRoot);
      if (!complete(finalRoot)) throw new Error('installed runtime carrier verification failed');
    } catch (error) {
      rmSync(finalRoot, { recursive: true, force: true });
      if (hadPrevious) renameWithRetry(previous, finalRoot);
      throw error;
    }
    if (hadPrevious) rmSync(previous, { recursive: true, force: true });
    console.log('runtime carrier installed: ' + finalRoot);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
