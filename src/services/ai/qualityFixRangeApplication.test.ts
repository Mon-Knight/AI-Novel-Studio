import assert from 'node:assert/strict';
import test from 'node:test';
import type { QualityCheckItem } from '../../types/qualityCheck';
import { splitChapterText } from './chapterTextSegmentation';
import {
  applyDeterministicQualityFixRanges,
  assertQualityFixRoundAvailable,
  generateSegmentedQualityFix,
  validateQualityFixScope,
  withQualityFixRequestSettings,
} from './qualityFixService';
import { fixRunStore } from './fixRunStore';

const now = '2026-08-03T00:00:00.000Z';

function issue(issueKey: string, overrides: Partial<QualityCheckItem> = {}): QualityCheckItem {
  return {
    id: `item-${issueKey}`,
    reportId: 'report-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
    issueType: 'logic',
    severity: 'high',
    title: issueKey,
    description: `修复 ${issueKey}`,
    issueKey,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('changed_ranges deterministically override an over-rewritten provider full text', async () => {
  const source = [
    '第一段保持不变。',
    '大厅没有出口。',
    '第三段保持不变。',
    '第四段保持不变。',
  ].join('\n\n');
  const pending = issue('space-conflict', {
    quote: '大厅没有出口。',
    paragraphIndex: 1,
  });

  const result = await generateSegmentedQualityFix(
    {
      chapterTitle: '测试章节',
      sourceContent: source,
      pendingIssues: [pending],
      ignoredIssues: [],
    },
    async () => ({
      text: JSON.stringify({
        mode: 'targeted_fix',
        fixed_issue_keys: [pending.issueKey],
        changed_ranges: [
          {
            issue_key: pending.issueKey,
            before: '大厅没有出口。',
            after: '大厅只剩一扇通往站台的铁门。',
            reason: '统一空间结构',
          },
        ],
        revised_content: '模型把整章全部重写成了不可信的新正文。',
        revision_summary: '修复空间冲突',
      }),
    }),
  );

  assert.equal(
    result.fixResult.revisedContent,
    source.replace('大厅没有出口。', '大厅只剩一扇通往站台的铁门。'),
  );
  assert.equal(result.fixResult.applicationMode, 'deterministic_ranges');
  assert.deepEqual(result.fixResult.fixedIssueKeys, [pending.issueKey]);
});

test('duplicate before text is disambiguated by the quality issue paragraph', () => {
  const source = ['广播再次响起。', '广播再次响起。'].join('\n\n');
  const [segment] = splitChapterText(source);
  const pending = issue('second-broadcast', { paragraphIndex: 1 });

  const applied = applyDeterministicQualityFixRanges({
    fullSourceContent: source,
    segment,
    pendingIssues: [pending],
    changedRanges: [
      {
        issue_key: pending.issueKey,
        before: '广播再次响起。',
        after: '广播只剩下半句警告。',
        reason: '减少重复',
      },
    ],
  });

  assert.equal(applied.revisedContent, '广播再次响起。\n\n广播只剩下半句警告。');
});

test('ambiguous and overlapping provider replacements fail closed', () => {
  const repeated = ['同一句。', '同一句。'].join('\n\n');
  const [repeatedSegment] = splitChapterText(repeated);
  assert.throws(
    () =>
      applyDeterministicQualityFixRanges({
        fullSourceContent: repeated,
        segment: repeatedSegment,
        pendingIssues: [issue('ambiguous')],
        changedRanges: [
          {
            issue_key: 'ambiguous',
            before: '同一句。',
            after: '新句子。',
            reason: '测试',
          },
        ],
      }),
    /不唯一/,
  );

  const source = 'abcdef';
  const [segment] = splitChapterText(source);
  assert.throws(
    () =>
      applyDeterministicQualityFixRanges({
        fullSourceContent: source,
        segment,
        pendingIssues: [
          issue('left', { startOffset: 0, endOffset: 3 }),
          issue('right', { startOffset: 1, endOffset: 4 }),
        ],
        changedRanges: [
          { issue_key: 'left', before: 'abc', after: 'ABC', reason: '测试' },
          { issue_key: 'right', before: 'bcd', after: 'BCD', reason: '测试' },
        ],
      }),
    /相互重叠/,
  );
});

test('overlapping provider ranges recover as one deterministic issue-bound paragraph patch', async () => {
  const target = '海葵诊所门口排着长队，入口只挂着一块旧招牌。';
  const revisedTarget = '海葵诊所的侧门只排着两个人，正门入口挂着新招牌。';
  const source = ['第一段保持不变。', target, '第三段保持不变。', '第四段保持不变。'].join('\n\n');
  const revisedContent = source.replace(target, revisedTarget);
  const left = issue('clinic-repeat', {
    quote: '海葵诊所门口排着长队',
    paragraphIndex: 1,
  });
  const right = issue('clinic-entrance', {
    quote: '诊所门口排着长队，入口只挂着一块旧招牌',
    paragraphIndex: 1,
  });

  const generated = await generateSegmentedQualityFix(
    {
      chapterTitle: '测试章节',
      sourceContent: source,
      pendingIssues: [left, right],
      ignoredIssues: [],
    },
    async (request) => {
      assert.match(request.messages[0].content, /changed_ranges.*互不重叠/s);
      assert.match(request.messages[0].content, /revised_content/);
      return {
        text: JSON.stringify({
          mode: 'targeted_fix',
          fixed_issue_keys: [left.issueKey, right.issueKey],
          changed_ranges: [
            {
              issue_key: left.issueKey,
              before: '海葵诊所门口排着长队',
              after: '海葵诊所的侧门只排着两个人',
              reason: '删除重复进入场景',
            },
            {
              issue_key: right.issueKey,
              before: '诊所门口排着长队，入口只挂着一块旧招牌',
              after: '诊所正门入口挂着新招牌',
              reason: '统一入口描写',
            },
          ],
          revised_content: revisedContent,
          revision_summary: '合并修复同一段内的重叠问题',
        }),
      };
    },
  );

  assert.equal(generated.fixResult.applicationMode, 'deterministic_ranges');
  assert.equal(generated.fixResult.revisedContent, revisedContent);
  assert.equal(generated.fixResult.changedRanges.length, 1);
  assert.equal(generated.fixResult.changedRanges[0].before, target);
  assert.equal(generated.fixResult.changedRanges[0].after, revisedTarget);
  assert.deepEqual(generated.fixResult.fixedIssueKeys, [left.issueKey, right.issueKey]);
  const scope = validateQualityFixScope(
    source,
    generated.fixResult.revisedContent,
    generated.fixResult.changedRanges,
    generated.fixResult.fixedIssueKeys,
    true,
  );
  assert.equal(scope.passed, true);
  assert.equal(scope.changedParagraphCount, 1);
});

test('mismatched provider before recovers from an issue-bound full-text witness', async () => {
  const target = 'The clinic device stops when the indicator turns amber.';
  const revisedTarget = 'The clinic device stops after a second peak turns the indicator amber.';
  const source = ['Opening stays unchanged.', target, 'Ending stays unchanged.'].join('\n\n');
  const pending = issue('clinic-reaction', {
    quote: 'indicator turns amber',
    paragraphIndex: 1,
  });

  const generated = await generateSegmentedQualityFix(
    {
      chapterTitle: 'Acceptance chapter',
      sourceContent: source,
      pendingIssues: [pending],
      ignoredIssues: [],
    },
    async () => ({
      text: JSON.stringify({
        mode: 'targeted_fix',
        fixed_issue_keys: [pending.issueKey],
        changed_ranges: [
          {
            issue_key: pending.issueKey,
            before: 'The clinic device stops when its indicator turns amber.',
            after: revisedTarget,
            reason: 'Add the missing reaction trigger.',
          },
        ],
        revised_content: source.replace(target, revisedTarget),
        revision_summary: 'Clarify the clinic reaction trigger.',
      }),
    }),
  );

  assert.equal(generated.fixResult.applicationMode, 'deterministic_ranges');
  assert.equal(generated.fixResult.revisedContent, source.replace(target, revisedTarget));
  assert.equal(generated.fixResult.changedRanges.length, 1);
  assert.equal(generated.fixResult.changedRanges[0].before, target);
  assert.equal(generated.fixResult.changedRanges[0].after, revisedTarget);
  assert.deepEqual(generated.fixResult.fixedIssueKeys, [pending.issueKey]);
});

test('overlapping provider ranges without a full revision witness still fail closed', async () => {
  const source = 'abcdef';
  await assert.rejects(
    generateSegmentedQualityFix(
      {
        chapterTitle: '测试章节',
        sourceContent: source,
        pendingIssues: [
          issue('left', { startOffset: 0, endOffset: 3 }),
          issue('right', { startOffset: 1, endOffset: 4 }),
        ],
        ignoredIssues: [],
      },
      async () => ({
        text: JSON.stringify({
          mode: 'targeted_fix',
          fixed_issue_keys: ['left', 'right'],
          changed_ranges: [
            { issue_key: 'left', before: 'abc', after: 'ABC', reason: '测试' },
            { issue_key: 'right', before: 'bcd', after: 'BCD', reason: '测试' },
          ],
          revision_summary: '测试',
        }),
      }),
    ),
    /没有可校验的完整修订正文/,
  );
});

test('deterministic repair scope reports no unrelated edits and shares the repair timeout floor', () => {
  const source = ['第一段。', '第二段问题。', '第三段。', '第四段。'].join('\n\n');
  const revised = source.replace('第二段问题。', '第二段已修复。');
  const scope = validateQualityFixScope(
    source,
    revised,
    [
      {
        issue_key: 'issue-2',
        before: '第二段问题。',
        after: '第二段已修复。',
        reason: '测试',
      },
    ],
    ['issue-2'],
    true,
  );

  assert.equal(scope.passed, true);
  assert.equal(scope.changedParagraphCount, 1);
  assert.equal(scope.unrelatedChangedCount, 0);
  assert.equal(
    withQualityFixRequestSettings({
      runtimeMode: 'api',
      provider: 'openai_compatible',
      baseUrl: 'https://fixture.invalid',
      apiKey: 'fixture',
      modelName: 'fixture',
      timeoutSeconds: 120,
      mockMode: false,
    }).timeoutSeconds,
    300,
  );
});

test('one persisted repair attempt exhausts the external repair round for that source draft', async () => {
  const original = fixRunStore.getByChapterId;
  fixRunStore.getByChapterId = async () =>
    [
      {
        sourceDraftId: 'draft-used',
      },
    ] as never;
  try {
    await assert.rejects(
      assertQualityFixRoundAvailable('chapter-1', 'draft-used'),
      /唯一一轮外部 AI 修稿/,
    );
    await assert.doesNotReject(assertQualityFixRoundAvailable('chapter-1', 'draft-fresh'));
  } finally {
    fixRunStore.getByChapterId = original;
  }
});
