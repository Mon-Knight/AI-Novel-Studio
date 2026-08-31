import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CARRIER_ROOT = 'dsh-runtime';
const MATRIX_RELATIVE = path.join(CARRIER_ROOT, 'VERSION_MATRIX.json');
const GATEWAY_RELATIVE = path.join(CARRIER_ROOT, 'gateway', 'novel-domain-gateway.exe');
const ERROR_PREFIX = 'DSH carrier freshness verification failed: ';

function staleCarrier(reason) {
  return new Error(`${ERROR_PREFIX}${reason}; rebuild it from the clean pinned DSH_CHECKOUT`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function requireNonEmptyFile(file, label) {
  try {
    const metadata = lstatSync(file);
    if (metadata.isFile() && metadata.size > 0) return;
  } catch {
    // The stable fail-closed error below is more useful than an OS-specific path error.
  }
  throw staleCarrier(`${label} is missing or empty`);
}

function readPinnedMatrix(file, pinnedCommit) {
  let matrix;
  try {
    requireNonEmptyFile(file, 'VERSION_MATRIX.json');
    matrix = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.message?.startsWith(ERROR_PREFIX)) throw error;
    throw staleCarrier('VERSION_MATRIX.json is missing or invalid');
  }
  if (matrix?.sourceCommit !== pinnedCommit) {
    throw staleCarrier('VERSION_MATRIX.sourceCommit does not match the pinned DSH source');
  }
}

export function verifyExtractedCarrierGateway({ extractedRoot, currentGateway, pinnedCommit }) {
  requireNonEmptyFile(currentGateway, 'current Gateway release binary');
  const carrierGateway = path.join(extractedRoot, GATEWAY_RELATIVE);
  requireNonEmptyFile(carrierGateway, 'carrier Gateway binary');
  readPinnedMatrix(path.join(extractedRoot, MATRIX_RELATIVE), pinnedCommit);

  const currentGatewaySha256 = sha256(currentGateway);
  const carrierGatewaySha256 = sha256(carrierGateway);
  if (carrierGatewaySha256 !== currentGatewaySha256) {
    throw staleCarrier('Gateway SHA-256 does not match the current release build');
  }
  return currentGatewaySha256;
}

export function verifyReusableCarrier({
  zip,
  currentGateway,
  pinnedCommit,
  temporaryParent = tmpdir(),
}) {
  if (!existsSync(zip)) throw staleCarrier('carrier zip is missing');
  const extractedRoot = mkdtempSync(path.join(temporaryParent, 'ans-dsh-carrier-verify-'));
  try {
    const extraction = spawnSync(
      'tar',
      [
        '-xf',
        path.resolve(zip),
        '-C',
        extractedRoot,
        MATRIX_RELATIVE.replaceAll(path.sep, '/'),
        GATEWAY_RELATIVE.replaceAll(path.sep, '/'),
      ],
      { encoding: 'utf8' },
    );
    if (extraction.error || extraction.status !== 0) {
      throw staleCarrier('required Gateway freshness entries could not be extracted');
    }
    return verifyExtractedCarrierGateway({ extractedRoot, currentGateway, pinnedCommit });
  } finally {
    rmSync(extractedRoot, { recursive: true, force: true });
  }
}
