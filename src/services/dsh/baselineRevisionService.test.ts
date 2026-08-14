// baselineRevisionService 单测（注入依赖，无真实 DB）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBaselineRevisions, toUnixMs } from './baselineRevisionService';

test('toUnixMs: 空值与非法值归零', () => {
  assert.equal(toUnixMs(null), 0);
  assert.equal(toUnixMs(undefined), 0);
  assert.equal(toUnixMs(''), 0);
  assert.equal(toUnixMs('not-a-date'), 0);
  assert.equal(toUnixMs('2026-08-14T00:00:00.000Z'), Date.parse('2026-08-14T00:00:00.000Z'));
});

test('loadBaselineRevisions: 聚合六个来源', async () => {
  const revisions = await loadBaselineRevisions('nov-a', 'ch-a1', {
    outlineVersions: async () => [{ version: 7 }, { version: 6 }],
    engineeringActiveVersion: async () => 3,
    activeStyleUpdatedAt: async () => '2026-08-14T00:00:00.000Z',
    activeOutputUpdatedAt: async () => undefined,
    latestChapterStateUpdatedAt: async () => '2026-08-13T12:00:00.000Z',
    latestMemoryUpdatedAt: async () => undefined,
  });
  assert.equal(revisions.length, 6);
  const bySource = new Map(revisions.map((item) => [item.source, item.revision]));
  assert.equal(bySource.get('outline'), 7);
  assert.equal(bySource.get('chapter_context'), 3);
  assert.equal(bySource.get('style_profile'), Date.parse('2026-08-14T00:00:00.000Z'));
  assert.equal(bySource.get('output_control'), 0);
  assert.equal(bySource.get('character_states'), Date.parse('2026-08-13T12:00:00.000Z'));
  assert.equal(bySource.get('memory_index'), 0);
});

test('loadBaselineRevisions: 全空来源归零但不缺失', async () => {
  const revisions = await loadBaselineRevisions('nov-b', 'ch-b1', {
    outlineVersions: async () => [],
    engineeringActiveVersion: async () => 0,
    activeStyleUpdatedAt: async () => undefined,
    activeOutputUpdatedAt: async () => undefined,
    latestChapterStateUpdatedAt: async () => undefined,
    latestMemoryUpdatedAt: async () => undefined,
  });
  assert.equal(revisions.length, 6);
  assert.ok(revisions.every((item) => item.revision === 0));
});
