import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorkbenchDecisionIntent } from './workbenchDecisionIntent';

test('parses explicit asset and summary application commands', () => {
  const cases = [
    ['应用当前资产候选', { kind: 'apply_current', target: 'asset', continueAfter: false }],
    [
      '请确认应用世界与规则设定候选。',
      { kind: 'apply_current', target: 'asset', continueAfter: false },
    ],
    [
      '请将全书规划候选应用到作品并继续！',
      { kind: 'apply_current', target: 'asset', continueAfter: true },
    ],
    ['应用本章总结候选', { kind: 'apply_current', target: 'summary', continueAfter: false }],
    [
      '请将章节总结候选应用到作品，然后继续写下一章。',
      { kind: 'apply_current', target: 'summary', continueAfter: true },
    ],
  ] as const;

  for (const [command, expected] of cases) {
    assert.deepEqual(parseWorkbenchDecisionIntent(command), expected, command);
  }
});

test('parses explicit chapter adoption without treating it as structured asset apply', () => {
  const cases = [
    ['采用本章正文候选', { kind: 'adopt_chapter', target: 'chapter', continueAfter: false }],
    [
      '请确认采用章节候选作为正式正文并继续',
      { kind: 'adopt_chapter', target: 'chapter', continueAfter: true },
    ],
    [
      '请将本章候选采用为正式正文。',
      { kind: 'adopt_chapter', target: 'chapter', continueAfter: false },
    ],
  ] as const;

  for (const [command, expected] of cases) {
    assert.deepEqual(parseWorkbenchDecisionIntent(command), expected, command);
  }
});

test('parses explicit rejection and revision requests for every decision target', () => {
  assert.deepEqual(parseWorkbenchDecisionIntent('拒绝主角候选'), {
    kind: 'reject_current',
    target: 'asset',
    continueAfter: false,
  });
  assert.deepEqual(parseWorkbenchDecisionIntent('不应用总结候选'), {
    kind: 'reject_current',
    target: 'summary',
    continueAfter: false,
  });
  assert.deepEqual(parseWorkbenchDecisionIntent('不采用本章候选'), {
    kind: 'reject_current',
    target: 'chapter',
    continueAfter: false,
  });
  assert.deepEqual(parseWorkbenchDecisionIntent('要求修改本章候选：加强中段冲突'), {
    kind: 'request_revision',
    target: 'chapter',
    continueAfter: false,
    revisionInstruction: '加强中段冲突',
  });
  assert.deepEqual(parseWorkbenchDecisionIntent('请修改总结候选'), {
    kind: 'request_revision',
    target: 'summary',
    continueAfter: false,
  });
  assert.deepEqual(parseWorkbenchDecisionIntent('修改世界设定候选: 删除超自然元素。'), {
    kind: 'request_revision',
    target: 'asset',
    continueAfter: false,
    revisionInstruction: '删除超自然元素',
  });
});

test('fails closed for vague, questioning, quoted, compound, or malformed commands', () => {
  const rejected = [
    '',
    '好',
    '确认',
    '应用',
    '应用这个',
    '采用这个',
    '应用当前候选',
    '继续写',
    '全部应用',
    '自动应用全部候选',
    '可以应用总结候选吗？',
    '应用总结候选？',
    '请解释“应用总结候选”是什么意思',
    '应用总结候选并继续，顺便修改主角',
    '应用总结候选并采用本章候选',
    '拒绝本章候选并继续',
    '要求修改本章候选：',
    '不要修改本章候选',
    '不要拒绝本章候选',
    '应用总结候选\n并继续',
    `应用总结候选${'。'.repeat(241)}`,
  ];

  for (const command of rejected) {
    assert.equal(parseWorkbenchDecisionIntent(command), null, command);
  }
});

test('normalizes harmless spaces and full-width command punctuation only', () => {
  assert.deepEqual(parseWorkbenchDecisionIntent('  请 应用 总结候选 并 继续写下一章！  '), {
    kind: 'apply_current',
    target: 'summary',
    continueAfter: true,
  });
  assert.deepEqual(parseWorkbenchDecisionIntent('要求修改本章候选：  保留开放式结尾  。'), {
    kind: 'request_revision',
    target: 'chapter',
    continueAfter: false,
    revisionInstruction: '保留开放式结尾',
  });
});
