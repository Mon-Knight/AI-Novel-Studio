import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { selectReleaseChannel } from './select-release-channel.mjs';

test('release channel depends on SemVer prerelease only, never hyphens in build metadata', () => {
  for (const [version, expected] of [
    ['3.6.3', 'stable'],
    ['3.6.3+build-hotfix', 'stable'],
    ['3.6.3+stable-beta.10', 'stable'],
    ['3.6.3-beta.2', 'beta'],
    ['3.6.3-beta.2+build-hotfix', 'beta'],
    ['3.6.3-rc.10+stable', 'beta'],
  ])
    assert.equal(
      selectReleaseChannel({ version, eventName: 'push', ref: `refs/tags/v${version}` }),
      expected,
    );
});

test('rejects malformed version, mismatched tag, branch push and mismatched manual channel', () => {
  for (const input of [
    { version: '3.6.3-', eventName: 'push', ref: 'refs/tags/v3.6.3-' },
    { version: '3.6.3', eventName: 'push', ref: 'refs/tags/v3.6.2' },
    { version: '3.6.3', eventName: 'push', ref: 'refs/heads/main' },
    { version: '3.6.3+build-hotfix', eventName: 'workflow_dispatch', requestedChannel: 'beta' },
    { version: '3.6.3-beta+build', eventName: 'workflow_dispatch', requestedChannel: 'stable' },
  ])
    assert.throws(() => selectReleaseChannel(input));
  assert.equal(
    selectReleaseChannel({
      version: '3.6.3+build-hotfix',
      eventName: 'workflow_dispatch',
      requestedChannel: 'stable',
    }),
    'stable',
  );
  assert.equal(
    selectReleaseChannel({
      version: '3.6.3-beta+build',
      eventName: 'workflow_dispatch',
      requestedChannel: 'beta',
    }),
    'beta',
  );
});

test('workflow concurrency and release environment share the validated channel output', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(workflow, /contains\(github\.ref_name/u);
  assert.doesNotMatch(workflow, /^concurrency:/mu);
  assert.match(workflow, /outputs:\s*\n\s+channel: \$\{\{ steps\.channel\.outputs\.channel \}\}/u);
  assert.match(workflow, /node scripts\/release\/select-release-channel\.mjs/u);
  const windowsJob = workflow.match(
    /^  windows-release:\s*\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:|(?![\s\S]))/mu,
  )?.[1];
  assert.ok(windowsJob);
  assert.match(windowsJob, /needs: \[desktop-gate, release-context\]/u);
  assert.match(
    windowsJob,
    /group: release-channel-\$\{\{ needs\.release-context\.outputs\.channel \}\}/u,
  );
  assert.match(
    windowsJob,
    /RELEASE_CHANNEL: \$\{\{ needs\.release-context\.outputs\.channel \}\}/u,
  );
  assert.match(windowsJob, /cancel-in-progress: false/u);
  assert.match(
    workflow,
    /uses: \.\/\.github\/workflows\/windows-desktop-e2e\.yml[\s\S]*?suite: full/u,
  );
});
