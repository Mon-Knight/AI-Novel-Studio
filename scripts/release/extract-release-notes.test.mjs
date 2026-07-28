import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReleaseNotes } from './extract-release-notes.mjs';

test('extracts one exact version section without adjacent releases', () => {
  const changelog = `# Changelog

## v3.1.0-beta.1 (2026-08-01) - Beta

- beta change

## v3.0.0 (2026-07-28) - Stable

- stable change
`;
  const notes = extractReleaseNotes(changelog, '3.1.0-beta.1');
  assert.match(notes, /^## v3\.1\.0-beta\.1/mu);
  assert.match(notes, /beta change/u);
  assert.doesNotMatch(notes, /stable change/u);
});

test('fails closed when a version is missing or duplicated', () => {
  assert.throws(() => extractReleaseNotes('## v3.0.0\n\nA\n', '3.1.0'), /found 0/u);
  assert.throws(
    () => extractReleaseNotes('## v3.0.0\n\nA\n\n## v3.0.0\n\nB\n', '3.0.0'),
    /found 2/u,
  );
});
