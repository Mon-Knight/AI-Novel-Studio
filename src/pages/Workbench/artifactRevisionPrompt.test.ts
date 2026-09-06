import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationArtifactCard } from '../../types/conversation';
import {
  appendArtifactRevisionDraft,
  buildArtifactRevisionDraft,
  formatArtifactReviewNotes,
} from './artifactRevisionPrompt';

const expectedDrafts: Array<[ConversationArtifactCard['artifactType'], string]> = [
  ['chapter_text', '请根据以下要求修改上一版章节正文候选：\n'],
  ['outline', '请根据以下要求修改上一版大纲候选：\n'],
  ['character_candidates', '请根据以下要求修改上一版人物候选：\n'],
  ['event_candidates', '请根据以下要求修改上一版事件候选：\n'],
  ['setting_candidates', '请根据以下要求修改上一版设定候选：\n'],
  ['chapter_summary', '请根据以下要求修改上一版章节总结候选：\n'],
  ['quality_report', '请根据以下要求重新检查正文并更新质量检查报告：\n'],
  ['style_analysis', '请根据以下要求重新分析风格并更新风格分析报告：\n'],
  ['generic', '请根据以下要求调整上一版创作产物：\n'],
];

test('buildArtifactRevisionDraft returns domain-specific revision openings', () => {
  for (const [artifactType, expected] of expectedDrafts) {
    assert.equal(buildArtifactRevisionDraft(artifactType), expected, artifactType);
  }
});

test('read-only report revision drafts do not imply candidate application', () => {
  for (const artifactType of ['quality_report', 'style_analysis'] as const) {
    const draft = buildArtifactRevisionDraft(artifactType);
    assert.doesNotMatch(draft, /候选|应用|采用/);
    assert.match(draft, /报告/);
  }
});

test('unmapped artifact types use the neutral generic opening', () => {
  assert.equal(buildArtifactRevisionDraft('tool_result'), '请根据以下要求调整上一版创作产物：\n');
});

test('revision drafts preserve complete review notes without trimming or truncation', () => {
  const notes = `  保留原人物，仅调整动机。\n${'补充要求。'.repeat(1000)}\n  `;
  assert.equal(
    buildArtifactRevisionDraft('character_candidates', notes),
    `请根据以下要求修改上一版人物候选：\n${notes}`,
  );
  assert.equal(
    buildArtifactRevisionDraft('character_candidates', ' \n '),
    buildArtifactRevisionDraft('character_candidates'),
  );
});

test('appending a revision preserves all existing draft characters', () => {
  const revision = buildArtifactRevisionDraft('outline', '补充结尾的因果链。');
  const existing = '  尚未发送的创作目标。\n第二行包含空格。  ';
  assert.equal(appendArtifactRevisionDraft(existing, revision), `${existing}\n\n${revision}`);
  assert.equal(appendArtifactRevisionDraft('', revision), revision);
  assert.equal(appendArtifactRevisionDraft(' \n', revision), ` \n\n${revision}`);
  assert.equal(appendArtifactRevisionDraft('目标\n\n', revision), `目标\n\n${revision}`);
});

test('appending the same revision again is idempotent and keeps later user input', () => {
  const revision = buildArtifactRevisionDraft('chapter_summary', '不要遗漏结尾的发现。');
  const once = appendArtifactRevisionDraft('原目标', revision);
  assert.equal(appendArtifactRevisionDraft(once, revision), once);
  const continued = `${once}\n用户继续填写的其他要求。`;
  assert.equal(appendArtifactRevisionDraft(continued, revision), continued);
  assert.equal(appendArtifactRevisionDraft(continued, ''), continued);
  const nextRevision = buildArtifactRevisionDraft('chapter_summary', '另外补充人物变化。');
  assert.equal(
    appendArtifactRevisionDraft(continued, nextRevision),
    `${continued}\n\n${nextRevision}`,
  );
});

test('review notes keep each original candidate name and complete suggested values', () => {
  const longSummary = `  ${'调整后的动机。'.repeat(1000)}\n保留此尾行。  `;
  assert.equal(
    formatArtifactReviewNotes({
      first: {
        originalTitle: '林夏',
        suggestedTitle: '  林下  ',
        suggestedSummary: longSummary,
        notes: '  不改变人物关系。\n  ',
      },
      second: {
        originalTitle: '顾川',
        suggestedTitle: '',
        suggestedSummary: '',
        notes: '保留原姓名。',
      },
    }),
    `候选：林夏\n建议标题：  林下  \n建议摘要：${longSummary}\n补充要求：  不改变人物关系。\n  \n\n候选：顾川\n补充要求：保留原姓名。`,
  );
});

test('review notes omit whitespace-only fields and candidates without any suggestions', () => {
  const blank = {
    originalTitle: '仅查看的候选',
    suggestedTitle: ' ',
    suggestedSummary: '\n',
    notes: ' \n ',
  };
  assert.equal(formatArtifactReviewNotes({}), '');
  assert.equal(formatArtifactReviewNotes({ blank }), '');
  assert.equal(
    formatArtifactReviewNotes({
      blank,
      changed: { ...blank, originalTitle: '需修订的候选', suggestedSummary: '  新摘要。 ' },
    }),
    '候选：需修订的候选\n建议摘要：  新摘要。 ',
  );
});
