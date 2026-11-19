import { crc32 } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Minimal stored-entry ZIP writer used by the release fixtures. Tauri's
 * v1Compatible updater archives are uncompressed single-entry ZIPs, so this is
 * enough to exercise the real archive validation path without a dependency.
 */
export function storedZipBytes(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('A ZIP fixture needs at least one entry.');
  }
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const method = entry.method ?? 0;
    const checksum = entry.crc32 ?? crc32(data);
    const compressedSize = entry.compressedSize ?? data.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Format-compatible fixture; this is not a cryptographically valid minisign signature. */
export function minisignSignature({ version = null, fileName = 'app.msi.zip', extra = '' } = {}) {
  const trusted = `trusted comment: timestamp:1700000000\tfile:${fileName}${
    version ? `\tversion:${version}` : ''
  }${extra}`;
  const envelope = [
    'untrusted comment: signature from tauri secret key',
    'RWQfixtureSignatureLine',
    trusted,
    'Zml4dHVyZS1zaWduYXR1cmU=',
  ].join('\n');
  return Buffer.from(`${envelope}\n`, 'utf8').toString('base64');
}

export async function writeTauriConfig({
  workspace,
  productName = 'AI Novel Studio',
  version = '3.7.0',
  createUpdaterArtifacts = 'v1Compatible',
  targets = 'all',
  active = true,
} = {}) {
  const directory = path.join(workspace, 'src-tauri');
  await mkdir(directory, { recursive: true });
  const configPath = path.join(directory, 'tauri.conf.json');
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        productName,
        version,
        bundle: { active, targets, createUpdaterArtifacts },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return configPath;
}

export function windowsFixtureNames({
  productName = 'AI Novel Studio',
  version = '3.7.0',
  arch = 'x64',
  locale = 'en-US',
} = {}) {
  return {
    installer: `${productName}_${version}_${arch}_${locale}.msi`,
    updater: `${productName}_${version}_${arch}_${locale}.msi.zip`,
    nsisInstaller: `${productName}_${version}_${arch}-setup.exe`,
    nsisUpdater: `${productName}_${version}_${arch}-setup.nsis.zip`,
  };
}

export async function createReleaseFixture({
  workspace,
  productName = 'AI Novel Studio',
  version = '3.7.0',
  arch = 'x64',
  locale = 'en-US',
  installerBytes = Buffer.from(`installer ${version}`),
  nsisBytes = Buffer.from(`setup ${version}`),
  addUpdaterRebuildCopy = false,
  addStaleArtifacts = false,
} = {}) {
  const names = windowsFixtureNames({ productName, version, arch, locale });
  const bundleRoot = path.join(workspace, 'src-tauri', 'target', 'release', 'bundle');
  const msiDirectory = path.join(bundleRoot, 'msi');
  const nsisDirectory = path.join(bundleRoot, 'nsis');
  await mkdir(msiDirectory, { recursive: true });
  await mkdir(nsisDirectory, { recursive: true });

  const installer = path.join(msiDirectory, names.installer);
  const updater = path.join(msiDirectory, names.updater);
  const nsisInstaller = path.join(nsisDirectory, names.nsisInstaller);
  const nsisUpdater = path.join(nsisDirectory, names.nsisUpdater);
  await writeFile(installer, installerBytes);
  await writeFile(updater, storedZipBytes([{ name: names.installer, data: installerBytes }]));
  await writeFile(
    `${updater}.sig`,
    minisignSignature({ version, fileName: names.updater }),
    'utf8',
  );
  await writeFile(nsisInstaller, nsisBytes);
  await writeFile(nsisUpdater, storedZipBytes([{ name: names.nsisInstaller, data: nsisBytes }]));
  await writeFile(
    `${nsisUpdater}.sig`,
    minisignSignature({ version, fileName: names.nsisUpdater }),
    'utf8',
  );

  if (addUpdaterRebuildCopy) {
    const rebuildDirectory = path.join(bundleRoot, 'msi-updater');
    await mkdir(rebuildDirectory, { recursive: true });
    await writeFile(path.join(rebuildDirectory, names.installer), Buffer.from('rebuild copy'));
  }
  if (addStaleArtifacts) {
    await writeFile(path.join(msiDirectory, 'AI Novel Studio_3.6.2_x64_en-US.msi'), 'stale msi');
    await writeFile(
      path.join(msiDirectory, 'AI Novel Studio_3.6.2_x64_en-US.msi.zip'),
      storedZipBytes([{ name: 'AI Novel Studio_3.6.2_x64_en-US.msi', data: 'stale' }]),
    );
  }

  return {
    bundleRoot,
    names,
    config: await writeTauriConfig({ workspace, productName, version }),
    paths: { installer, updater, nsisInstaller, nsisUpdater },
    bytes: { installer: installerBytes, nsis: nsisBytes },
  };
}
