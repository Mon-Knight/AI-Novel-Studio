import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChapterSummaryValidation } from '../../types/chapterSummary';
import { evaluateSummaryApplicationPolicy } from './summaryApplicationPolicy';

function validation(): ChapterSummaryValidation {
  return {
    policyVersion: 1,
    passed: true,
    safeToContext: true,
    score: 88,
    problems: [],
    blockingIssues: [],
    semanticValidation: 'not_checked',
    advisories: [
      { code: 'SUMMARY_SEMANTICS_REQUIRE_REVIEW', path: '/grounding', message: '语义未核验' },
    ],
  };
}

for (const type of ['character_error', 'setting_error', 'fabrication'] as const)
  test(`${type} cannot be enabled by a high score or a human-review flag`, () => {
    const unsafe = {
      ...validation(),
      passed: false,
      score: 76,
      problems: [{ type, message: '阻断' }],
    };
    for (const mode of ['context', 'manual_review', 'task_preauthorization'] as const) {
      const policy = evaluateSummaryApplicationPolicy(
        { ...unsafe, authorReviewed: true },
        'failed',
        mode,
      );
      assert.equal(policy.eligible, false);
      assert.equal(policy.stopReason, 'SUMMARY_BLOCKING_VALIDATION_ERROR');
    }
  });

test('generic semantic unchecked advisory is not a mandatory human-review requirement', () => {
  const policy = evaluateSummaryApplicationPolicy(validation(), 'passed', 'task_preauthorization');
  assert.equal(policy.eligible, true);
  assert.equal(policy.humanReviewRequired, false);
});

test('concrete human-required policy cannot be replaced by task preauthorization', () => {
  const requiresHuman = { ...validation(), reviewRequirement: 'human_required' as const };
  assert.equal(evaluateSummaryApplicationPolicy(requiresHuman).eligible, false);
  assert.equal(
    evaluateSummaryApplicationPolicy({ ...requiresHuman, authorReviewed: true }).eligible,
    true,
  );
  assert.equal(
    evaluateSummaryApplicationPolicy(
      { ...requiresHuman, authorReviewed: true },
      'passed',
      'task_preauthorization',
    ).eligible,
    false,
  );
});

test('legacy native manual review is readable without interpreting all passed=false as safe', () => {
  const legacy: ChapterSummaryValidation = {
    passed: false,
    score: 0,
    safeToContext: true,
    authorReviewed: true,
    evidenceValidation: 'passed',
    semanticValidation: 'not_checked',
    problems: [{ type: 'speculation', message: '作者已审阅应用；原文依据核对不等于语义证明。' }],
  };
  assert.equal(evaluateSummaryApplicationPolicy(legacy, 'pending').eligible, true);
  assert.equal(evaluateSummaryApplicationPolicy(legacy, 'pending').legacyManualReview, true);
  assert.equal(
    evaluateSummaryApplicationPolicy(legacy, 'pending', 'task_preauthorization').eligible,
    false,
  );
  assert.equal(
    evaluateSummaryApplicationPolicy({
      ...legacy,
      problems: [{ type: 'character_error', message: '不在原文' }],
    }).eligible,
    false,
  );
});

test('preauthorized receipts cannot claim author review or omit grant identity', () => {
  const automatic = {
    ...validation(),
    applicationProvenance: { mode: 'task_preauthorization' as const, authorizationId: 'grant' },
  };
  assert.equal(evaluateSummaryApplicationPolicy(automatic).eligible, true);
  assert.equal(
    evaluateSummaryApplicationPolicy({ ...automatic, authorReviewed: true }).eligible,
    false,
  );
  assert.equal(
    evaluateSummaryApplicationPolicy({
      ...automatic,
      applicationProvenance: { mode: 'task_preauthorization' },
    }).eligible,
    false,
  );
});

test('failed status, unknown version and malformed receipts fail closed; old unvalidated manual summaries remain readable', () => {
  assert.equal(evaluateSummaryApplicationPolicy(undefined).eligible, true);
  assert.equal(evaluateSummaryApplicationPolicy(undefined, 'failed').eligible, false);
  assert.equal(
    evaluateSummaryApplicationPolicy(undefined, undefined, 'task_preauthorization').eligible,
    false,
  );
  assert.equal(
    evaluateSummaryApplicationPolicy({ ...validation(), safeToContext: false }).eligible,
    false,
  );
  assert.equal(
    evaluateSummaryApplicationPolicy({
      ...validation(),
      policyVersion: 2,
    } as unknown as ChapterSummaryValidation).stopReason,
    'SUMMARY_VALIDATION_INVALID',
  );
  for (const patch of [
    { groundingIssues: [null] },
    { groundingIssues: 'invalid' },
    { applicationProvenance: null },
    { semanticValidation: 'passed' },
    { applicationProvenance: { mode: 'task_preauthorization', authorizationId: 123 } },
  ])
    assert.equal(
      evaluateSummaryApplicationPolicy({
        ...validation(),
        ...patch,
      } as unknown as ChapterSummaryValidation).stopReason,
      'SUMMARY_VALIDATION_INVALID',
    );
});
