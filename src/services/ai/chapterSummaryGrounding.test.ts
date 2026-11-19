import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import {
  summaryAssertionTargets,
  summaryClaimViews,
  validateSummaryGrounding,
} from './chapterSummaryGrounding';
import { normalizeChapterSummarizeResult } from './chapterSummarizeNormalizer';
import { validateSummary } from './summaryValidator';
import { evaluateSummaryApplicationPolicy } from './summaryApplicationPolicy';

const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/chapter-summary-grounding.json', import.meta.url),
    'utf8',
  ),
) as Array<{
  name: string;
  source: string;
  required: boolean;
  payload: unknown;
  errors: string[];
  warnings: string[];
}>;
for (const fixture of fixtures)
  test(`summary grounding: ${fixture.name}`, () => {
    const { issues } = validateSummaryGrounding(fixture.source, fixture.payload, fixture.required);
    for (const severity of ['error', 'warning'] as const) {
      assert.deepEqual(
        issues
          .filter((issue) => issue.severity === severity)
          .map((issue) => issue.code)
          .sort(),
        (severity === 'error' ? fixture.errors : fixture.warnings).slice().sort(),
      );
    }
  });
test('host finds source beyond preview boundaries and produces Unicode character offsets', () => {
  const source = '开篇😀\n'.repeat(5000) + '最后一页仍未找到。';
  const payload = {
    summary: '【待查】最后一页仍未找到。',
    grounding: {
      version: 1,
      claims: [{ path: '/summary', status: 'unresolved', quotes: ['最后一页仍未找到。'] }],
    },
  };
  const { issues, locations } = validateSummaryGrounding(source, payload);
  assert.equal(
    issues.some((issue) => issue.severity === 'error'),
    false,
  );
  assert.equal(locations.get('/summary')?.[0].line, 5001);
  assert.equal(locations.get('/summary')?.[0].startChar, 20000);
});
test('normalization retains malformed evidence for validation and does not fabricate a receipt', () => {
  const result = normalizeChapterSummarizeResult({ summary: '唐棠收到旧信。' }, '');
  const validation = validateSummary('唐棠收到一封旧信。', result);
  assert.equal(result.grounding, undefined);
  assert.equal(validation.safeToContext, false);
  assert.equal(validation.semanticValidation, 'not_checked');
});
test('normalization distinguishes omitted coverage arrays from explicit empty arrays', () => {
  const missing = normalizeChapterSummarizeResult({ summary: '唐棠收到旧信。' }, '');
  assert.deepEqual(missing.coverage, {
    characterChanges: 'missing',
    contextRecords: 'missing',
  });
  const explicit = normalizeChapterSummarizeResult(
    { summary: '唐棠收到旧信。', characterChanges: [], contextRecords: [] },
    '',
  );
  assert.deepEqual(explicit.coverage, {
    characterChanges: 'explicit',
    contextRecords: 'explicit',
  });
});

test('review includes uncovered memory assertions with an explicit unclassified state', () => {
  const claims = summaryClaimViews(fixtures[6].payload);
  assert.equal(claims.length, 6);
  assert.equal(claims.filter((claim) => claim.status === 'unclassified').length, 5);
  assert.ok(claims.some((claim) => claim.path === '/contextRecords/0/content'));
});

test('fragment receipt exposes the complete source sentence including omitted negation', () => {
  const fixture = fixtures.find(
    (item) => item.name === 'matching fragment cannot hide source negation',
  )!;
  const { locations } = validateSummaryGrounding(fixture.source, fixture.payload);
  assert.equal(locations.get('/summary')?.[0].context, '她从未去过外省。');
});

function groundedSummary(): ChapterSummarizeResult {
  const result = normalizeChapterSummarizeResult(
    {
      summary: '唐棠收到一封旧信。',
      keyEvents: ['唐棠收到一封旧信。'],
      characterChanges: [{ characterName: '唐棠', stateSummary: '唐棠收到一封旧信。' }],
      contextRecords: [
        {
          contextType: 'chapter_summary',
          title: '旧信',
          content: '唐棠收到一封旧信。',
          importance: 3,
        },
      ],
    },
    '',
  );
  result.grounding = {
    version: 1,
    claims: [...summaryAssertionTargets(result)].map(([path]) => ({
      path,
      status: 'confirmed' as const,
      quotes: ['唐棠收到一封旧信。'],
    })),
  };
  return result;
}

test('semantic review advisory alone keeps validation successful and visible', () => {
  const source = '唐棠收到一封旧信。她把信收进抽屉。';
  const validation = validateSummary(source, groundedSummary());

  assert.equal(validation.passed, true);
  assert.equal(validation.safeToContext, true);
  assert.equal(validation.score, 88);
  assert.equal(validation.evidenceValidation, 'passed');
  assert.deepEqual(validation.problems, []);
  assert.deepEqual(
    validation.advisories?.map((advisory) => advisory.code),
    ['SUMMARY_SEMANTICS_REQUIRE_REVIEW'],
  );
  assert.ok(
    validation.groundingIssues?.some((issue) => issue.code === 'SUMMARY_SEMANTICS_REQUIRE_REVIEW'),
  );
});

