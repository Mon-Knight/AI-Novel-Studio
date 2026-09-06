import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CHANNEL_FILES,
  selectPreviousRelease,
  checkTaggedRelease,
  publishChannel,
} from './channel-publication.mjs';

const executeFile = promisify(execFile);

export function githubTransport(repository, execute = executeFile) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository))
    throw new Error('Invalid GitHub repository.');
  const run = async (args, maxBuffer = 1024 * 1024) => {
    try {
      return (await execute('gh', args, { encoding: 'buffer', maxBuffer, windowsHide: true }))
        .stdout;
    } catch {
      throw new Error('GitHub request failed; refusing to infer missing remote state.');
    }
  };
  const listReleases = async () => {
    const pages = JSON.parse(
      Buffer.from(
        await run(
          ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`],
          16 * 1024 * 1024,
        ),
      ).toString('utf8'),
    );
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
      throw new Error('Malformed GitHub release listing.');
    return pages.flat();
  };
  return {
    listReleases,
    async findRelease(tag) {
      const matching = (await listReleases()).filter((release) => release.tag_name === tag);
      if (matching.length > 1) throw new Error('Ambiguous GitHub release identity.');
      return matching[0] || null;
    },
    async readAsset(release, name, maxBytes = 1024 * 1024) {
      const assets = release.assets?.filter((asset) => asset.name === name) || [];
      if (
        assets.length !== 1 ||
        assets[0].state !== 'uploaded' ||
        !Number.isSafeInteger(assets[0].id) ||
        !Number.isSafeInteger(assets[0].size) ||
        assets[0].size < 1 ||
        assets[0].size > maxBytes
      )
        throw new Error(`Missing, ambiguous or oversized release asset: ${name}`);
      const bytes = await run(
        [
          'api',
          `repos/${repository}/releases/assets/${assets[0].id}`,
          '-H',
          'Accept: application/octet-stream',
        ],
        maxBytes,
      );
      if (bytes.length !== assets[0].size) throw new Error('GitHub asset download is incomplete.');
      return bytes;
    },
    async uploadAsset(tag, name, bytes) {
      if (!CHANNEL_FILES.includes(name)) throw new Error('Unexpected channel metadata asset.');
      const directory = await mkdtemp(path.join(tmpdir(), 'ans-channel-metadata-'));
      try {
        const file = path.join(directory, name);
        await writeFile(file, bytes);
        await run(['release', 'upload', tag, file, '--repo', repository, '--clobber']);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async createRelease(tag, target, notes) {
      await run([
        'release',
        'create',
        tag,
        '--target',
        target,
        '--repo',
        repository,
        '--prerelease',
        '--title',
        `AI Novel Studio ${tag} update index`,
        '--notes',
        notes,
      ]);
    },
    async editNotes(tag, notes) {
      await run(['release', 'edit', tag, '--repo', repository, '--notes', notes]);
    },
    async deleteRelease(tag) {
      await run(['release', 'delete', tag, '--repo', repository, '--yes']);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    const channel = process.env.RELEASE_CHANNEL;
    const repository = process.env.GITHUB_REPOSITORY;
    const transport = githubTransport(repository);
    const version = JSON.parse(await readFile('package.json', 'utf8')).version;
    if (mode === '--previous') {
      console.log(
        JSON.stringify(await selectPreviousRelease(transport, { version, channel, repository })),
      );
    } else {
      if (!['--check-tag', '--publish'].includes(mode))
        throw new Error('Choose --previous, --check-tag or --publish explicitly.');
      const files = Object.fromEntries(
        await Promise.all(
          CHANNEL_FILES.map(async (name) => [
            name,
            await readFile(path.join('dist-release/channels', channel, name)),
          ]),
        ),
      );
      if (mode === '--check-tag') {
        console.log(
          `exists=${await checkTaggedRelease(transport, { files, channel, repository })}`,
        );
      } else
        console.log(
          JSON.stringify(
            await publishChannel(transport, {
              files,
              channel,
              repository,
              target: process.env.GITHUB_SHA,
            }),
          ),
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
