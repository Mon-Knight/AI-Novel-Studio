import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertArtifactVersion,
  assertStoredArchiveContains,
  assertUpdaterSignature,
  publishedAssetName,
  sha256File,
} from './release-artifacts.mjs';
import { parseVersion, assertChannelVersion, assertRollback } from './release-version.mjs';

const MAX_RELEASE_NOTES_CHARS = 4_000;

function argumentsMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid release argument near ${key ?? '<end>'}.`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

function requireValue(values, key) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function assertVersion(version) {
  parseVersion(version);
}

function assertWorkspacePath(workspace, candidate, label) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(workspace, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the workspace.`);
  }
  return resolved;
}

function assertRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error('GITHUB_REPOSITORY must be an owner/repository pair.');
  }
  return value;
}

function assertHttpsUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS.`);
  return url.toString();
}

function downloadUrl(repository, tag, fileName) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

function sanitizeReleaseNotes(value) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || character === '\n' || character === '\r' || character === '\t';
    })
    .slice(0, MAX_RELEASE_NOTES_CHARS)
    .join('')
    .trim();
}

async function artifactMetadata(file, repository, tag) {
  const metadata = await stat(file);
  const fileName = publishedAssetName(path.basename(file));
  return {
    fileName,
    byteLength: metadata.size,
    sha256: await sha256File(file),
    downloadUrl: downloadUrl(repository, tag, fileName),
  };
}

const values = argumentsMap(process.argv.slice(2));
const version = requireValue(values, 'version');
const channel = requireValue(values, 'channel');
const artifactInput = requireValue(values, 'artifact');
const signatureInput = requireValue(values, 'signature');
const target = values.get('target')?.trim() || 'windows-x86_64';
assertVersion(version);
if (channel !== 'stable' && channel !== 'beta') {
  throw new Error(`Unsupported release channel: ${channel}`);
}
assertChannelVersion(channel, version);
if (!/^windows-(?:x86_64|i686|aarch64)$/u.test(target)) {
  throw new Error(`Unsupported updater target: ${target}`);
}

const repository = assertRepository(
  values.get('repository')?.trim() || process.env.GITHUB_REPOSITORY?.trim() || '',
);
const workspace = path.resolve(process.cwd());
const artifact = assertWorkspacePath(workspace, artifactInput, 'Updater artifact');
const signatureFile = assertWorkspacePath(workspace, signatureInput, 'Updater signature');
const artifactName = path.basename(artifact);
if (!/\.(?:nsis|msi)\.zip$/u.test(artifactName)) {
  throw new Error('Windows updater artifact must end in .nsis.zip or .msi.zip.');
}
// Reject non-publishable or stale artifacts before hashing multi-hundred-MB files.
publishedAssetName(artifactName);
assertArtifactVersion(artifactName, version, 'Updater artifact');
if (path.basename(signatureFile) !== `${artifactName}.sig`) {
  throw new Error('Updater signature file must match the selected updater artifact.');
}

const signature = assertUpdaterSignature(await readFile(signatureFile, 'utf8'), { version });

const installerInput = values.get('installer')?.trim();
if (!installerInput) {
  throw new Error('Missing --installer (the retained MSI/v1 installer for rollback).');
}
const installer = assertWorkspacePath(workspace, installerInput, 'Installer artifact');
const installerName = path.basename(installer);
if (!/\.(?:msi|exe)$/iu.test(installerName)) {
  throw new Error('Installer artifact must end in .msi or .exe.');
}
publishedAssetName(installerName);
assertArtifactVersion(installerName, version, 'Installer artifact');
await assertStoredArchiveContains({
  archivePath: artifact,
  installerPath: installer,
  expectedEntryName: installerName,
});

const tag = `v${version}`;
const publishedAt = new Date().toISOString();
const updaterArtifact = await artifactMetadata(artifact, repository, tag);
const installerArtifact = await artifactMetadata(installer, repository, tag);

const notesInput = values.get('notes-file')?.trim();
let notes = `AI Novel Studio v${version}`;
if (notesInput) {
  const notesFile = assertWorkspacePath(workspace, notesInput, 'Release notes');
  notes = sanitizeReleaseNotes(await readFile(notesFile, 'utf8')) || notes;
}

const previousVersionInput = values.get('previous-version')?.trim();
const previousVersion = previousVersionInput?.replace(/^v/u, '') || null;
if (previousVersion) {
  assertVersion(previousVersion);
  assertChannelVersion(channel, previousVersion);
}
const previousInstallerUrlInput = values.get('previous-installer-url')?.trim();
const previousInstallerUrl = previousInstallerUrlInput
  ? assertHttpsUrl(previousInstallerUrlInput, 'Previous installer URL')
  : null;
assertRollback({ version, channel, previousVersion, previousInstallerUrl, repository });

const outputDirectory = path.join(workspace, 'dist-release', 'channels', channel);
await mkdir(outputDirectory, { recursive: true });

// Tauri 2 "v1Compatible" keeps the Tauri 1 zipped-updater contract, and the v2
// updater plugin (its default `zip` feature) installs those archives directly.
// Keep the single v1 `windows-x86_64` platform entry so existing v1 MSI clients
// keep updating through the same static latest.json URL.
const latest = {
  version,
  notes,
  pub_date: publishedAt,
  platforms: {
    [target]: {
      signature,
      url: updaterArtifact.downloadUrl,
    },
  },
};
const release = {
  schemaVersion: 2,
  channel,
  version,
  tag,
  target,
  publishedAt,
  updaterArtifact: {
    ...updaterArtifact,
    signatureFileName: publishedAssetName(path.basename(signatureFile)),
  },
  installerArtifact,
};
const rollback = {
  schemaVersion: 2,
  channel,
  currentVersion: version,
  previousVersion,
  previousInstallerUrl,
  previousReleaseUrl: previousVersion
    ? `https://github.com/${repository}/releases/tag/v${previousVersion}`
    : null,
  backupRequired: true,
  instructions: previousVersion
    ? [
        'Export a complete project backup before opening a different application version.',
        'Exit the application, then install the retained previous-channel installer.',
        'If the newer version changed persisted data, restore the backup created before that version was opened.',
      ]
    : ['Retain this installer so the next release can publish an explicit rollback target.'],
};

await Promise.all([
  writeFile(
    path.join(outputDirectory, 'latest.json'),
    `${JSON.stringify(latest, null, 2)}\n`,
    'utf8',
  ),
  writeFile(
    path.join(outputDirectory, 'release.json'),
    `${JSON.stringify(release, null, 2)}\n`,
    'utf8',
  ),
  writeFile(
    path.join(outputDirectory, 'rollback.json'),
    `${JSON.stringify(rollback, null, 2)}\n`,
    'utf8',
  ),
]);

process.stdout.write(`${outputDirectory}\n`);
