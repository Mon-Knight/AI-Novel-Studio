import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'build-release-manifest.mjs',
);

async function fixture(baseName = 'AI Novel Studio_3.1.0_x64-setup') {
  const workspace = await mkdtemp(path.join(tmpdir(), 'ai-novel-studio-release-'));
  const bundleDirectory = path.join(workspace, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  await mkdir(bundleDirectory, { recursive: true });
  const updater = path.join(bundleDirectory, `${baseName}.nsis.zip`);
  const signature = `${updater}.sig`;
  const installer = path.join(bundleDirectory, `${baseName}.exe`);
  const notes = path.join(workspace, 'release-notes.md');
  await writeFile(updater, 'signed updater bytes');
  await writeFile(signature, 'untrusted comment: signature\nRWQfixture-signature');
  await writeFile(installer, 'installer bytes');
  await writeFile(notes, 'Release notes\0\n- Verified update.');
  return { workspace, updater, signature, installer, notes };
}

test('builds a Tauri v1 static updater index and rollback metadata', async () => {
  const files = await fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--version',
        '3.1.0',
        '--channel',
        'stable',
        '--artifact',
        files.updater,
        '--signature',
        files.signature,
        '--installer',
        files.installer,
        '--notes-file',
        files.notes,
        '--previous-version',
        '3.0.0',
        '--previous-installer-url',
        'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.0.0/app.exe',
      ],
      {
        cwd: files.workspace,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REPOSITORY: 'Mon-Knight/AI-Novel-Studio' },
      },
    );
    assert.equal(result.status, 0, result.stderr);

    const output = path.join(files.workspace, 'dist-release', 'channels', 'stable');
    const latest = JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8'));
    const release = JSON.parse(await readFile(path.join(output, 'release.json'), 'utf8'));
    const rollback = JSON.parse(await readFile(path.join(output, 'rollback.json'), 'utf8'));
    assert.equal(latest.version, '3.1.0');
    assert.equal(
      latest.platforms['windows-x86_64'].url,
      'https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/v3.1.0/AI.Novel.Studio_3.1.0_x64-setup.nsis.zip',
    );
    assert.match(latest.platforms['windows-x86_64'].signature, /RWQfixture-signature/u);
    assert.doesNotMatch(latest.notes, /\0/u);
    assert.equal(release.schemaVersion, 2);
    assert.equal(release.updaterArtifact.fileName, 'AI.Novel.Studio_3.1.0_x64-setup.nsis.zip');
    assert.equal(
      release.updaterArtifact.signatureFileName,
      'AI.Novel.Studio_3.1.0_x64-setup.nsis.zip.sig',
    );
    assert.equal(release.installerArtifact.fileName, 'AI.Novel.Studio_3.1.0_x64-setup.exe');
    assert.equal(rollback.previousVersion, '3.0.0');
    assert.equal(rollback.backupRequired, true);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('rejects a stable version on the beta channel', async () => {
  const files = await fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--version',
        '3.1.0',
        '--channel',
        'beta',
        '--artifact',
        files.updater,
        '--signature',
        files.signature,
      ],
      {
        cwd: files.workspace,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REPOSITORY: 'Mon-Knight/AI-Novel-Studio' },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not belong to the beta channel/u);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('rejects release asset names GitHub cannot publish verbatim', async () => {
  const files = await fixture('AI Novel Studio#3.1.0_x64-setup');
  try {
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--version',
        '3.1.0',
        '--channel',
        'stable',
        '--artifact',
        files.updater,
        '--signature',
        files.signature,
      ],
      {
        cwd: files.workspace,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REPOSITORY: 'Mon-Knight/AI-Novel-Studio' },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release asset name contains unsupported characters/iu);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});
