import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { npmCommand } from '../quality/verification-process.mjs';
import { verifyExtractedCarrierGateway } from '../dsh/carrier-freshness.mjs';

export const DESKTOP_DSH_PINNED_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';
export const CARRIER_STAMP_RELATIVE = path.join('.e2e-tools', '.ans-e2e-carrier-stamp.json');
const CARRIER_STAMP_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;

const RUNTIME_BIN_RELATIVE = path.join('packages', 'examples', 'jsonrpc-demo', 'lib', 'bin.js');
const REQUIRED_CARRIER_RELATIVES = [
  RUNTIME_BIN_RELATIVE,
  path.join('packages', 'sdk', 'protocol', 'lib', 'index.js'),
  path.join('packages', 'core', 'agent', 'lib', 'index.js'),
  path.join('packages', 'llm', 'llm', 'lib', 'index.js'),
  path.join('packages', 'core', 'session', 'lib', 'index.js'),
  path.join('packages', 'examples', 'jsonrpc-demo', 'node_modules', '@deepseek-ai', 'dsh-app-boot'),
];

export function desktopCarrierPaths(root) {
  const extractedRoot = path.join(root, 'src-tauri', '.payload-verify');
  return {
    extractedRoot,
    runtimeRoot: path.join(extractedRoot, 'dsh-runtime'),
    gateway: path.join(root, 'src-tauri', 'target', 'release', 'novel-domain-gateway.exe'),
  };
}

export function desktopCarrierStampPath(root) {
  return path.join(root, CARRIER_STAMP_RELATIVE);
}

export function desktopCarrierEnvironment(paths) {
  return {
    DSH_RUNTIME_ROOT: paths.runtimeRoot,
    DSH_GATEWAY_BIN: paths.gateway,
  };
}

