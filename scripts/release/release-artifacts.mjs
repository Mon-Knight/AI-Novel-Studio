import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';

/**
 * Tauri 2 `bundle.createUpdaterArtifacts = "v1Compatible"` keeps the Tauri 1
 * updater archive layout:
 *
 *   bundle/msi/<product>_<version>_x64_en-US.msi
 *   bundle/msi/<product>_<version>_x64_en-US.msi.zip      (+ .sig)
 *   bundle/nsis/<product>_<version>_x64-setup.exe
 *   bundle/nsis/<product>_<version>_x64-setup.nsis.zip    (+ .sig)
 *
 * The `*-updater` directories are only used when Tauri rebuilds an installer
 * for the updater (for example with an offline WebView2 installer); its zip is
 * still written into the regular `msi`/`nsis` directory. Release selection must
 * therefore never recurse, otherwise it can pick a rebuild copy from
 * `msi-updater` or a stale installer from an earlier version.
 */
export const WINDOWS_TARGET = 'windows-x86_64';
export const V1_COMPATIBLE_UPDATER_KINDS = ['msi', 'nsis'];

const WIX_OUTPUT_FOLDER = 'msi';
const NSIS_OUTPUT_FOLDER = 'nsis';
const MAX_SIGNATURE_CHARS = 16_000;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP64_ENTRY_COUNT = 0xffff;
const ZIP64_SIZE = 0xffffffff;

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function windowsArtifactNames({
  productName,
  version,
  arch = 'x64',
  locale = 'en-US',
} = {}) {
  assertNonEmptyString(productName, 'productName');
  assertNonEmptyString(version, 'version');
  assertNonEmptyString(arch, 'arch');
  assertNonEmptyString(locale, 'locale');
  if (/[\\/:*?"<>|]/u.test(productName)) {
    throw new Error(`productName cannot be used as a Windows file name: ${productName}`);
  }
  if (/[\\/:*?"<>|]/u.test(version)) {
    throw new Error(`version cannot be used as a Windows file name: ${version}`);
  }
  return {
    installer: `${productName}_${version}_${arch}_${locale}.msi`,
    updater: `${productName}_${version}_${arch}_${locale}.msi.zip`,
    nsisInstaller: `${productName}_${version}_${arch}-setup.exe`,
    nsisUpdater: `${productName}_${version}_${arch}-setup.nsis.zip`,
  };
}

/**
 * GitHub rewrites spaces to dots in release asset names. Manifests must point
 * at the published spelling, never at the on-disk spelling.
 */
export function publishedAssetName(fileName) {
  const normalized = fileName.replaceAll(' ', '.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalized)) {
    throw new Error(`Release asset name contains unsupported characters: ${fileName}`);
  }
  return normalized;
}

export function assertArtifactVersion(fileName, version, label) {
  if (!fileName.includes(`_${version}_`)) {
    throw new Error(`${label} does not match version ${version}: ${fileName}`);
  }
  return fileName;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function crc32File(file) {
  let checksum = 0;
  for await (const chunk of createReadStream(file)) checksum = crc32(chunk, checksum);
  return checksum >>> 0;
}

async function readExactly(handle, buffer, position, label) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error(`${label} is truncated.`);
    offset += bytesRead;
  }
}

/**
 * Reads the central directory of a ZIP file without extracting it. Tauri writes
 * v1-compatible updater archives with a single stored (uncompressed) installer
 * at the archive root, so only the central directory is required to prove the
 * archive shape and the embedded installer identity.
 */
export async function readStoredZipEntries(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error(`Updater ZIP is too small to be a Tauri archive: ${file}`);

    const tailSize = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailSize);
    await readExactly(handle, tail, size - tailSize, `Updater ZIP tail (${file})`);

    let endOfCentralDirectory = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) !== END_OF_CENTRAL_DIRECTORY) continue;
      if (tail.readUInt16LE(index + 20) !== tail.length - index - 22) continue;
      endOfCentralDirectory = index;
      break;
    }
    if (endOfCentralDirectory < 0) {
      throw new Error(`Updater ZIP has no end-of-central-directory record: ${file}`);
    }

    const diskNumber = tail.readUInt16LE(endOfCentralDirectory + 4);
    const centralDirectoryDisk = tail.readUInt16LE(endOfCentralDirectory + 6);
    const entriesOnDisk = tail.readUInt16LE(endOfCentralDirectory + 8);
    const entryCount = tail.readUInt16LE(endOfCentralDirectory + 10);
    const centralDirectorySize = tail.readUInt32LE(endOfCentralDirectory + 12);
    const centralDirectoryOffset = tail.readUInt32LE(endOfCentralDirectory + 16);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new Error(`Multi-disk updater ZIPs are not supported: ${file}`);
    }
    if (
      entryCount === ZIP64_ENTRY_COUNT ||
      centralDirectorySize === ZIP64_SIZE ||
      centralDirectoryOffset === ZIP64_SIZE
    ) {
      throw new Error(`ZIP64 updater archives are not supported: ${file}`);
    }
    if (entryCount > 10_000) throw new Error(`Updater ZIP has too many entries: ${file}`);

    const eocdAbsoluteOffset = size - tailSize + endOfCentralDirectory;
    if (centralDirectoryOffset + centralDirectorySize > eocdAbsoluteOffset) {
      throw new Error(`Updater ZIP central directory is out of bounds: ${file}`);
    }
    const centralDirectory = Buffer.alloc(centralDirectorySize);
    if (centralDirectorySize > 0) {
      await readExactly(
        handle,
        centralDirectory,
        centralDirectoryOffset,
        `Updater ZIP central directory (${file})`,
      );
    }

    const entries = [];
    let cursor = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > centralDirectory.length) {
        throw new Error(`Updater ZIP central directory is truncated: ${file}`);
      }
      if (centralDirectory.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
        throw new Error(`Updater ZIP has an invalid central directory entry: ${file}`);
      }
      const flags = centralDirectory.readUInt16LE(cursor + 8);
      const method = centralDirectory.readUInt16LE(cursor + 10);
      const checksum = centralDirectory.readUInt32LE(cursor + 16);
      const compressedSize = centralDirectory.readUInt32LE(cursor + 20);
      const uncompressedSize = centralDirectory.readUInt32LE(cursor + 24);
      const nameLength = centralDirectory.readUInt16LE(cursor + 28);
      const extraLength = centralDirectory.readUInt16LE(cursor + 30);
      const commentLength = centralDirectory.readUInt16LE(cursor + 32);
      const localHeaderOffset = centralDirectory.readUInt32LE(cursor + 42);
      const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
      if (nextCursor > centralDirectory.length) {
        throw new Error(`Updater ZIP central directory entry is truncated: ${file}`);
      }
      if (flags & 0x1) throw new Error(`Encrypted updater ZIP entries are not supported: ${file}`);
      if (compressedSize === ZIP64_SIZE || uncompressedSize === ZIP64_SIZE) {
        throw new Error(`ZIP64 updater ZIP entries are not supported: ${file}`);
      }
      entries.push({
        name: centralDirectory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
        flags,
        method,
        crc32: checksum,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      cursor = nextCursor;
    }
    if (cursor !== centralDirectory.length) {
      throw new Error(`Updater ZIP central directory has trailing data: ${file}`);
    }
    return entries;
  } finally {
    await handle.close();
  }
}

