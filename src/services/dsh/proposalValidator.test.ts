// TS 镜像校验器单测（与 Rust proposal_validator.rs 的用例一一对应）。

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterPreparationInput } from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';
import { validateProposal, coercePlanner } from './proposalValidator';

function input(): ChapterPreparationInput {
  return {
    novelId: 'nov-a',
    chapterId: 'ch-a1',
    baselineRevisions: CHAPTER_PREPARATION_SOURCES.map((source) => ({ source, revision: 3 })),
  };
}

function validProposal(): Record<string, unknown> {
  const baseline = CHAPTER_PREPARATION_SOURCES.map((source) => ({ source, revision: 3 }));
  return {
    schemaVersion: 1,
    planner: 'dsh_spike_v0',
    targetChapter: { novelId: 'nov-a', chapterId: 'ch-a1' },
    baselineRevisions: baseline,
    retrievedEvidence: [{ source: 'outline', revision: 3, summary: '已读大纲' }],
    chapterGoals: ['推进主线'],
    scenePlan: [{ title: '场景一', purpose: '揭示线索', conflicts: ['对峙'] }],
    characterConstraints: [{ characterId: 'char-1', constraint: '不登场' }],
    continuityRisks: [{ kind: '时间线', description: '倒计时衔接', severity: 'medium' }],
    unresolvedQuestions: ['谁来接应'],
    recommendedActions: [{ type: 'read_tool', target: 'chapter_context', description: '复核大纲' }],
    producedAt: '2026-08-14T00:00:00Z',
    metrics: { planner: 'dsh_spike_v0' },
  };
}

test('coercePlanner: 精确命中不归一', () => {
  assert.deepEqual(coercePlanner('dsh_spike_v0'), { planner: 'dsh_spike_v0' });
  assert.deepEqual(coercePlanner('  current_chapter_readiness_v1  '), {
    planner: 'current_chapter_readiness_v1',
  });
});

test('coercePlanner: spike 失败样本唯一近邻归一', () => {
  assert.deepEqual(coercePlanner('dsp_spike_v0'), {
    planner: 'dsh_spike_v0',
    coerced: { original: 'dsp_spike_v0', distance: 1 },
  });
});

test('coercePlanner: 过远/非字符串拒绝', () => {
  assert.equal(coercePlanner('chatgpt'), null);
  assert.equal(coercePlanner(''), null);
  assert.equal(coercePlanner(undefined), null);
  assert.equal(coercePlanner(123), null);
});

test('validateProposal: 接受合法提案', () => {
  const report = validateProposal(validProposal(), input());
  assert.equal(report.valid, true, report.errors.join(' | '));
  assert.equal(report.coerced, undefined);
});

test('validateProposal: 归一 spike 失败样本并记录', () => {
  const proposal = validProposal();
  proposal.planner = 'dsp_spike_v0';
  const report = validateProposal(proposal, input());
  assert.equal(report.valid, true, report.errors.join(' | '));
  assert.equal(proposal.planner, 'dsh_spike_v0');
  assert.equal(report.coerced?.original, 'dsp_spike_v0');
  assert.deepEqual((proposal.metrics as Record<string, unknown>).plannerCoerced, {
    original: 'dsp_spike_v0',
    distance: 1,
  });
});

test('validateProposal: 拒绝写动作', () => {
  const proposal = validProposal();
  proposal.recommendedActions = [{ type: 'write_draft', description: '越权写正文' }];
  const report = validateProposal(proposal, input());
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('read_tool|ask_user')));
});

test('validateProposal: 拒绝 revision 漂移', () => {
  const proposal = validProposal();
  proposal.retrievedEvidence = [{ source: 'outline', revision: 99, summary: '过期事实' }];
  const report = validateProposal(proposal, input());
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('revision mismatch')));
});

test('validateProposal: 拒绝多余顶层键', () => {
  const proposal = validProposal();
  proposal.extra = 'nope';
  const report = validateProposal(proposal, input());
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('top-level keys')));
});

test('validateProposal: 拒绝缺失 metrics', () => {
  const proposal = validProposal();
  delete proposal.metrics;
  const report = validateProposal(proposal, input());
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('metrics')));
});

test('validateProposal: 拒绝过远 planner', () => {
  const proposal = validProposal();
  proposal.planner = 'chatgpt';
  const report = validateProposal(proposal, input());
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes('planner')));
});
