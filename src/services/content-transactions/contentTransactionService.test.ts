import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChapterMetadataTargets,
  normalizeContentTransactionInput,
} from './contentTransactionService';

test('normalization freezes distinct typed targets without mutating payloads', () => {
  const payload = { name: '北境议会', description: '守卫北境' };
  const result = normalizeContentTransactionInput({
    operationId: ' op-1 ',
    novelId: ' novel-1 ',
    strategy: 'all_or_nothing',
    targets: [{ targetType: 'faction', targetId: ' faction-1 ', effectType: 'create', payload }],
  });
  assert.equal(result.operationId, 'op-1');
  assert.equal(result.targets[0].targetId, 'faction-1');
  assert.notEqual(result.targets[0].payload, payload);
});

test('normalization rejects a duplicate target identity', () => {
  assert.throws(
    () =>
      normalizeContentTransactionInput({
        operationId: 'op-1',
        novelId: 'novel-1',
        strategy: 'reviewed_partial',
        targets: [
          {
            targetType: 'chapter_metadata',
            targetId: 'chapter-1',
            effectType: 'update',
            payload: { goal: 'A' },
          },
          {
            targetType: 'chapter_metadata',
            targetId: 'chapter-1',
            effectType: 'update',
            payload: { goal: 'B' },
          },
        ],
      }),
    /重复目标/,
  );
});

test('cross chapter helper builds one bounded candidate per unique chapter', () => {
  const targets = buildChapterMetadataTargets(['chapter-2', 'chapter-1', 'chapter-2'], {
    goal: '推进主线',
    titlePrefix: '终局·第',
  });
  assert.deepEqual(
    targets.map((target) => target.targetId),
    ['chapter-2', 'chapter-1'],
  );
  assert.deepEqual(
    targets.map((target) => target.payload.title),
    ['终局·第1', '终局·第2'],
  );
  assert.ok(targets.every((target) => target.targetType === 'chapter_metadata'));
});

test('cross chapter helper requires a material patch', () => {
  assert.throws(() => buildChapterMetadataTargets(['chapter-1'], {}), /至少填写一项/);
});
