import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CHANNEL_FILES,
  encodeMetadata,
  selectPreviousRelease,
  publishChannel,
  checkTaggedRelease,
} from './channel-publication.mjs';
import { githubTransport } from './publish-channel.mjs';

const repository = 'owner/repo';
const channel = 'stable';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const url = (version, name) =>
  `https://github.com/${repository}/releases/download/v${version}/${name}`;

function fixture(version, previousVersion = null, selectedChannel = 'stable') {
  const binaries = {
    'app.msi.zip': Buffer.from(`updater ${version}`),
    'app.msi': Buffer.from(`installer ${version}`),
    'app.msi.zip.sig': Buffer.from(`signature ${version}`),
  };
  const artifact = (fileName) => ({
    fileName,
    byteLength: binaries[fileName].length,
    sha256: digest(binaries[fileName]),
    downloadUrl: url(version, fileName),
  });
  const release = {
    schemaVersion: 2,
    channel: selectedChannel,
    version,
    tag: `v${version}`,
    target: 'windows-x86_64',
    publishedAt: '2026-09-01',
    updaterArtifact: { ...artifact('app.msi.zip'), signatureFileName: 'app.msi.zip.sig' },
    installerArtifact: artifact('app.msi'),
  };
  const rollback = {
    schemaVersion: 2,
    channel: selectedChannel,
    currentVersion: version,
    previousVersion,
    previousInstallerUrl: previousVersion ? url(previousVersion, 'app.msi') : null,
    previousReleaseUrl: previousVersion
      ? `https://github.com/${repository}/releases/tag/v${previousVersion}`
      : null,
    backupRequired: true,
  };
  const latest = {
    version,
    notes: 'verified',
    pub_date: '2026-09-01',
    platforms: {
      'windows-x86_64': {
        url: url(version, 'app.msi.zip'),
        signature: binaries['app.msi.zip.sig'].toString(),
      },
    },
  };
  return {
    binaries,
    files: {
      'release.json': encodeMetadata(release),
      'rollback.json': encodeMetadata(rollback),
      'latest.json': encodeMetadata(latest),
    },
  };
}

class FakeGitHub {
  releases = new Map();
  mutations = [];
  failMutation = 0;
  failForever = false;
  corruptRead = false;
  failReads = false;
  constructor(old = fixture('3.9.0'), candidate = fixture('3.10.0', '3.9.0')) {
    this.add('v3.9.0', old);
    this.add('updates-stable', old);
    this.add('v3.10.0', candidate);
  }
  add(tag, data, prerelease = false) {
    const contents = { ...data.binaries, ...data.files };
    this.releases.set(tag, {
      id: this.releases.size + 1,
      tag_name: tag,
      body: 'old notes',
      prerelease,
      draft: false,
      contents,
    });
  }
  metadata(release) {
    if (!release) return null;
    const { contents, ...metadata } = release;
    return {
      ...metadata,
      assets: Object.entries(contents).map(([name, bytes], index) => ({
        id: index + 1,
        name,
        state: 'uploaded',
        size: bytes.length,
        browser_download_url: `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`,
      })),
    };
  }
  async listReleases() {
    if (this.failReads) throw new Error('remote unavailable');
    return [...this.releases.values()].map((release) => this.metadata(release));
  }
  async findRelease(tag) {
    if (this.failReads) throw new Error('remote unavailable');
    return this.metadata(this.releases.get(tag));
  }
  async readAsset(release, name) {
    const bytes = this.releases.get(release.tag_name)?.contents[name];
    if (!bytes) throw new Error(`missing ${name}`);
    if (this.corruptRead && name === 'latest.json') return Buffer.from('{broken');
    return Buffer.from(bytes);
  }
  maybeFail(operation) {
    this.mutations.push(operation);
    if (
      this.failMutation &&
      (this.mutations.length === this.failMutation ||
        (this.failForever && this.mutations.length >= this.failMutation))
    )
      throw new Error('fake transport failure');
  }
  async uploadAsset(tag, name, bytes) {
    // Fail after applying the operation, modeling an ambiguous timeout.
    this.releases.get(tag).contents[name] = Buffer.from(bytes);
    this.maybeFail(`upload:${name}`);
  }
  async editNotes(tag, notes) {
    this.releases.get(tag).body = notes;
    this.maybeFail('notes');
  }
  async createRelease(tag) {
    this.releases.set(tag, { id: 100, tag_name: tag, body: '', prerelease: true, contents: {} });
    this.maybeFail('create');
  }
  async deleteRelease(tag) {
    this.releases.delete(tag);
    this.maybeFail('delete');
  }
}

