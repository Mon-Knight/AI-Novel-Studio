// AI Novel Studio v3.1.0 — DSH runtime payload builder (self-contained carrier).
//
// Mirrors the harness checkout layout so the app can launch the DSH runtime
// WITHOUT DSH_CHECKOUT:
//   <payload>/packages/**/{lib,package.json,node_modules}   (all built packages)
//   <payload>/node_modules/.pnpm                            (real store files)
//   <payload>/node_modules/<top-level links>                (junction farm, remapped)
//   <payload>/VERSION_MATRIX.json
//
// Junction handling: pnpm junctions point at checkout-internal targets
// (workspace packages or the .pnpm store). Every junction is recreated with a
// payload-local target (Windows junctions always store absolute targets, so the
// payload is NOT relocatable — rebuild it at the desired location). fs.cp is
// NOT used for node_modules: Node's cp follows Windows junctions in some paths
// (stack overflow on pnpm cycles); this script walks entries itself.
//
// Usage:
//   node scripts/dsh/build-runtime-payload.mjs <checkoutDir> <payloadDir> [commit] [--no-pnpm]
// Verify afterwards with the e2e test (DSH_RUNTIME_ROOT=<payloadDir>, no DSH_CHECKOUT).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const checkout = process.argv[2]?.trim();
const payload = process.argv[3]?.trim();
const commitArg = process.argv[4]?.trim();
const skipPnpmStore = process.argv.includes('--no-pnpm');
if (!checkout || !payload) {
  console.error(
    'usage: node scripts/dsh/build-runtime-payload.mjs <checkoutDir> <payloadDir> [commit] [--no-pnpm]',
  );
  process.exit(2);
}

const checkoutRoot = path.resolve(checkout);
const payloadRoot = path.resolve(payload);
if (!existsSync(path.join(checkoutRoot, 'pnpm-lock.yaml'))) {
  console.error('checkout dir does not look like the harness root: ' + checkoutRoot);
  process.exit(2);
}
rmSync(payloadRoot, { recursive: true, force: true });
mkdirSync(payloadRoot, { recursive: true });

const log = (message) => console.log('[payload] ' + message);
const checkoutPrefix = checkoutRoot + path.sep;
let copiedFiles = 0;
let copiedDirs = 0;
let relinked = 0;

/** Maps an absolute checkout-internal target to its payload-internal relative suffix. */
function remapInside(target) {
  const normalized = target.replace(/\//g, '\\');
  if (!normalized.toLowerCase().startsWith(checkoutPrefix.toLowerCase())) return null;
  return normalized.slice(checkoutPrefix.length);
}

/** Top-level roots (packages/vendor/native/...) referenced by junction targets. */
const referencedRoots = new Set(['packages', 'vendor']);
function noteRoot(inside) {
  const root = inside.split(path.sep)[0];
  if (root && root !== 'node_modules') referencedRoots.add(root);
}

/** Junction-aware recursive copy: symlinks/junctions are recreated (absolute targets remapped), files copied, dirs recursed. */
function copyTree(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = readlinkSync(from);
      } catch {
        continue;
      }
      if (path.isAbsolute(target)) {
        const inside = remapInside(target);
        if (inside === null) {
          console.error('link target escapes the checkout: ' + from + ' -> ' + target);
          process.exit(2);
        }
        noteRoot(inside);
        // Junction stores the absolute payload-local path (not relocatable).
        symlinkSync(path.join(payloadRoot, inside), to, 'junction');
      } else {
        symlinkSync(path.resolve(toDir, target), to, 'junction');
      }
      relinked += 1;
    } else if (entry.isDirectory()) {
      copyTree(from, to);
      copiedDirs += 1;
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      copiedFiles += 1;
    }
  }
}

// 1. All built packages: lib + package.json + node_modules.
log('copying packages (lib + package.json + node_modules)...');
const packagesRoot = path.join(checkoutRoot, 'packages');
const visitPackage = (dir, relative, depth) => {
  if (depth > 4) return;
  if (existsSync(path.join(dir, 'package.json'))) {
    const target = path.join(payloadRoot, relative);
    mkdirSync(target, { recursive: true });
    copyFileSync(path.join(dir, 'package.json'), path.join(target, 'package.json'));
    if (existsSync(path.join(dir, 'lib'))) {
      copyTree(path.join(dir, 'lib'), path.join(target, 'lib'));
    }
    if (existsSync(path.join(dir, 'node_modules'))) {
      copyTree(path.join(dir, 'node_modules'), path.join(target, 'node_modules'));
    }
  }
  if (depth < 4) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        visitPackage(path.join(dir, entry.name), path.join(relative, entry.name), depth + 1);
      }
    }
  }
};
visitPackage(packagesRoot, 'packages', 0);
visitPackage(path.join(checkoutRoot, 'vendor'), 'vendor', 0);

