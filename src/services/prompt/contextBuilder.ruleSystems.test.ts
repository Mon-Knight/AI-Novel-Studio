import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRuleSystemForWriter,
  resolveWorldBackgroundForWriter,
  buildRuleSystemsProjectionForWriter,
  buildWorldSettingsProjectionForWriter,
} from './contextBuilder';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import type { RuleSystem, WorldSetting } from '../../types/setting';

test('twelve active rules retain long prohibition and unknown metadata canaries with scope coverage', async () => {
  const rules: RuleSystem[] = Array.from({ length: 12 }, (_, index) => ({
    id: 'rule-' + String(index).padStart(2, '0'),
    novelId: 'n',
    title: 'Rule ' + index,
    content: '设定'.repeat(800) + 'CONTENT_' + index + '_TAIL',
    forbiddenRules: JSON.stringify([
      '禁止'.repeat(500) + 'FORBIDDEN_' + index + '_TAIL',
      { unknown: 'UNKNOWN_FORBIDDEN' },
    ]),
    structuredJson: JSON.stringify({
      schemaVersion: 'unknown',
      claim: 'x'.repeat(1000) + 'UNKNOWN_' + index + '_TAIL',
    }),
    isActive: true,
    createdAt: 't',
    updatedAt: 't' + index,
  }));
  const first = await buildRuleSystemsProjectionForWriter('n', rules);
  const reordered = await buildRuleSystemsProjectionForWriter('n', [...rules].reverse());
  assert.deepEqual(first, reordered);
  assert.equal(first.ruleSystemCoverage.requiredCount, 12);
  assert.equal(first.ruleSystemCoverage.includedCount, 12);
  assert.equal(first.ruleSystemCoverage.status, 'complete');
  assert.equal(
    first.ruleSystemCoverage.projectionHash,
    await computeContentSha256(first.ruleSystems!),
  );
  for (let index = 0; index < 12; index += 1) {
    for (const prefix of ['CONTENT_', 'FORBIDDEN_', 'UNKNOWN_']) {
      assert.ok(first.ruleSystems!.includes(prefix + index + '_TAIL'));
    }
  }
  assert.match(first.ruleSystems!, /UNKNOWN_FORBIDDEN/u);
  assert.match(first.ruleSystems!, /未解释|未确认|未知|不支持/u);
  await assert.rejects(
    buildRuleSystemsProjectionForWriter('foreign', rules),
    /context_incomplete/u,
  );
  const inactive = await buildRuleSystemsProjectionForWriter(
    'n',
    rules.map((rule) => ({ ...rule, isActive: false })),
  );
  assert.equal(inactive.ruleSystemCoverage.requiredCount, 0);
  assert.equal(inactive.ruleSystems, undefined);
});

test('world projection covers twelve full backgrounds including structured-only unknown facts', async () => {
  const worlds: WorldSetting[] = Array.from({ length: 12 }, (_, index) => ({
    id: 'world-' + index,
    novelId: 'n',
    title: 'World ' + index,
    content: index === 0 ? '' : '世界'.repeat(1000) + 'WORLD_' + index + '_TAIL',
    structuredJson: JSON.stringify({
      schemaVersion: 'future',
      value: 'x'.repeat(1000) + 'PARAMETER_' + index + '_TAIL',
    }),
    isActive: true,
    createdAt: 't',
    updatedAt: String(index).padStart(2, '0'),
  }));
  const projected = await buildWorldSettingsProjectionForWriter('n', worlds);
  assert.equal(projected.worldSettingCoverage.requiredCount, 12);
  assert.equal(projected.worldSettingCoverage.includedCount, 12);
  const text = [projected.worldBackground, projected.chapterSettings].join('\n');
  for (let index = 0; index < 12; index += 1)
    assert.ok(text.includes('PARAMETER_' + index + '_TAIL'));
  for (let index = 1; index < 12; index += 1) assert.ok(text.includes('WORLD_' + index + '_TAIL'));
  assert.equal(
    projected.worldSettingCoverage.projectionHash,
    await computeContentSha256(
      JSON.stringify({
        worldBackground: projected.worldBackground,
        chapterSettings: projected.chapterSettings,
      }),
    ),
  );
  await assert.rejects(
    buildWorldSettingsProjectionForWriter('other', worlds),
    /context_incomplete/u,
  );
});

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

test('Writer selects the most recently updated active world setting', () => {
  assert.equal(
    resolveWorldBackgroundForWriter(
      [
        {
          id: 'world-old',
          content: '旧世界仍处于活动状态',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'world-inactive',
          content: '更新但已停用的世界',
          isActive: false,
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'world-latest',
          content: '最近应用的正式世界',
          isActive: true,
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-04T00:00:00.000Z',
        },
      ],
      '旧版世界背景',
    ),
    '最近应用的正式世界',
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
