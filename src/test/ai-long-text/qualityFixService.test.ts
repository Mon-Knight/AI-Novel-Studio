import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AiGenerateRequest } from '../../types/ai';
import type { QualityCheckItem } from '../../types/qualityCheck';
import {
  generateSegmentedQualityFix,
  selectIssuesForChapterSegment,
} from '../../services/ai/qualityFixService';
import { splitChapterText } from '../../services/ai/chapterTextSegmentation';

const now = '2026-07-28T00:00:00.000Z';

function issue(issueKey: string, overrides: Partial<QualityCheckItem>): QualityCheckItem {
  return {
    id: `id_${issueKey}`,
    reportId: 'report_1',
    novelId: 'novel_1',
    chapterId: 'chapter_1',
    draftId: 'draft_1',
    issueType: 'language',
    severity: 'medium',
    title: issueKey,
    description: `修复 ${issueKey}`,
    issueKey,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function segmentBody(request: AiGenerateRequest): string {
  const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
  const marker = system.includes('以下是当前章节分段正文：')
    ? '以下是当前章节分段正文：\n'
    : '以下是当前章节全文：\n';
  const body = system.split(marker)[1];
  assert.ok(body, '修稿提示词应包含当前待修正文');
  return body;
}

test('长章节修稿仅调用包含相关 issue 的分段并逐字符保留其他分段', async () => {
  const first = `开头-${'甲'.repeat(120)}HEAD_ISSUE${'甲'.repeat(6_500)}`;
  const middle = `MIDDLE_UNCHANGED-${'乙'.repeat(6_650)}`;
  const last = `${'丙'.repeat(6_500)}TAIL_ISSUE-章节真实结尾`;
  const source = [first, middle, last].join('\n\n');
  const headStart = source.indexOf('HEAD_ISSUE');
  const pendingIssues = [
    issue('issue_head', {
      startOffset: headStart,
      endOffset: headStart + 'HEAD_ISSUE'.length,
      quote: 'HEAD_ISSUE',
    }),
    issue('issue_tail', { quote: 'TAIL_ISSUE' }),
  ];
  const ignoredIssues = [issue('ignored_head', { quote: 'HEAD_ISSUE', status: 'ignored' })];
  const prompts: string[] = [];
  const requestedBodies: string[] = [];

  const generation = await generateSegmentedQualityFix(
    {
      chapterTitle: '长章节',
      sourceContent: source,
      pendingIssues,
      ignoredIssues,
    },
    async (request) => {
      const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
      prompts.push(system);
      const body = segmentBody(request);
      requestedBodies.push(body);
      const currentIssue = system.includes('issue_head') ? 'issue_head' : 'issue_tail';
      const revised =
        currentIssue === 'issue_head'
          ? body.replace('HEAD_ISSUE', 'HEAD_FIXED')
          : body.replace('TAIL_ISSUE', 'TAIL_FIXED');
      return {
        text: JSON.stringify({
          mode: 'targeted_fix',
          fixed_issue_keys: [currentIssue],
          revision_summary: `已修复 ${currentIssue}`,
          changed_ranges: [
            { issue_key: currentIssue, before: 'ISSUE', after: 'FIXED', reason: '测试' },
          ],
          revised_content: revised,
        }),
        tokenInput: 10,
        tokenOutput: 20,
        tokenTotal: 30,
      };
    },
  );

  assert.equal(generation.sourceSegmentCount, 3);
  assert.equal(generation.requestCount, 2);
  assert.equal(prompts.length, 2);
  assert.ok(
    prompts.some((prompt) => prompt.includes('issue_head') && !prompt.includes('issue_tail')),
  );
  assert.ok(
    prompts.some((prompt) => prompt.includes('issue_tail') && !prompt.includes('issue_head')),
  );
  assert.ok(requestedBodies.every((body) => !body.includes('MIDDLE_UNCHANGED')));
  assert.ok(generation.fixResult.revisedContent.includes('HEAD_FIXED'));
  assert.ok(generation.fixResult.revisedContent.includes('TAIL_FIXED-章节真实结尾'));
  assert.ok(generation.fixResult.revisedContent.includes(`\n\n${middle}\n\n`));
  assert.deepEqual(generation.fixResult.fixedIssueKeys.sort(), ['issue_head', 'issue_tail']);
  assert.equal(generation.tokenInput, 20);
  assert.equal(generation.tokenOutput, 40);
  assert.equal(generation.tokenTotal, 60);
});

test('issue 按全文 offset、原文 quote 和段落索引映射到相交分段', () => {
  const source = [
    `${'甲'.repeat(6_600)}OFFSET_MARK`,
    `${'乙'.repeat(6_600)}QUOTE_MARK`,
    `${'丙'.repeat(6_600)}PARAGRAPH_MARK`,
  ].join('\n\n');
  const segments = splitChapterText(source);
  assert.equal(segments.length, 3);
  const offset = source.indexOf('OFFSET_MARK');
  const issues = [
    issue('by_offset', { startOffset: offset, endOffset: offset + 11 }),
    issue('by_quote', { quote: 'QUOTE_MARK' }),
    issue('by_paragraph', { paragraphIndex: 2 }),
  ];

  assert.deepEqual(
    selectIssuesForChapterSegment(source, segments[0], issues).map((item) => item.issueKey),
    ['by_offset'],
  );
  assert.deepEqual(
    selectIssuesForChapterSegment(source, segments[1], issues).map((item) => item.issueKey),
    ['by_quote'],
  );
  assert.deepEqual(
    selectIssuesForChapterSegment(source, segments[2], issues).map((item) => item.issueKey),
    ['by_paragraph'],
  );
});
