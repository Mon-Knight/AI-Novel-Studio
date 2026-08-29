import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationArtifactCard } from '../../types/conversation';
import { buildArtifactRevisionDraft } from './artifactRevisionPrompt';

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
