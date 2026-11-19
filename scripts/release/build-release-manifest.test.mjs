import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createReleaseFixture, minisignSignature, storedZipBytes } from './release-fixtures.mjs';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'build-release-manifest.mjs',
);
const repository = 'Mon-Knight/AI-Novel-Studio';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'ai-novel-studio-release-'));
  const files = await createReleaseFixture({ workspace, ...options });
  const notes = path.join(workspace, 'release-notes.md');
  await writeFile(notes, 'Release notes\0\n- Verified update.');
  return { workspace, notes, ...files };
}

function buildManifest(
  files,
  {
    version = '3.7.0',
    channel = 'stable',
    artifact = files.paths.updater,
    signature = `${files.paths.updater}.sig`,
    installer = files.paths.installer,
    extraArgs = [],
  } = {},
) {
  const args = [
    script,
    '--version',
    version,
    '--channel',
    channel,
    '--artifact',
    artifact,
    '--signature',
    signature,
    '--installer',
    installer,
    '--notes-file',
    files.notes,
    ...extraArgs,
  ];
  return spawnSync(process.execPath, args, {
    cwd: files.workspace,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: repository },
  });
}

async function readChannelOutput(files, channel = 'stable') {
  const output = path.join(files.workspace, 'dist-release', 'channels', channel);
  return {
    output,
    latest: JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8')),
    release: JSON.parse(await readFile(path.join(output, 'release.json'), 'utf8')),
    rollback: JSON.parse(await readFile(path.join(output, 'rollback.json'), 'utf8')),
  };
}

