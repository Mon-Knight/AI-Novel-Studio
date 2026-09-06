const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export function parseVersion(version) {
  const match = typeof version === 'string' && version.match(SEMVER);
  if (!match) throw new Error(`Invalid semantic version: ${String(version)}`);
  const prerelease = match[4]?.split('.') || [];
  if (prerelease.some((part) => /^\d+$/u.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === bv) continue;
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1;
    const an = /^\d+$/u.test(av);
    const bn = /^\d+$/u.test(bv);
    if (an !== bn) return an ? -1 : 1;
    return an ? (BigInt(av) > BigInt(bv) ? 1 : -1) : av > bv ? 1 : -1;
  }
  return 0;
}

export function assertChannelVersion(channel, version) {
  const parsed = parseVersion(version);
  if (
    !['stable', 'beta'].includes(channel) ||
    (channel === 'beta') !== parsed.prerelease.length > 0
  ) {
    throw new Error(`Version ${version} does not belong to the ${channel} channel.`);
  }
}

export function assertReleaseUrl(url, repository, version) {
  const parsed = new URL(url);
  const prefix = `/${repository}/releases/download/${encodeURIComponent(`v${version}`)}/`;
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.startsWith(prefix) ||
    !/^[^/]+\.(?:msi|exe)$/iu.test(parsed.pathname.slice(prefix.length))
  ) {
    throw new Error(
      'Previous installer URL must identify the retained version in this repository.',
    );
  }
}

export function assertRollback({
  version,
  channel,
  previousVersion,
  previousInstallerUrl,
  repository,
}) {
  assertChannelVersion(channel, version);
  if (Boolean(previousVersion) !== Boolean(previousInstallerUrl)) {
    throw new Error('Previous version and installer URL must be supplied together.');
  }
  if (!previousVersion) return;
  assertChannelVersion(channel, previousVersion);
  if (compareVersions(previousVersion, version) >= 0)
    throw new Error('Rollback version must be strictly older than the release.');
  assertReleaseUrl(previousInstallerUrl, repository, previousVersion);
}
