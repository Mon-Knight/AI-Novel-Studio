import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertChannelVersion, parseVersion } from './release-version.mjs';

export function selectReleaseChannel({ version, eventName, ref, requestedChannel }) {
  const parsed = parseVersion(version);
  const channel = parsed.prerelease.length ? 'beta' : 'stable';
  if (eventName === 'push') {
    if (ref !== `refs/tags/v${version}`)
      throw new Error('Release tag must exactly match the package version.');
  } else if (eventName === 'workflow_dispatch') {
    assertChannelVersion(requestedChannel, version);
  } else throw new Error('Unsupported release event.');
  return channel;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    const channel = selectReleaseChannel({
      version,
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      requestedChannel: process.env.REQUESTED_RELEASE_CHANNEL,
    });
    console.log(`channel=${channel}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
