// Atomically extracts a DSH carrier into a writable application-data folder,
// rebuilds Windows junctions for the final location and verifies the pinned
// runtime hash. Usage: node unpack-payload.mjs <zipPath> <destDir>
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
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
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function complete(root) {
  try {
    const matrix = JSON.parse(readFileSync(path.join(root, 'VERSION_MATRIX.json'), 'utf8'));
    return (
      existsSync(path.join(root, 'JUNCTIONS.json')) &&
      existsSync(path.join(root, runtimeRelative)) &&
      sha256(path.join(root, runtimeRelative)) === matrix.runtimeBinSha256
    );
  } catch {
    return false;
  }
}

function inside(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) {
    throw new Error('invalid absolute junction path');
  }
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error('junction path escapes runtime root: ' + relative);
  }
  return resolved;
}

if (complete(finalRoot)) {
  console.log('runtime carrier already verified: ' + finalRoot);
  process.exit(0);
}

mkdirSync(destination, { recursive: true });
const temporary = path.join(destination, `.dsh-runtime-unpack-${process.pid}-${Date.now()}`);
rmSync(temporary, { recursive: true, force: true });
mkdirSync(temporary, { recursive: true });
try {
  const extraction = spawnSync('tar', ['-xf', path.resolve(zipPath), '-C', temporary], {
    stdio: 'inherit',
  });
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) {
    throw new Error('tar extraction failed with exit ' + String(extraction.status));
  }
  const stagedRoot = path.join(temporary, 'dsh-runtime');
  const junctions = JSON.parse(readFileSync(path.join(stagedRoot, 'JUNCTIONS.json'), 'utf8'));
  if (!Array.isArray(junctions)) throw new Error('JUNCTIONS.json must contain an array');
  for (const entry of junctions) {
    const link = inside(stagedRoot, entry?.link);
    const target = inside(stagedRoot, entry?.target);
    rmSync(link, { recursive: true, force: true });
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link, 'junction');
    statSync(link);
  }
  if (!complete(stagedRoot)) throw new Error('relocated runtime carrier verification failed');

  rmSync(finalRoot, { recursive: true, force: true });
  try {
    renameSync(stagedRoot, finalRoot);
  } catch (error) {
    if (!complete(finalRoot)) throw error;
  }
  if (!complete(finalRoot)) throw new Error('installed runtime carrier verification failed');
  console.log('runtime carrier installed: ' + finalRoot);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