const input = (data) => ({ files: data.files, channel, repository, target: 'test-sha' });

test('publishes monotonically, checks tagged hashes and commits latest.json last', async () => {
  const candidate = fixture('3.10.0', '3.9.0');
  const transport = new FakeGitHub();
  assert.equal((await publishChannel(transport, input(candidate))).status, 'published');
  assert.deepEqual(transport.mutations, [
    'upload:release.json',
    'upload:rollback.json',
    'upload:latest.json',
    'notes',
  ]);
  for (const name of CHANNEL_FILES)
    assert.deepEqual(
      transport.releases.get('updates-stable').contents[name],
      candidate.files[name],
    );
});

test('older tags cannot replace a newer rolling channel and same-version retries are no-ops', async () => {
  const transport = new FakeGitHub();
  const current = fixture('3.9.0');
  assert.equal((await publishChannel(transport, input(current))).status, 'unchanged');
  assert.deepEqual(transport.mutations, []);
  transport.add('v3.8.0', fixture('3.8.0'));
  await assert.rejects(publishChannel(transport, input(fixture('3.8.0'))), /downgrade/u);
  assert.deepEqual(transport.mutations, []);
});

test('same-version content drift and artifact corruption are blocked before any write', async () => {
  const changed = fixture('3.9.0');
  const latest = JSON.parse(changed.files['latest.json']);
  latest.notes = 'changed content';
  changed.files['latest.json'] = encodeMetadata(latest);
  const transport = new FakeGitHub();
  await assert.rejects(publishChannel(transport, input(changed)), /Same-version/u);
  transport.releases.get('v3.10.0').contents['app.msi'] = Buffer.from('tampered');
  await assert.rejects(
    publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
    /hash or size/u,
  );
  assert.deepEqual(transport.mutations, []);
});

test('same bytes with regenerated timestamps are idempotent without changing old metadata', async () => {
  const data = fixture('3.9.0');
  for (const name of ['release.json', 'latest.json']) {
    const value = JSON.parse(data.files[name]);
    value[name === 'release.json' ? 'publishedAt' : 'pub_date'] = 'later';
    data.files[name] = encodeMetadata(value);
  }
  const transport = new FakeGitHub();
  assert.equal(await checkTaggedRelease(transport, input(data)), true);
  assert.equal((await publishChannel(transport, input(data))).status, 'unchanged');
  assert.deepEqual(transport.mutations, []);
});

for (const failedStep of [1, 2, 3, 4])
  test(`metadata failure at step ${failedStep} restores all files and notes even after ambiguous timeout`, async () => {
    const previous = fixture('3.9.0');
    const transport = new FakeGitHub(previous);
    transport.failMutation = failedStep;
    await assert.rejects(
      publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
      /restored and verified/u,
    );
    for (const name of CHANNEL_FILES)
      assert.deepEqual(
        transport.releases.get('updates-stable').contents[name],
        previous.files[name],
      );
    assert.equal(transport.releases.get('updates-stable').body, 'old notes');
  });

test('a failed compensation is explicitly fatal, never mislabeled as restored', async () => {
  const transport = new FakeGitHub();
  transport.failMutation = 2;
  transport.failForever = true;
  await assert.rejects(
    publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
    /recovery failed.*manual repair/u,
  );
});

test('initial channel partial upload removes the incomplete release without moving tags', async () => {
  const transport = new FakeGitHub();
  transport.releases.delete('updates-stable');
  transport.failMutation = 3;
  await assert.rejects(
    publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
    /restored and verified/u,
  );
  assert.equal(transport.releases.has('updates-stable'), false);
  assert.equal(transport.releases.has('v3.10.0'), true);
});

test('remote read and malformed metadata failures never become first-release permission', async () => {
  for (const property of ['failReads', 'corruptRead']) {
    const transport = new FakeGitHub();
    transport[property] = true;
    await assert.rejects(publishChannel(transport, input(fixture('3.10.0', '3.9.0'))));
    assert.deepEqual(transport.mutations, []);
  }
});

test('ambiguous initial release creation fails explicitly without deleting an unproven remote identity', async () => {
  const transport = new FakeGitHub();
  transport.releases.delete('updates-stable');
  transport.failMutation = 1;
  await assert.rejects(
    publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
    /creation failed or its outcome is unknown/u,
  );
  assert.deepEqual(transport.mutations, ['create']);
});

