import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUNDLE_LIMITS = Object.freeze({
  entryBytes: 400 * 1024,
  entryGzipBytes: 135 * 1024,
  chunkBytes: 450 * 1024,
  chunkGzipBytes: 160 * 1024,
});

export const REQUIRED_VENDOR_CHUNKS = Object.freeze([
  'vendor-react',
  'vendor-router',
  'vendor-zustand',
  'vendor-tauri',
]);

export const PRODUCTION_FORBIDDEN_MARKERS = Object.freeze([
  'runDomainFacadeSqliteSmoke',
  'e2eDomainFacadeProbe',
]);

const DEFAULT_DIST_DIR = 'dist';
const MANIFEST_RELATIVE_PATH = '.vite/manifest.json';
const EXPECTED_ENTRY_KEY = 'index.html';

export class BundleSizeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'BundleSizeError';
  }
}

function assertPlainObject(value, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BundleSizeError(`${description} must be a JSON object.`);
  }
}

function assertLimits(limits) {
  assertPlainObject(limits, 'Bundle limits');
  for (const name of ['entryBytes', 'entryGzipBytes', 'chunkBytes', 'chunkGzipBytes']) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BundleSizeError(`Bundle limit ${name} must be a positive integer.`);
    }
  }
}

function normalizeManifestFile(file, manifestKey) {
  if (typeof file !== 'string' || file.length === 0) {
    throw new BundleSizeError(`Manifest record ${JSON.stringify(manifestKey)} has no file.`);
  }
  if (file.includes('\\') || file.includes('\0') || path.posix.isAbsolute(file)) {
    throw new BundleSizeError(
      `Manifest record ${JSON.stringify(manifestKey)} has an unsafe file path: ${file}`,
    );
  }

  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized.startsWith('../') || !normalized.startsWith('assets/')) {
    throw new BundleSizeError(
      `Manifest record ${JSON.stringify(manifestKey)} must reference a normalized assets/ path: ${file}`,
    );
  }
  return normalized;
}

async function listJavaScriptFiles(directory, rootDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === '.vite') {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(absolutePath, rootDirectory)));
    } else if (entry.isSymbolicLink()) {
      throw new BundleSizeError(`Bundle output must not contain a symbolic link: ${absolutePath}`);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.relative(rootDirectory, absolutePath).replaceAll('\\', '/'));
    }
  }

  return files.sort();
}

function assertSameFiles(manifestFiles, emittedFiles) {
  const manifestSet = new Set(manifestFiles);
  const emittedSet = new Set(emittedFiles);
  const missingFiles = [...manifestSet].filter((file) => !emittedSet.has(file));
  const unmanifestedFiles = [...emittedSet].filter((file) => !manifestSet.has(file));

  if (missingFiles.length > 0 || unmanifestedFiles.length > 0) {
    const details = [];
    if (missingFiles.length > 0) {
      details.push(`missing from dist: ${missingFiles.join(', ')}`);
    }
    if (unmanifestedFiles.length > 0) {
      details.push(`not represented by manifest: ${unmanifestedFiles.join(', ')}`);
    }
    throw new BundleSizeError(`Manifest/JavaScript output mismatch (${details.join('; ')}).`);
  }
}

async function inspectJavaScriptFile(distDirectory, relativeFile) {
  const absolutePath = path.resolve(distDirectory, ...relativeFile.split('/'));
  const distPrefix = `${path.resolve(distDirectory)}${path.sep}`;
  if (!absolutePath.startsWith(distPrefix)) {
    throw new BundleSizeError(`Bundle file escapes dist directory: ${relativeFile}`);
  }

  const fileMetadata = await lstat(absolutePath);
  if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink()) {
    throw new BundleSizeError(`Bundle path is not a regular file: ${absolutePath}`);
  }

  const content = await readFile(absolutePath);
  if (content.byteLength !== fileMetadata.size) {
    throw new BundleSizeError(`Bundle file changed while it was being measured: ${absolutePath}`);
  }

  for (const marker of PRODUCTION_FORBIDDEN_MARKERS) {
    if (content.includes(marker)) {
      throw new BundleSizeError(
        `Production bundle ${relativeFile} contains forbidden E2E marker: ${marker}`,
      );
    }
  }

  return {
    file: relativeFile,
    bytes: content.byteLength,
    gzipBytes: gzipSync(content, { level: 9 }).byteLength,
  };
}