test('blocking grounding errors still fail and disable context', () => {
  const source = '唐棠收到一封旧信。';
  const result = normalizeChapterSummarizeResult(
    {
      summary: '唐棠收到一封旧信。',
      keyEvents: [],
      characterChanges: [],
      contextRecords: [],
    },
    '',
  );
  const validation = validateSummary(source, result);

  assert.equal(validation.passed, false);
  assert.equal(validation.safeToContext, false);
  assert.ok(validation.problems.length > 0);
  assert.deepEqual(validation.advisories, []);
});

test('advisory cannot mask a blocking evidence error', () => {
  const source = '唐棠收到一封旧信。';
  const result = groundedSummary();
  result.keyEvents = ['不存在的事件'];
  result.grounding = {
    version: 1,
    claims: [
      { path: '/summary', status: 'confirmed', quotes: [source] },
      {
        path: '/keyEvents/0',
        status: 'confirmed',
        quotes: ['完全不在正文中的引句'],
      },
      {
        path: '/characterChanges/0/stateSummary',
        status: 'confirmed',
        quotes: [source],
      },
      { path: '/contextRecords/0/title', status: 'confirmed', quotes: [source] },
      { path: '/contextRecords/0/content', status: 'confirmed', quotes: [source] },
    ],
  };
  const validation = validateSummary(source, result);

  assert.equal(validation.passed, false);
  assert.equal(validation.safeToContext, false);
  assert.equal(validation.evidenceValidation, 'failed');
  assert.ok(validation.problems.length > 0);
  assert.ok(
    validation.advisories?.some((advisory) => advisory.code === 'SUMMARY_SEMANTICS_REQUIRE_REVIEW'),
  );
});

test('successful validation keeps no blocking problems and only the baseline review advisory', () => {
  const source = '唐棠收到一封旧信。';
  const validation = validateSummary(source, groundedSummary());

  assert.equal(validation.passed, true);
  assert.equal(validation.problems.length, 0);
  assert.equal(validation.advisories?.length, 1);
});

test('certainty escalation is a concrete author judgment, not a score-authorized automatic application', () => {
  const source = '警员计划下周调取账册。';
  const result = normalizeChapterSummarizeResult(
    {
      summary: '账册已调取。',
      characterChanges: [],
      contextRecords: [],
      grounding: {
        version: 1,
        claims: [{ path: '/summary', status: 'confirmed', quotes: [source] }],
      },
    },
    '',
  );
  const validation = validateSummary(source, result);
  assert.equal(validation.passed, true);
  assert.equal(validation.score, 76);
  assert.equal(validation.reviewRequirement, 'human_required');
  assert.equal(
    evaluateSummaryApplicationPolicy(validation, 'passed', 'task_preauthorization').stopReason,
    'SUMMARY_HUMAN_REVIEW_REQUIRED',
  );
  assert.equal(
    evaluateSummaryApplicationPolicy(
      { ...validation, authorReviewed: true, applicationProvenance: { mode: 'manual_review' } },
      'passed',
      'manual_review',
    ).eligible,
    true,
  );
});

test('a matching fragment cannot let preauthorization replace qualifier review', () => {
  const result = normalizeChapterSummarizeResult(
    {
      summary: '她去过外省。',
      characterChanges: [],
      contextRecords: [],
      grounding: {
        version: 1,
        claims: [{ path: '/summary', status: 'confirmed', quotes: ['去过外省'] }],
      },
    },
    '',
  );
  const validation = validateSummary('她从未去过外省。', result);
  assert.equal(validation.passed, true);
  assert.ok(validation.advisories?.some((issue) => issue.code === 'SUMMARY_EVIDENCE_FRAGMENT'));
  assert.equal(validation.reviewRequirement, 'human_required');
  assert.equal(
    evaluateSummaryApplicationPolicy(validation, 'passed', 'task_preauthorization').stopReason,
    'SUMMARY_HUMAN_REVIEW_REQUIRED',
  );
});

test('a character error at score76 cannot automatically enable summary context', () => {
  const result = groundedSummary();
  result.characterChanges[0].characterName = '陌生角色';
  const validation = validateSummary('唐棠收到一封旧信。', result);
  assert.equal(validation.passed, false);
  assert.equal(validation.score, 76);
  assert.equal(validation.safeToContext, false);
  assert.deepEqual(
    validation.problems.map((problem) => problem.type),
    ['character_error'],
  );
  assert.ok(validation.blockingIssues?.some((issue) => issue.code === 'SUMMARY_CHARACTER_ERROR'));
  assert.equal(validation.semanticValidation, 'not_checked');
  assert.equal(validation.advisories?.[0].code, 'SUMMARY_SEMANTICS_REQUIRE_REVIEW');
});
