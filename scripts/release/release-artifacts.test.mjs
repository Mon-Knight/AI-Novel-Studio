import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertUpdaterSignature,
  publishedAssetName,
  readStoredZipEntries,
  selectWindowsReleaseArtifacts,
  windowsArtifactNames,
} from './release-artifacts.mjs';
import { selectReleaseArtifactsFromConfig } from './select-release-artifacts.mjs';
import {
  createReleaseFixture,
  minisignSignature,
  storedZipBytes,
  writeTauriConfig,
} from './release-fixtures.mjs';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'select-release-artifacts.mjs',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'ai-novel-studio-artifacts-'));
  const files = await createReleaseFixture({ workspace, ...options });
  return { workspace, ...files };
}

test('selects the canonical Tauri 2 v1Compatible artifacts and ignores rebuild/stale copies', async () => {
  const files = await fixture({ addUpdaterRebuildCopy: true, addStaleArtifacts: true });
  try {
    const selection = await selectReleaseArtifactsFromConfig({
      bundleRoot: files.bundleRoot,
      configPath: files.config,
      expectedVersion: '3.7.0',
    });
    assert.equal(selection.target, 'windows-x86_64');
    assert.equal(selection.updater.kind, 'msi');
    assert.equal(selection.updater.path, files.paths.updater);
    assert.equal(selection.updater.fileName, files.names.updater);
    assert.equal(selection.updater.publishedFileName, 'AI.Novel.Studio_3.7.0_x64_en-US.msi.zip');
    assert.equal(selection.updater.signaturePath, `${files.paths.updater}.sig`);
    assert.equal(selection.updater.expectedEntryName, files.names.installer);
    assert.equal(selection.updater.byteLength, (await stat(files.paths.updater)).size);
    assert.equal(selection.updater.sha256, digest(await readFile(files.paths.updater)));
    assert.equal(selection.installer.path, files.paths.installer);
    assert.equal(selection.installer.sha256, digest(files.bytes.installer));
    assert.equal(selection.nsisInstaller.path, files.paths.nsisInstaller);
    assert.equal(selection.nsisUpdater.fileName, files.names.nsisUpdater);
    assert.equal(selection.nsisUpdater.kind, 'nsis');
    assert.equal(selection.nsisUpdater.sha256, digest(await readFile(files.paths.nsisUpdater)));

    const entries = await readStoredZipEntries(files.paths.updater);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [files.names.installer],
    );
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('derives exact v2 artifact names and GitHub-published spellings', () => {
  assert.deepEqual(windowsArtifactNames({ productName: 'AI Novel Studio', version: '3.7.0' }), {
    installer: 'AI Novel Studio_3.7.0_x64_en-US.msi',
    updater: 'AI Novel Studio_3.7.0_x64_en-US.msi.zip',
    nsisInstaller: 'AI Novel Studio_3.7.0_x64-setup.exe',
    nsisUpdater: 'AI Novel Studio_3.7.0_x64-setup.nsis.zip',
  });
  assert.equal(
    publishedAssetName('AI Novel Studio_3.7.0_x64_en-US.msi.zip'),
    'AI.Novel.Studio_3.7.0_x64_en-US.msi.zip',
  );
  assert.throws(
    () => publishedAssetName('AI Novel Studio#3.7.0_x64-setup.nsis.zip'),
    /unsupported characters/u,
  );
});

test('fails closed when v1Compatible, versions, artifacts or signatures do not match', async () => {
  const files = await fixture();
  try {
    await assert.rejects(
      selectReleaseArtifactsFromConfig({
        bundleRoot: files.bundleRoot,
        configPath: files.config,
        expectedVersion: '3.7.1',
      }),
      /does not match release version/u,
    );
    const disabledConfig = await writeTauriConfig({
      workspace: files.workspace,
      createUpdaterArtifacts: false,
    });
    await assert.rejects(
      selectReleaseArtifactsFromConfig({
        bundleRoot: files.bundleRoot,
        configPath: disabledConfig,
      }),
      /createUpdaterArtifacts = "v1Compatible"/u,
    );

    const wrongBundle = await mkdtemp(path.join(tmpdir(), 'ai-novel-studio-artifacts-'));
    const wrongFiles = await createReleaseFixture({ workspace: wrongBundle, version: '3.7.1' });
    await assert.rejects(
      selectWindowsReleaseArtifacts({
        bundleRoot: wrongFiles.bundleRoot,
        productName: 'AI Novel Studio',
        version: '3.7.0',
      }),
      /was not produced/u,
    );
    await rm(wrongBundle, { recursive: true, force: true });

    const signaturePath = `${files.paths.updater}.sig`;
    await rm(signaturePath);
    await assert.rejects(
      selectWindowsReleaseArtifacts({
        bundleRoot: files.bundleRoot,
        productName: 'AI Novel Studio',
        version: '3.7.0',
      }),
      /signature is missing or empty|ENOENT/u,
    );
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});

test('rejects archives that are not a single stored copy of the selected installer', async () => {
  for (const [label, entries, message] of [
    [
      'wrong installer',
      [{ name: 'AI Novel Studio_3.6.2_x64_en-US.msi', data: 'stale' }],
      /does not match/u,
    ],
    [
      'compressed entry',
      [
        {
          name: 'AI Novel Studio_3.7.0_x64_en-US.msi',
          data: 'installer 3.7.0',
          method: 8,
        },
      ],
      /without compression/u,
    ],
    [
      'multiple entries',
      [
        { name: 'AI Novel Studio_3.7.0_x64_en-US.msi', data: 'installer 3.7.0' },
        { name: 'extra.txt', data: 'extra' },
      ],
      /exactly one installer/u,
    ],
    [
      'different installer bytes',
      [{ name: 'AI Novel Studio_3.7.0_x64_en-US.msi', data: 'other bytes' }],
      /does not contain the selected installer/u,
    ],
  ]) {
    const files = await fixture();
    try {
      await writeFile(files.paths.updater, storedZipBytes(entries));
      await assert.rejects(
        selectWindowsReleaseArtifacts({
          bundleRoot: files.bundleRoot,
          productName: 'AI Novel Studio',
          version: '3.7.0',
        }),
        message,
        label,
      );
    } finally {
      await rm(files.workspace, { recursive: true, force: true });
    }
  }
});

test('validates the Tauri 2 base64 minisign signature and its signed version', () => {
  const versioned = minisignSignature({ version: '3.7.0', fileName: 'app.msi.zip' });
  assert.equal(assertUpdaterSignature(`${versioned}\n`, { version: '3.7.0' }), versioned);
  assert.doesNotThrow(() => assertUpdaterSignature(versioned));

  for (const [signature, message] of [
    ['untrusted comment: signature\nRWQfixture', /base64/u],
    [Buffer.from('not a signature', 'utf8').toString('base64'), /minisign/u],
    [minisignSignature({ version: '3.6.2' }), /not bound to version 3.7.0/u],
    [minisignSignature({ version: null }), /not bound to version 3.7.0/u],
  ]) {
    assert.throws(() => assertUpdaterSignature(signature, { version: '3.7.0' }), message);
  }
});

test('CLI prints selected paths for the release workflow and fails closed on config drift', async () => {
  const files = await fixture();
  try {
    const run = (args) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: files.workspace,
        encoding: 'utf8',
      });
    const result = run([
      '--bundle-root',
      files.bundleRoot,
      '--config',
      files.config,
      '--version',
      '3.7.0',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const selection = JSON.parse(result.stdout);
    assert.equal(selection.updater.path, files.paths.updater);
    assert.equal(selection.installer.path, files.paths.installer);

    const mismatch = run([
      '--bundle-root',
      files.bundleRoot,
      '--config',
      files.config,
      '--version',
      '3.7.1',
    ]);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /does not match release version/u);

    const disabled = await writeTauriConfig({
      workspace: files.workspace,
      createUpdaterArtifacts: false,
    });
    const disabledResult = run(['--bundle-root', files.bundleRoot, '--config', disabled]);
    assert.notEqual(disabledResult.status, 0);
    assert.match(disabledResult.stderr, /createUpdaterArtifacts = "v1Compatible"/u);
  } finally {
    await rm(files.workspace, { recursive: true, force: true });
  }
});