export async function assertStoredArchiveContains({
  archivePath,
  installerPath,
  expectedEntryName,
}) {
  const entries = await readStoredZipEntries(archivePath);
  if (entries.length !== 1) {
    throw new Error(
      `v1Compatible updater archive must contain exactly one installer: ${path.basename(archivePath)}`,
    );
  }
  const [entry] = entries;
  if (entry.name !== expectedEntryName || /[/\\]/u.test(entry.name) || entry.name.includes('\0')) {
    throw new Error(
      `v1Compatible updater archive entry ${entry.name} does not match ${expectedEntryName}.`,
    );
  }
  if (entry.method !== 0) {
    throw new Error('v1Compatible updater archive must store the installer without compression.');
  }
  const installer = await stat(installerPath);
  if (!installer.isFile() || installer.size < 1) {
    throw new Error(`Installer is missing or empty: ${installerPath}`);
  }
  if (
    entry.compressedSize !== installer.size ||
    entry.uncompressedSize !== installer.size ||
    entry.crc32 !== (await crc32File(installerPath))
  ) {
    throw new Error(
      `v1Compatible updater archive does not contain the selected installer: ${path.basename(archivePath)}`,
    );
  }
  return entry;
}

async function filesIn(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (cause) {
    throw new Error(`Tauri bundle directory is missing: ${directory}`, { cause });
  }
}

async function selectExactFile(directory, expectedName, label) {
  const matches = (await filesIn(directory)).filter(
    (name) => name.toLowerCase() === expectedName.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new Error(`Expected ${label} was not produced: ${path.join(directory, expectedName)}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous ${label} in ${directory}: ${matches.join(', ')}`);
  }
  const [fileName] = matches;
  if (fileName !== expectedName) {
    throw new Error(`Unexpected ${label} casing: ${fileName}`);
  }
  const file = path.join(directory, fileName);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 1) {
    throw new Error(`${label} is missing or empty: ${file}`);
  }
  return file;
}

