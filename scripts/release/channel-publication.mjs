import { createHash } from 'node:crypto';
import { assertChannelVersion, assertRollback, compareVersions } from './release-version.mjs';

export const CHANNEL_FILES = ['release.json', 'rollback.json', 'latest.json'];
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const decode = (bytes) =>
  JSON.parse(
    Buffer.from(bytes)
      .toString('utf8')
      .replace(/^\uFEFF/u, ''),
  );
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => !['publishedAt', 'pub_date'].includes(key))
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function sameMetadata(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function validateChannelFiles(files, channel, repository) {
  const latest = decode(files['latest.json']);
  const release = decode(files['release.json']);
  const rollback = decode(files['rollback.json']);
  assertChannelVersion(channel, latest.version);
  if (
    release.schemaVersion !== 2 ||
    rollback.schemaVersion !== 2 ||
    release.channel !== channel ||
    rollback.channel !== channel ||
    release.version !== latest.version ||
    rollback.currentVersion !== latest.version ||
    release.tag !== `v${latest.version}` ||
    rollback.backupRequired !== true ||
    !release.updaterArtifact ||
    !release.installerArtifact
  )
    throw new Error('Channel metadata is incomplete or inconsistent.');
  const platform = latest.platforms?.[release.target];
  if (
    !platform ||
    platform.url !== release.updaterArtifact.downloadUrl ||
    !platform.signature?.trim()
  ) {
    throw new Error('Updater pointer and release manifest disagree.');
  }
  for (const artifact of [release.updaterArtifact, release.installerArtifact]) {
    if (
      !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength < 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(artifact.fileName) ||
      artifact.downloadUrl !==
        `https://github.com/${repository}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(artifact.fileName)}`
    ) {
      throw new Error('Release artifact identity is malformed.');
    }
  }
  if (release.updaterArtifact.signatureFileName !== `${release.updaterArtifact.fileName}.sig`) {
    throw new Error('Updater signature identity is malformed.');
  }
  assertRollback({
    version: latest.version,
    channel,
    repository,
    previousVersion: rollback.previousVersion,
    previousInstallerUrl: rollback.previousInstallerUrl,
  });
  const previousReleaseUrl = rollback.previousVersion
    ? `https://github.com/${repository}/releases/tag/v${rollback.previousVersion}`
    : null;
  if (rollback.previousReleaseUrl !== previousReleaseUrl)
    throw new Error('Rollback release link disagrees with its version.');
  return { latest, release, rollback };
}

export async function readChannel(transport, channel, repository) {
  const remote = await transport.findRelease(`updates-${channel}`);
  if (!remote) return null;
  const files = {};
  for (const name of CHANNEL_FILES) files[name] = await transport.readAsset(remote, name);
  return { remote, files, ...validateChannelFiles(files, channel, repository) };
}

function assertNotOlder(version, current) {
  if (current && compareVersions(version, current.latest.version) < 0) {
    throw new Error(`Refusing channel downgrade from ${current.latest.version} to ${version}.`);
  }
  if (
    current &&
    compareVersions(version, current.latest.version) === 0 &&
    version !== current.latest.version
  ) {
    throw new Error(
      'Equal-precedence versions with different build identities cannot replace the channel.',
    );
  }
}

export async function selectPreviousRelease(transport, { version, channel, repository }) {
  assertChannelVersion(channel, version);
  const current = await readChannel(transport, channel, repository);
  assertNotOlder(version, current);
  if (current) {
    if (version === current.latest.version)
      return {
        previousVersion: current.rollback.previousVersion,
        previousInstallerUrl: current.rollback.previousInstallerUrl,
      };
    return {
      previousVersion: current.release.version,
      previousInstallerUrl: current.release.installerArtifact.downloadUrl,
    };
  }
  const previous = (await transport.listReleases())
    .filter((release) => {
      if (
        release.draft ||
        !release.tag_name?.startsWith('v') ||
        Boolean(release.prerelease) !== (channel === 'beta')
      )
        return false;
      const candidate = release.tag_name.slice(1);
      try {
        assertChannelVersion(channel, candidate);
      } catch {
        return false;
      }
      return compareVersions(candidate, version) < 0;
    })
    .sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  if (!previous) return { previousVersion: null, previousInstallerUrl: null };
  const installers = previous.assets
    .filter(({ name, state }) => /\.(?:msi|exe)$/iu.test(name) && state === 'uploaded')
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!installers.length) throw new Error('Previous release has no retained installer.');
  const result = {
    previousVersion: previous.tag_name.slice(1),
    previousInstallerUrl: installers[0].browser_download_url,
  };
  assertRollback({ version, channel, repository, ...result });
  return result;
}

export async function verifyTaggedArtifacts(transport, remote, candidate) {
  if (
    remote.draft ||
    remote.tag_name !== candidate.release.tag ||
    Boolean(remote.prerelease) !== (candidate.release.channel === 'beta')
  )
    throw new Error('Tagged release identity or channel mismatch.');
  for (const [name, value] of [
    ['release.json', candidate.release],
    ['rollback.json', candidate.rollback],
  ]) {
    if (!sameMetadata(decode(await transport.readAsset(remote, name)), value))
      throw new Error('Existing tagged release content differs; published versions are immutable.');
  }
  for (const artifact of [candidate.release.updaterArtifact, candidate.release.installerArtifact]) {
    const bytes = await transport.readAsset(remote, artifact.fileName, 512 * 1024 * 1024);
    if (bytes.length !== artifact.byteLength || sha256(bytes) !== artifact.sha256)
      throw new Error('Published artifact hash or size differs from the signed release manifest.');
  }
  const signature = Buffer.from(
    await transport.readAsset(remote, candidate.release.updaterArtifact.signatureFileName),
  )
    .toString('utf8')
    .trim();
  if (signature !== candidate.latest.platforms[candidate.release.target].signature)
    throw new Error('Published updater signature differs from the channel pointer.');
}