// 2. Root .pnpm store (real files + internal junctions).
const checkoutNodeModules = path.join(checkoutRoot, 'node_modules');
const payloadNodeModules = path.join(payloadRoot, 'node_modules');
if (!existsSync(checkoutNodeModules)) {
  console.error('checkout node_modules missing; run pnpm install in the checkout first');
  process.exit(2);
}
mkdirSync(payloadNodeModules, { recursive: true });
if (!skipPnpmStore) {
  log('copying .pnpm store (junction-aware walk)...');
  copyTree(path.join(checkoutNodeModules, '.pnpm'), path.join(payloadNodeModules, '.pnpm'));
  log('.pnpm store copied');
} else {
  log('skipping .pnpm store copy (--no-pnpm)');
}

// 3. Root node_modules top-level links (everything except .pnpm).
log('recreating top-level node_modules entries...');
for (const entry of readdirSync(checkoutNodeModules, { withFileTypes: true })) {
  if (entry.name === '.pnpm') continue;
  const from = path.join(checkoutNodeModules, entry.name);
  const to = path.join(payloadNodeModules, entry.name);
  let target;
  try {
    target = readlinkSync(from);
  } catch {
    const info = entry;
    if (info.isFile()) {
      copyFileSync(from, to); // regular file (e.g. .modules.yaml)
    } else if (info.isDirectory()) {
      copyTree(from, to); // regular dir (e.g. .bin)
    }
    continue;
  }
  if (!path.isAbsolute(target)) {
    symlinkSync(path.resolve(payloadNodeModules, target), to, 'junction');
    relinked += 1;
    continue;
  }
  const inside = remapInside(target);
  if (inside === null) {
    console.error('link target escapes the checkout: ' + from + ' -> ' + target);
    process.exit(2);
  }
  noteRoot(inside);
  symlinkSync(path.join(payloadRoot, inside), to, 'junction');
  relinked += 1;
}

// 3b. Any additional roots discovered from junction targets (native/, apps/...).
{
  const visited = new Set(['packages', 'vendor']);
  let progress = true;
  while (progress) {
    progress = false;
    for (const rootName of [...referencedRoots]) {
      if (visited.has(rootName)) continue;
      visited.add(rootName);
      const rootDir = path.join(checkoutRoot, rootName);
      if (existsSync(rootDir)) {
        log('visiting additional root: ' + rootName);
        visitPackage(rootDir, rootName, 0);
        progress = true;
      }
    }
  }
}

// 4. Junction target existence gate: every created junction must point at
// something that actually exists inside the payload (silent broken links
// would otherwise surface only at runtime boot).
{
  let broken = 0;
  const check = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          statSync(full);
        } catch {
          broken += 1;
          if (broken <= 5) console.error('broken junction: ' + full + ' -> ' + readlinkSync(full));
        }
      } else if (entry.isDirectory()) {
        check(full);
      }
    }
  };
  check(payloadRoot);
  if (broken > 0) {
    console.error('payload has ' + broken + ' broken junctions');
    process.exit(2);
  }
  log('junction existence gate passed');
}

// 5. Verification + version matrix.
const binJs = path.join(payloadRoot, 'packages/examples/jsonrpc-demo/lib/bin.js');
const serverEntry = path.join(payloadRoot, 'packages/sdk/server/lib/index.js');
if (!existsSync(binJs) || !existsSync(serverEntry)) {
  console.error('payload verification failed: bin.js or server entry missing');
  process.exit(2);
}
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
const matrix = {
  builtAt: new Date().toISOString(),
  sourceCommit: commitArg || 'unknown',
  nodeVersion: process.version,
  runtimeBinSha256: sha256(binJs),
  packageLockSha256: sha256(path.join(checkoutRoot, 'pnpm-lock.yaml')),
  note: 'DSH_SESSION_FORMAT_VERSION=0, no compatibility promise; payload is disposable.',
};
writeFileSync(
  path.join(payloadRoot, 'VERSION_MATRIX.json'),
  JSON.stringify(matrix, null, 2) + '\n',
);
log(
  'done: files=' +
    copiedFiles +
    ' dirs=' +
    copiedDirs +
    ' links=' +
    relinked +
    ' payload=' +
    payloadRoot,
);
console.log(JSON.stringify(matrix, null, 2));
