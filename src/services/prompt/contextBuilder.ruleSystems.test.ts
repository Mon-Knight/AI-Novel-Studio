import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRuleSystemForWriter, resolveWorldBackgroundForWriter } from './contextBuilder';

test('Writer prefers authored active world setting over the legacy novel field', () => {
  assert.equal(
    resolveWorldBackgroundForWriter(
      [
        { content: '不应采用的停用设定', isActive: false },
        { content: '正式世界设定', isActive: true },
      ],
      '旧版世界背景',
    ),
    '正式世界设定',
  );
});

test('Writer falls back to the legacy novel world background when no active setting exists', () => {
  assert.equal(
    resolveWorldBackgroundForWriter(
      [{ content: '不应采用的停用设定', isActive: false }],
      '旧版世界背景',
    ),
    '旧版世界背景',
  );
});

test('rule systems retain structured forbidden rules in Writer context', () => {
  assert.equal(
    formatRuleSystemForWriter({
      title: '潮汐航法',
      content: '航线必须随双月引力重新计算。',
      forbiddenRules: '["禁止在退潮钟响后离港","不得伪造潮位刻度"]',
    }),
    [
      '【潮汐航法】航线必须随双月引力重新计算。',
      '禁止规则：',
      '- 禁止在退潮钟响后离港',
      '- 不得伪造潮位刻度',
    ].join('\n'),
  );
});

test('legacy plain-text forbidden rules remain visible instead of being discarded', () => {
  assert.match(
    formatRuleSystemForWriter({
      title: '档案边界',
      content: '只有修复师能够读取原始档案。',
      forbiddenRules: '不得把删除记录写回公共索引',
    }),
    /禁止规则：\n- 不得把删除记录写回公共索引/,
  );
});