async function assertNonEmptyFile(file, label) {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 1) {
    throw new Error(`${label} is missing or empty: ${file}`);
  }
  return file;
}

export async function selectWindowsReleaseArtifacts({
  bundleRoot,
  productName,
  version,
  arch = 'x64',
  locale = 'en-US',
} = {}) {
  assertNonEmptyString(bundleRoot, 'bundleRoot');
  const root = path.resolve(bundleRoot);
  const names = windowsArtifactNames({ productName, version, arch, locale });
  const msiDirectory = path.join(root, WIX_OUTPUT_FOLDER);
  const nsisDirectory = path.join(root, NSIS_OUTPUT_FOLDER);

  const installer = await selectExactFile(msiDirectory, names.installer, 'MSI installer');
  const updater = await selectExactFile(msiDirectory, names.updater, 'v1Compatible MSI updater');
  const updaterSignature = await assertNonEmptyFile(
    `${updater}.sig`,
    'v1Compatible MSI updater signature',
  );
  const nsisInstaller = await selectExactFile(nsisDirectory, names.nsisInstaller, 'NSIS installer');
  const nsisUpdater = await selectExactFile(
    nsisDirectory,
    names.nsisUpdater,
    'v1Compatible NSIS updater',
  );
  const nsisUpdaterSignature = await assertNonEmptyFile(
    `${nsisUpdater}.sig`,
    'v1Compatible NSIS updater signature',
  );
  assertUpdaterSignature(await readFile(updaterSignature, 'utf8'), { version });
  assertUpdaterSignature(await readFile(nsisUpdaterSignature, 'utf8'), { version });

  await assertStoredArchiveContains({
    archivePath: updater,
    installerPath: installer,
    expectedEntryName: names.installer,
  });
  await assertStoredArchiveContains({
    archivePath: nsisUpdater,
    installerPath: nsisInstaller,
    expectedEntryName: names.nsisInstaller,
  });

  const artifact = async (file, expectedEntryName) => ({
    path: file,
    fileName: path.basename(file),
    publishedFileName: publishedAssetName(path.basename(file)),
    expectedEntryName,
    byteLength: (await stat(file)).size,
    sha256: await sha256File(file),
  });

  return {
    target: WINDOWS_TARGET,
    productName,
    version,
    updater: {
      ...(await artifact(updater, names.installer)),
      kind: 'msi',
      signaturePath: updaterSignature,
      signatureFileName: path.basename(updaterSignature),
      signaturePublishedFileName: publishedAssetName(path.basename(updaterSignature)),
    },
    nsisUpdater: {
      ...(await artifact(nsisUpdater, names.nsisInstaller)),
      kind: 'nsis',
      signaturePath: nsisUpdaterSignature,
      signatureFileName: path.basename(nsisUpdaterSignature),
      signaturePublishedFileName: publishedAssetName(path.basename(nsisUpdaterSignature)),
    },
    installer: await artifact(installer, null),
    nsisInstaller: await artifact(nsisInstaller, null),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Tauri 2 CLI writes the base64 contents of a minisign signature box to `.sig`.
 * The pinned updater enables `requireSignedVersion`, and the CLI binds the
 * version into the trusted comment, so a release must fail closed unless the
 * signature carries `version:<manifest version>`.
 */
export function assertUpdaterSignature(value, { version = null } = {}) {
  const signature = typeof value === 'string' ? value.trim() : '';
  if (!signature || signature.length > MAX_SIGNATURE_CHARS || signature.includes('\0')) {
    throw new Error('Updater signature is empty or malformed.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(signature) || signature.length % 4 !== 0) {
    throw new Error('Updater signature must be the base64 contents of the Tauri .sig file.');
  }
  let decoded;
  try {
    decoded = Buffer.from(signature, 'base64').toString('utf8');
  } catch {
    throw new Error('Updater signature must be the base64 contents of the Tauri .sig file.');
  }
  const lines = decoded.split(/\r?\n/u);
  if (!lines[0]?.startsWith('untrusted comment: ')) {
    throw new Error('Updater signature is not a Tauri minisign signature.');
  }
  const trustedComment = lines.find((line) => line.startsWith('trusted comment: '));
  if (!trustedComment) {
    throw new Error('Updater signature is missing its trusted comment.');
  }
  if (version !== null) {
    const versionPattern = new RegExp(`(?:^|\\t)version:${escapeRegExp(version)}(?:\\t|$)`, 'u');
    if (!versionPattern.test(trustedComment)) {
      throw new Error(
        `Updater signature is not bound to version ${version}; re-sign with the Tauri 2 CLI.`,
      );
    }
  }
  return signature;
}
