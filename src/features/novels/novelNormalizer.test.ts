import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNovel } from './novelNormalizer';

test('normalizeNovel preserves camel-case legacy world background', () => {
  const novel = normalizeNovel({
    id: 'legacy-camel-world',
    title: '雾城旧档',
    worldBackground: '雾潮会抹去未被记录的姓名。',
  });

  assert.equal(novel?.worldBackground, '雾潮会抹去未被记录的姓名。');
});

test('normalizeNovel maps snake-case legacy world background', () => {
  const novel = normalizeNovel({
    id: 'legacy-snake-world',
    title: '海渊残卷',
    world_background: '潮汐退去后，海床上的城市只存在一小时。',
  });

  assert.equal(novel?.worldBackground, '潮汐退去后，海床上的城市只存在一小时。');
});