function runProcess(executable, args, root, failureLabel = 'Desktop carrier preparation') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${failureLabel} failed with exit ${String(code)}.`));
    });
  });
}

function buildReleaseGateway(root) {
  return runProcess(
    'cargo',
    [
      'build',
      '--locked',
      '--release',
      '--manifest-path',
      path.join('src-tauri', 'Cargo.toml'),
      '-p',
      'novel-domain-gateway',
    ],
    root,
    'Desktop carrier Gateway build',
  );
}

function sha256FileStream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function insideRuntimeRoot(runtimeRoot, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('invalid junction path');
  }
  const resolved = path.resolve(runtimeRoot, relative);
  const prefix = runtimeRoot.endsWith(path.sep) ? runtimeRoot : runtimeRoot + path.sep;
  if (resolved === runtimeRoot || !resolved.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error(`junction path escapes runtime root: ${relative}`);
  }
  return resolved;
}

function verifyJunctions(runtimeRoot, readFileSync, statSync) {
  const junctions = JSON.parse(readFileSync(path.join(runtimeRoot, 'JUNCTIONS.json'), 'utf8'));
  if (!Array.isArray(junctions)) {
    throw new Error('JUNCTIONS.json must contain an array');
  }
  for (const entry of junctions) {
    const linkPath = insideRuntimeRoot(runtimeRoot, entry?.link);
    statSync(linkPath);
  }
}

function carrierSourceFiles(root, runtimeRoot) {
  return {
    zipPath: path.join(root, 'src-tauri', 'bin', 'dsh-runtime.zip'),
    gatewayHashFile: path.join(root, 'src-tauri', 'bin', 'gateway-sha256.txt'),
    bundledUnpacker: path.join(root, 'src-tauri', 'bin', 'unpack-payload.mjs'),
    sourceUnpacker: path.join(root, 'scripts', 'dsh', 'unpack-payload.mjs'),
    matrixPath: path.join(runtimeRoot, 'VERSION_MATRIX.json'),
    junctionsPath: path.join(runtimeRoot, 'JUNCTIONS.json'),
    runtimeBin: path.join(runtimeRoot, RUNTIME_BIN_RELATIVE),
  };
}

function isValidCarrierStamp(stamp) {
  return (
    stamp?.schemaVersion === CARRIER_STAMP_SCHEMA_VERSION &&
    stamp?.pinnedCommit === DESKTOP_DSH_PINNED_COMMIT &&
    typeof stamp?.zipSha256 === 'string' &&
    SHA256_PATTERN.test(stamp.zipSha256) &&
    typeof stamp?.gatewaySha256 === 'string' &&
    SHA256_PATTERN.test(stamp.gatewaySha256) &&
    typeof stamp?.runtimeBinSha256 === 'string' &&
    SHA256_PATTERN.test(stamp.runtimeBinSha256) &&
    typeof stamp?.unpackerSha256 === 'string' &&
    SHA256_PATTERN.test(stamp.unpackerSha256)
  );
}

async function computeCarrierDigest({
  root,
  runtimeRoot,
  gatewaySha256,
  exists,
  readFileSync,
  statSync,
  sha256File,
}) {
  if (typeof gatewaySha256 !== 'string' || !SHA256_PATTERN.test(gatewaySha256)) {
    throw new Error('verified Gateway SHA-256 is missing or invalid');
  }
  const files = carrierSourceFiles(root, runtimeRoot);
  for (const requiredPath of [
    files.zipPath,
    files.gatewayHashFile,
    files.bundledUnpacker,
    files.sourceUnpacker,
    files.matrixPath,
    files.junctionsPath,
  ]) {
    if (!exists(requiredPath)) {
      throw new Error(`missing carrier artifact: ${requiredPath}`);
    }
  }
  for (const relative of REQUIRED_CARRIER_RELATIVES) {
    if (!exists(path.join(runtimeRoot, relative))) {
      throw new Error(`missing extracted carrier entry: ${relative}`);
    }
  }

  const normalizedGatewaySha256 = gatewaySha256.toLowerCase();
  const recordedGatewayHash = readFileSync(files.gatewayHashFile, 'utf8').trim().toLowerCase();
  if (recordedGatewayHash !== normalizedGatewaySha256) {
    throw new Error('gateway-sha256.txt does not match the verified Gateway');
  }

  const [sourceUnpackerSha256, bundledUnpackerSha256] = await Promise.all([
    sha256File(files.sourceUnpacker),
    sha256File(files.bundledUnpacker),
  ]);
  if (sourceUnpackerSha256 !== bundledUnpackerSha256) {
    throw new Error('bundled unpack-payload.mjs does not match scripts/dsh/unpack-payload.mjs');
  }

  const matrix = JSON.parse(readFileSync(files.matrixPath, 'utf8'));
  if (
    typeof matrix?.runtimeBinSha256 !== 'string' ||
    !SHA256_PATTERN.test(matrix.runtimeBinSha256)
  ) {
    throw new Error('VERSION_MATRIX.runtimeBinSha256 is missing or invalid');
  }
  const actualRuntimeBinSha256 = await sha256File(files.runtimeBin);
  if (actualRuntimeBinSha256 !== matrix.runtimeBinSha256.toLowerCase()) {
    throw new Error('extracted runtime bin SHA-256 does not match VERSION_MATRIX.json');
  }

  verifyJunctions(runtimeRoot, readFileSync, statSync);
  const zipSha256 = await sha256File(files.zipPath);

  return {
    schemaVersion: CARRIER_STAMP_SCHEMA_VERSION,
    pinnedCommit: DESKTOP_DSH_PINNED_COMMIT,
    zipSha256,
    gatewaySha256: normalizedGatewaySha256,
    runtimeBinSha256: actualRuntimeBinSha256,
    unpackerSha256: sourceUnpackerSha256,
  };
}

async function tryReuseVerifiedCarrier({
  root,
  paths,
  stampPath,
  env,
  buildGateway,
  verify,
  exists,
  readFileSync,
  statSync,
  sha256File,
  log,
}) {
  if (env.DSH_CHECKOUT?.trim() || env.AI_NOVEL_STUDIO_FORCE_DSH_ASSETS === '1') {
    return false;
  }
  if (!exists(stampPath)) {
    return false;
  }
  const files = carrierSourceFiles(root, paths.runtimeRoot);
  for (const requiredPath of [
    files.zipPath,
    files.gatewayHashFile,
    files.bundledUnpacker,
    files.sourceUnpacker,
    files.matrixPath,
    files.junctionsPath,
    files.runtimeBin,
  ]) {
    if (!exists(requiredPath)) {
      return false;
    }
  }

  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    return false;
  }
  if (!isValidCarrierStamp(stamp)) {
    return false;
  }

  try {
    await buildGateway(root);
    const gatewaySha256 = verify({
      extractedRoot: paths.extractedRoot,
      currentGateway: paths.gateway,
      pinnedCommit: DESKTOP_DSH_PINNED_COMMIT,
    });
    const digest = await computeCarrierDigest({
      root,
      runtimeRoot: paths.runtimeRoot,
      gatewaySha256,
      exists,
      readFileSync,
      statSync,
      sha256File,
    });
    const matches =
      digest.zipSha256 === stamp.zipSha256.toLowerCase() &&
      digest.gatewaySha256 === stamp.gatewaySha256.toLowerCase() &&
      digest.runtimeBinSha256 === stamp.runtimeBinSha256.toLowerCase() &&
      digest.unpackerSha256 === stamp.unpackerSha256.toLowerCase();
    if (!matches) {
      return false;
    }
    log(`[E2E] reusing verified desktop DSH carrier (${digest.zipSha256.slice(0, 12)})`);
    return true;
  } catch {
    return false;
  }
}

/** Prepare and verify the pinned offline carrier before any desktop application starts. */
export async function prepareDesktopCarrier(root, dependencies = {}) {
  const paths = desktopCarrierPaths(root);
  const run = dependencies.run ?? runProcess;
  const verify = dependencies.verify ?? verifyExtractedCarrierGateway;
  const exists = dependencies.exists ?? fs.existsSync;
  const buildGateway = dependencies.buildGateway ?? buildReleaseGateway;
  const readFileSync = dependencies.readFileSync ?? fs.readFileSync;
  const writeFileSync = dependencies.writeFileSync ?? fs.writeFileSync;
  const mkdirSync = dependencies.mkdirSync ?? fs.mkdirSync;
  const statSync = dependencies.statSync ?? fs.statSync;
  const sha256File = dependencies.sha256File ?? sha256FileStream;
  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? console.log;

  const hasCustomLegacyHooks =
    dependencies.run !== undefined ||
    dependencies.verify !== undefined ||
    dependencies.exists !== undefined;
  const allowStampReuse =
    dependencies.enableStampReuse === true ||
    (!hasCustomLegacyHooks && dependencies.enableStampReuse !== false);

  const stampPath = desktopCarrierStampPath(root);
  if (
    allowStampReuse &&
    (await tryReuseVerifiedCarrier({
      root,
      paths,
      stampPath,
      env,
      buildGateway,
      verify,
      exists,
      readFileSync,
      statSync,
      sha256File,
      log,
    }))
  ) {
    return paths;
  }

  const command = npmCommand('dsh:assets');
  await run(command.executable, command.args, root);
  const verifiedGatewaySha256 = verify({
    extractedRoot: paths.extractedRoot,
    currentGateway: paths.gateway,
    pinnedCommit: DESKTOP_DSH_PINNED_COMMIT,
  });
  const runtimeBin = path.join(paths.runtimeRoot, RUNTIME_BIN_RELATIVE);
  if (!exists(runtimeBin)) {
    throw new Error('The verified desktop DeepSeek carrier has no runtime entry point.');
  }

  if (allowStampReuse) {
    const gatewaySha256 =
      typeof verifiedGatewaySha256 === 'string' && SHA256_PATTERN.test(verifiedGatewaySha256)
        ? verifiedGatewaySha256
        : await sha256File(paths.gateway);
    const digest = await computeCarrierDigest({
      root,
      runtimeRoot: paths.runtimeRoot,
      gatewaySha256,
      exists,
      readFileSync,
      statSync,
      sha256File,
    });
    mkdirSync(path.dirname(stampPath), { recursive: true });
    writeFileSync(stampPath, JSON.stringify(digest, null, 2) + '\n', 'utf8');
  }
  return paths;
}
