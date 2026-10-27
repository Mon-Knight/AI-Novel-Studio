import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateSummaryGrounding, summaryClaimViews } from './chapterSummaryGrounding';
import { normalizeChapterSummarizeResult } from './chapterSummarizeNormalizer';
import { validateSummary } from './summaryValidator';

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