test('builds a Tauri 2 v1Compatible static updater index and rollback metadata', async () => {
  const files = await fixture();
  try {
    const result = buildManifest(files, {
      extraArgs: [
        '--previous-version',
        '3.6.2',
        '--previous-installer-url',
        'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.6.2/AI.Novel.Studio_3.6.2_x64_en-US.msi',
      ],
    });
    assert.equal(result.status, 0, result.stderr);

    const { latest, release, rollback } = await readChannelOutput(files);
    assert.deepEqual(Object.keys(latest), ['version', 'notes', 'pub_date', 'platforms']);
    assert.equal(latest.version, '3.7.0');
    assert.deepEqual(Object.keys(latest.platforms), ['windows-x86_64']);
    assert.deepEqual(Object.keys(latest.platforms['windows-x86_64']), ['signature', 'url']);
    assert.equal(
      latest.platforms['windows-x86_64'].url,
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.7.0/AI.Novel.Studio_3.7.0_x64_en-US.msi.zip',
    );
    assert.equal(
      latest.platforms['windows-x86_64'].signature,
      (await readFile(`${files.paths.updater}.sig`, 'utf8')).trim(),
    );
    assert.doesNotMatch(latest.notes, /\0/u);

    assert.equal(release.schemaVersion, 2);
    assert.equal(release.updaterArtifact.fileName, 'AI.Novel.Studio_3.7.0_x64_en-US.msi.zip');
    assert.equal(
      release.updaterArtifact.signatureFileName,
      'AI.Novel.Studio_3.7.0_x64_en-US.msi.zip.sig',
    );
    assert.equal(release.updaterArtifact.sha256, digest(await readFile(files.paths.updater)));
    assert.equal(release.updaterArtifact.byteLength, (await stat(files.paths.updater)).size);
    assert.equal(release.installerArtifact.fileName, 'AI.Novel.Studio_3.7.0_x64_en-US.msi');
    assert.equal(release.installerArtifact.sha256, digest(files.bytes.installer));
    assert.equal(release.installerArtifact.byteLength, (await stat(files.paths.installer)).size);
    assert.equal(rollback.previousVersion, '3.6.2');
    assert.equal(
      rollback.previousInstallerUrl,
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.6.2/AI.Novel.Studio_3.6.2_x64_en-US.msi',
    );
    assert.equal(
      rollback.previousReleaseUrl,
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/tag/v3.6.2',
    );
    assert.equal(rollback.backupRequired, true);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('accepts a v1Compatible NSIS updater archive with its setup installer', async () => {
  const files = await fixture();
  try {
    const result = buildManifest(files, {
      artifact: files.paths.nsisUpdater,
      signature: `${files.paths.nsisUpdater}.sig`,
      installer: files.paths.nsisInstaller,
    });
    assert.equal(result.status, 0, result.stderr);
    const { latest, release } = await readChannelOutput(files);
    assert.equal(
      latest.platforms['windows-x86_64'].url,
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.7.0/AI.Novel.Studio_3.7.0_x64-setup.nsis.zip',
    );
    assert.equal(release.updaterArtifact.fileName, 'AI.Novel.Studio_3.7.0_x64-setup.nsis.zip');
    assert.equal(release.installerArtifact.fileName, 'AI.Novel.Studio_3.7.0_x64-setup.exe');
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('keeps stable and beta channel outputs isolated', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'ai-novel-studio-release-'));
  try {
    const notes = path.join(workspace, 'release-notes.md');
    await writeFile(notes, 'Release notes');
    const stable = {
      workspace,
      notes,
      ...(await createReleaseFixture({ workspace, version: '3.7.0' })),
    };
    const beta = {
      workspace,
      notes,
      ...(await createReleaseFixture({ workspace, version: '3.7.0-beta.2' })),
    };

    const stableResult = buildManifest(stable);
    assert.equal(stableResult.status, 0, stableResult.stderr);
    const stableBefore = await readFile(
      path.join(workspace, 'dist-release', 'channels', 'stable', 'latest.json'),
      'utf8',
    );

    const betaResult = buildManifest(beta, {
      version: '3.7.0-beta.2',
      channel: 'beta',
      extraArgs: [
        '--previous-version',
        '3.7.0-beta.1',
        '--previous-installer-url',
        'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.7.0-beta.1/AI.Novel.Studio_3.7.0-beta.1_x64_en-US.msi',
      ],
    });
    assert.equal(betaResult.status, 0, betaResult.stderr);

    const stableAfter = await readFile(
      path.join(workspace, 'dist-release', 'channels', 'stable', 'latest.json'),
      'utf8',
    );
    assert.equal(stableAfter, stableBefore);
    const stableOutput = await readChannelOutput(stable, 'stable');
    assert.equal(stableOutput.latest.version, '3.7.0');
    const betaOutput = await readChannelOutput(beta, 'beta');
    assert.equal(betaOutput.latest.version, '3.7.0-beta.2');
    assert.equal(betaOutput.release.channel, 'beta');
    assert.equal(betaOutput.rollback.previousVersion, '3.7.0-beta.1');
    assert.notEqual(stableOutput.output, betaOutput.output);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('rejects stale artifact versions and signatures not bound to the release version', async () => {
  const stale = await fixture({ version: '3.7.1' });
  try {
    const result = buildManifest(stale);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match version 3\.7\.0/u);
  } finally {
    await rm(stale.workspace, { recursive: true, force: true });
  }

  const unversioned = await fixture();
  try {
    await writeFile(
      `${unversioned.paths.updater}.sig`,
      minisignSignature({ version: null, fileName: unversioned.names.updater }),
      'utf8',
    );
    const result = buildManifest(unversioned);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not bound to version 3\.7\.0/u);
  } finally {
    await rm(unversioned.workspace, { recursive: true, force: true });
  }
});

test('rejects updater archives that do not contain the selected installer', async () => {
  const files = await fixture();
  try {
    await writeFile(
      files.paths.updater,
      storedZipBytes([
        { name: files.names.installer, data: Buffer.from('different installer bytes') },
      ]),
    );
    const result = buildManifest(files);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not contain the selected installer/u);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('rejects a stable version on the beta channel', async () => {
  const files = await fixture();
  try {
    const result = buildManifest(files, { channel: 'beta' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not belong to the beta channel/u);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('rejects release asset names GitHub cannot publish verbatim', async () => {
  const files = await fixture({ productName: 'AI Novel Studio#3.7.0' });
  try {
    const result = buildManifest(files, { version: '3.7.0' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release asset name contains unsupported characters/iu);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});