test('racing remote change is detected by the final read before uploads', async () => {
  const transport = new FakeGitHub();
  const find = transport.findRelease.bind(transport);
  let channelReads = 0;
  transport.findRelease = async (tag) => {
    if (tag === 'updates-stable' && ++channelReads === 2)
      transport.releases.get(tag).body = 'concurrent publisher';
    return find(tag);
  };
  await assert.rejects(
    publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
    /changed during preflight/u,
  );
  assert.deepEqual(transport.mutations, []);
});

test('rollback selection uses current channel and otherwise the highest strictly lower same-channel version', async () => {
  const transport = new FakeGitHub();
  assert.equal(
    (await selectPreviousRelease(transport, { version: '3.10.0', channel, repository }))
      .previousVersion,
    '3.9.0',
  );
  transport.releases.delete('updates-stable');
  transport.add('v4.0.0', fixture('4.0.0'));
  transport.add('v3.8.0', fixture('3.8.0'));
  transport.add('v3.10.0-beta.1', fixture('3.10.0-beta.1', null, 'beta'), true);
  assert.equal(
    (await selectPreviousRelease(transport, { version: '3.10.0', channel, repository }))
      .previousVersion,
    '3.9.0',
  );
  const beta = await selectPreviousRelease(transport, {
    version: '3.10.0-beta.10',
    channel: 'beta',
    repository,
  });
  assert.equal(beta.previousVersion, '3.10.0-beta.1');
});

test('GH adapter lists all pages and propagates authentication or transport failure closed', async () => {
  const calls = [];
  const transport = githubTransport(repository, async (_binary, args) => {
    calls.push(args);
    return { stdout: Buffer.from(JSON.stringify([[{ tag_name: 'v1' }], [{ tag_name: 'v2' }]])) };
  });
  assert.equal((await transport.findRelease('v2')).tag_name, 'v2');
  assert.ok(calls[0].includes('--paginate'));
  const failed = githubTransport(repository, async () => {
    throw new Error('401 contains secret diagnostic');
  });
  await assert.rejects(
    failed.findRelease('missing'),
    (error) => /refusing to infer/u.test(error.message) && !error.message.includes('secret'),
  );
});

test('stale rollback targets, missing retained installers and unpublished artifacts block all writes', async () => {
  const stale = fixture('3.10.0', '3.8.0');
  const staleTransport = new FakeGitHub(fixture('3.9.0'), stale);
  await assert.rejects(publishChannel(staleTransport, input(stale)), /Rollback metadata is stale/u);
  assert.deepEqual(staleTransport.mutations, []);
  const missingInstaller = new FakeGitHub();
  delete missingInstaller.releases.get('v3.9.0').contents['app.msi'];
  await assert.rejects(
    publishChannel(missingInstaller, input(fixture('3.10.0', '3.9.0'))),
    /no longer retained/u,
  );
  assert.deepEqual(missingInstaller.mutations, []);
  const unpublished = new FakeGitHub();
  unpublished.releases.delete('v3.10.0');
  await assert.rejects(
    publishChannel(unpublished, input(fixture('3.10.0', '3.9.0'))),
    /must be published/u,
  );
  assert.deepEqual(unpublished.mutations, []);
});

test('a corrupt final read-back triggers compensation and verifies the complete previous snapshot', async () => {
  const old = fixture('3.9.0');
  const transport = new FakeGitHub(old);
  const originalRead = transport.readAsset.bind(transport);
  let corrupted = false;
  transport.readAsset = async (remote, name) => {
    if (
      !corrupted &&
      transport.mutations.length === 4 &&
      remote.tag_name === 'updates-stable' &&
      name === 'latest.json'
    ) {
      corrupted = true;
      return Buffer.from('{corrupt');
    }
    return originalRead(remote, name);
  };
  await assert.rejects(
    publishChannel(transport, input(fixture('3.10.0', '3.9.0'))),
    /restored and verified/u,
  );
  assert.equal(corrupted, true);
  for (const name of CHANNEL_FILES)
    assert.deepEqual(transport.releases.get('updates-stable').contents[name], old.files[name]);
});

test('missing, duplicate and oversized remote assets fail before download', async () => {
  let downloads = 0;
  const transport = githubTransport(repository, async () => {
    downloads += 1;
    return { stdout: Buffer.from('{}') };
  });
  const good = { id: 1, name: 'latest.json', state: 'uploaded', size: 2 };
  for (const assets of [
    [],
    [good, good],
    [{ ...good, size: 2 * 1024 * 1024 }],
    [{ ...good, state: 'new' }],
  ]) {
    await assert.rejects(
      transport.readAsset({ assets }, 'latest.json'),
      /Missing, ambiguous or oversized/u,
    );
  }
  assert.equal(downloads, 0);
});