function assertWithinLimit(measurement, limitName, limit, label) {
  if (measurement > limit) {
    throw new BundleSizeError(
      `${label} is ${formatBytes(measurement)}, above the ${formatBytes(limit)} ${limitName} limit.`,
    );
  }
}

export function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} B (${(bytes / 1024).toFixed(2)} KiB)`;
}

export async function inspectBundle({
  distDir = DEFAULT_DIST_DIR,
  limits = BUNDLE_LIMITS,
  requiredVendorChunks = REQUIRED_VENDOR_CHUNKS,
  expectedEntryKey = EXPECTED_ENTRY_KEY,
} = {}) {
  assertLimits(limits);
  if (!Array.isArray(requiredVendorChunks) || requiredVendorChunks.length === 0) {
    throw new BundleSizeError('At least one required vendor chunk must be configured.');
  }

  const distDirectory = path.resolve(distDir);
  let distMetadata;
  try {
    distMetadata = await stat(distDirectory);
  } catch (error) {
    throw new BundleSizeError(`Dist directory is missing: ${distDirectory}`, { cause: error });
  }
  if (!distMetadata.isDirectory()) {
    throw new BundleSizeError(`Dist path is not a directory: ${distDirectory}`);
  }

  const canonicalDistDirectory = await realpath(distDirectory);
  const manifestPath = path.join(canonicalDistDirectory, ...MANIFEST_RELATIVE_PATH.split('/'));
  let manifestText;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new BundleSizeError(`Vite manifest is missing: ${manifestPath}`, { cause: error });
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new BundleSizeError(`Vite manifest is invalid JSON: ${manifestPath}`, { cause: error });
  }
  assertPlainObject(manifest, 'Vite manifest');

  const manifestRecords = Object.entries(manifest);
  if (manifestRecords.length === 0) {
    throw new BundleSizeError(`Vite manifest is empty: ${manifestPath}`);
  }

  const entryRecords = manifestRecords.filter(([, record]) => record?.isEntry === true);
  if (entryRecords.length !== 1) {
    throw new BundleSizeError(
      `Expected exactly one JavaScript entry in ${manifestPath}; found ${entryRecords.length}.`,
    );
  }
  const [entryKey, entryRecord] = entryRecords[0];
  if (entryKey !== expectedEntryKey) {
    throw new BundleSizeError(
      `Expected manifest entry ${JSON.stringify(expectedEntryKey)}; found ${JSON.stringify(entryKey)}.`,
    );
  }

  const fileToManifestKey = new Map();
  const vendorChunkRecords = new Map();
  for (const [manifestKey, record] of manifestRecords) {
    assertPlainObject(record, `Manifest record ${JSON.stringify(manifestKey)}`);
    const relativeFile = normalizeManifestFile(record.file, manifestKey);
    if (!relativeFile.endsWith('.js')) {
      continue;
    }
    const existingKey = fileToManifestKey.get(relativeFile);
    if (existingKey !== undefined) {
      throw new BundleSizeError(
        `Manifest file ${relativeFile} is ambiguously owned by ${JSON.stringify(existingKey)} and ${JSON.stringify(manifestKey)}.`,
      );
    }
    fileToManifestKey.set(relativeFile, manifestKey);

    if (requiredVendorChunks.includes(record.name)) {
      if (vendorChunkRecords.has(record.name)) {
        throw new BundleSizeError(
          `Vendor chunk ${record.name} appears more than once in the manifest.`,
        );
      }
      vendorChunkRecords.set(record.name, relativeFile);
    }
  }

  const entryFile = normalizeManifestFile(entryRecord.file, entryKey);
  if (!entryFile.endsWith('.js')) {
    throw new BundleSizeError(
      `Manifest entry ${JSON.stringify(entryKey)} is not JavaScript: ${entryFile}`,
    );
  }

  for (const vendorChunk of requiredVendorChunks) {
    const vendorFile = vendorChunkRecords.get(vendorChunk);
    if (vendorFile === undefined) {
      throw new BundleSizeError(
        `Required vendor chunk is missing from the manifest: ${vendorChunk}`,
      );
    }
    if (!vendorFile.startsWith(`assets/${vendorChunk}-`)) {
      throw new BundleSizeError(
        `Vendor chunk ${vendorChunk} has an unstable output name: ${vendorFile}`,
      );
    }
  }

  const manifestJavaScriptFiles = [...fileToManifestKey.keys()].sort();
  const emittedJavaScriptFiles = await listJavaScriptFiles(canonicalDistDirectory);
  if (manifestJavaScriptFiles.length === 0) {
    throw new BundleSizeError(`Vite manifest contains no JavaScript output: ${manifestPath}`);
  }
  assertSameFiles(manifestJavaScriptFiles, emittedJavaScriptFiles);

  const chunks = await Promise.all(
    manifestJavaScriptFiles.map((file) => inspectJavaScriptFile(canonicalDistDirectory, file)),
  );
  const entry = chunks.find((chunk) => chunk.file === entryFile);
  if (entry === undefined) {
    throw new BundleSizeError(`Manifest entry file was not measured: ${entryFile}`);
  }

  assertWithinLimit(entry.bytes, 'entry raw', limits.entryBytes, `Entry ${entry.file}`);
  assertWithinLimit(entry.gzipBytes, 'entry gzip-9', limits.entryGzipBytes, `Entry ${entry.file}`);
  for (const chunk of chunks) {
    assertWithinLimit(chunk.bytes, 'per-chunk raw', limits.chunkBytes, `Chunk ${chunk.file}`);
    assertWithinLimit(
      chunk.gzipBytes,
      'per-chunk gzip-9',
      limits.chunkGzipBytes,
      `Chunk ${chunk.file}`,
    );
  }

  const byRawSize = [...chunks].sort((left, right) => right.bytes - left.bytes);
  const byGzipSize = [...chunks].sort((left, right) => right.gzipBytes - left.gzipBytes);
  return {
    distDirectory: canonicalDistDirectory,
    manifestPath,
    entry,
    largestRaw: byRawSize[0],
    largestGzip: byGzipSize[0],
    chunks,
    limits,
    vendorChunks: Object.fromEntries(vendorChunkRecords),
  };
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) {
    return { distDir: DEFAULT_DIST_DIR };
  }
  if (arguments_.length === 2 && arguments_[0] === '--dist-dir' && arguments_[1].trim() !== '') {
    return { distDir: arguments_[1] };
  }
  throw new BundleSizeError('Usage: node scripts/quality/check-bundle-size.mjs [--dist-dir PATH]');
}

function printResult(result) {
  console.log('[bundle-size] PASS');
  console.log(`[bundle-size] manifest: ${result.manifestPath}`);
  console.log(
    `[bundle-size] limits: entry raw ${formatBytes(result.limits.entryBytes)}, entry gzip-9 ${formatBytes(result.limits.entryGzipBytes)}, any chunk raw ${formatBytes(result.limits.chunkBytes)}, any chunk gzip-9 ${formatBytes(result.limits.chunkGzipBytes)}`,
  );
  console.log(
    `[bundle-size] entry: ${result.entry.file} — raw ${formatBytes(result.entry.bytes)}, gzip-9 ${formatBytes(result.entry.gzipBytes)}`,
  );
  console.log(
    `[bundle-size] largest raw: ${result.largestRaw.file} — ${formatBytes(result.largestRaw.bytes)}`,
  );
  console.log(
    `[bundle-size] largest gzip-9: ${result.largestGzip.file} — ${formatBytes(result.largestGzip.gzipBytes)}`,
  );
  console.log(`[bundle-size] measured JavaScript chunks: ${result.chunks.length}`);
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    const result = await inspectBundle(parseArguments(process.argv.slice(2)));
    printResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bundle-size] FAIL: ${message}`);
    process.exitCode = 1;
  }
}