export async function checkTaggedRelease(transport, { files, channel, repository }) {
  const candidate = validateChannelFiles(files, channel, repository);
  assertNotOlder(candidate.latest.version, await readChannel(transport, channel, repository));
  const remote = await transport.findRelease(candidate.release.tag);
  if (!remote) return false;
  await verifyTaggedArtifacts(transport, remote, candidate);
  return true;
}

function sameSnapshot(left, right) {
  if (!left || !right) return left === right;
  return (
    left.remote.id === right.remote.id &&
    left.remote.body === right.remote.body &&
    CHANNEL_FILES.every((name) =>
      Buffer.from(left.files[name]).equals(Buffer.from(right.files[name])),
    )
  );
}

function pointerNotes(channel, rollback) {
  const base = `Rolling signed update metadata for the ${channel} channel.`;
  return rollback.previousVersion
    ? `${base}\n\nRollback target: v${rollback.previousVersion}\n\n[Download the retained previous installer](${rollback.previousInstallerUrl})`
    : `${base}\n\nNo previous installer is available for this channel yet.`;
}

export async function publishChannel(transport, { files, channel, repository, target }) {
  const candidate = validateChannelFiles(files, channel, repository);
  const initial = await readChannel(transport, channel, repository);
  assertNotOlder(candidate.latest.version, initial);
  const tagged = await transport.findRelease(candidate.release.tag);
  if (!tagged)
    throw new Error('Tagged artifacts must be published and verified before the rolling pointer.');
  await verifyTaggedArtifacts(transport, tagged, candidate);
  // Re-read immediately before the first write; workflow concurrency alone does not order versions.
  const previous = await readChannel(transport, channel, repository);
  if (!sameSnapshot(initial, previous))
    throw new Error('Channel changed during preflight; refusing a stale publication.');
  assertNotOlder(candidate.latest.version, previous);
  if (previous && candidate.latest.version === previous.latest.version) {
    if (
      !CHANNEL_FILES.every((name) =>
        sameMetadata(decode(previous.files[name]), decode(files[name])),
      )
    ) {
      throw new Error('Same-version channel content differs; refusing overwrite.');
    }
    return { status: 'unchanged', version: candidate.latest.version };
  }
  if (
    previous &&
    (candidate.rollback.previousVersion !== previous.release.version ||
      candidate.rollback.previousInstallerUrl !== previous.release.installerArtifact.downloadUrl)
  ) {
    throw new Error('Rollback metadata is stale relative to the channel being replaced.');
  }
  if (candidate.rollback.previousVersion) {
    const retained = await transport.findRelease(`v${candidate.rollback.previousVersion}`);
    if (
      !retained ||
      !retained.assets.some(
        (asset) =>
          asset.state === 'uploaded' &&
          asset.browser_download_url === candidate.rollback.previousInstallerUrl,
      )
    )
      throw new Error('Rollback installer is no longer retained.');
  }
  if (!sameSnapshot(previous, await readChannel(transport, channel, repository))) {
    throw new Error('Channel changed before upload; refusing a stale publication.');
  }
  const tag = `updates-${channel}`;
  let created = false;
  let writesStarted = false;
  try {
    if (!previous) {
      try {
        await transport.createRelease(tag, target, pointerNotes(channel, candidate.rollback));
      } catch (cause) {
        throw new Error(
          'Initial channel creation failed or its outcome is unknown; no metadata was published. Verify remote state before retrying.',
          { cause },
        );
      }
      created = true;
    }
    writesStarted = true;
    // GitHub has no multi-asset transaction. Companions first, updater commit point last.
    for (const name of CHANNEL_FILES) await transport.uploadAsset(tag, name, files[name]);
    await transport.editNotes(tag, pointerNotes(channel, candidate.rollback));
    const result = await readChannel(transport, channel, repository);
    if (
      !result ||
      !CHANNEL_FILES.every((name) =>
        Buffer.from(result.files[name]).equals(Buffer.from(files[name])),
      )
    ) {
      throw new Error('Published channel read-back does not match the candidate.');
    }
    return { status: 'published', version: candidate.latest.version };
  } catch (cause) {
    if (!created && !writesStarted) throw cause;
    const recoveryFailures = [];
    if (previous) {
      for (const name of CHANNEL_FILES) {
        try {
          await transport.uploadAsset(tag, name, previous.files[name]);
        } catch (error) {
          recoveryFailures.push(error);
        }
      }
      try {
        await transport.editNotes(tag, previous.remote.body || '');
      } catch (error) {
        recoveryFailures.push(error);
      }
      try {
        const restored = await readChannel(transport, channel, repository);
        if (!sameSnapshot(previous, restored))
          throw new Error('Rollback metadata read-back mismatch.');
      } catch (error) {
        recoveryFailures.push(error);
      }
    } else {
      try {
        await transport.deleteRelease(tag);
        if (await transport.findRelease(tag))
          throw new Error('Incomplete initial channel still exists.');
      } catch (error) {
        recoveryFailures.push(error);
      }
    }
    throw new Error(
      recoveryFailures.length
        ? 'Channel publication failed AND metadata recovery failed; manual repair required. Never report release success.'
        : 'Channel publication failed; previous metadata and notes were restored and verified.',
      { cause },
    );
  }
}

export { encode as encodeMetadata };
