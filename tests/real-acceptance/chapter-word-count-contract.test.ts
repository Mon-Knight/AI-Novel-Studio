import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChapterWordRange } from '../../src/services/conversation/workbenchChapterWriter.ts';
import {
  PREPARED_ASSETS_MAX_CHAPTER_WORDS,
  PREPARED_ASSETS_MIN_CHAPTER_WORDS,
  isRealAcceptanceLengthControlEvidenceConsistent,
  resolveRealAcceptanceChapterWordRange,
} from './chapter-word-count-contract.ts';

test('sparse-idea acceptance follows the production Writer final range', () => {
  const productionRange = resolveChapterWordRange(2_500);
  const acceptanceRange = resolveRealAcceptanceChapterWordRange({
    scenario: 'sparse-idea',
    targetWordCount: 2_500,
  });

  assert.ok(productionRange);
  assert.deepEqual(acceptanceRange, {
    target: 2_500,
    minimum: productionRange.hardMinimum,
    maximum: productionRange.hardMaximum,
    source: 'writer-final-range',
  });
  assert.deepEqual(acceptanceRange, {
    target: 2_500,
    minimum: 2_000,
    maximum: 2_875,
    source: 'writer-final-range',
  });
});

test('prepared-assets acceptance retains its original fixed fixture range', () => {
  assert.deepEqual(
    resolveRealAcceptanceChapterWordRange({
      scenario: 'prepared-assets',
      targetWordCount: 4_100,
    }),
    {
      target: 4_100,
      minimum: PREPARED_ASSETS_MIN_CHAPTER_WORDS,
      maximum: PREPARED_ASSETS_MAX_CHAPTER_WORDS,
      source: 'prepared-assets-fixture',
    },
  );
  assert.equal(PREPARED_ASSETS_MIN_CHAPTER_WORDS, 3_200);
  assert.equal(PREPARED_ASSETS_MAX_CHAPTER_WORDS, 6_000);
});

test('acceptance refuses to create an unconstrained range without a formal target', () => {
  for (const targetWordCount of [undefined, 0, Number.NaN]) {
    assert.throws(
      () =>
        resolveRealAcceptanceChapterWordRange({
          scenario: 'sparse-idea',
          targetWordCount,
        }),
      /positive formal chapter target/i,
    );
  }
});

test('length-control evidence accepts both expansion and compression repairs', () => {
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      scenario: 'sparse-idea',
      targetWordCount: 3_000,
      originalWordCount: 2_334,
      finalWordCount: 2_700,
      lengthRepairCount: 1,
      integrityRepairCount: 0,
    }),
    true,
  );
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      scenario: 'sparse-idea',
      targetWordCount: 3_000,
      originalWordCount: 3_600,
      finalWordCount: 3_100,
      lengthRepairCount: 1,
      integrityRepairCount: 0,
    }),
    true,
  );
});

test('integrity repair may change an already in-range chapter word count', () => {
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      scenario: 'sparse-idea',
      targetWordCount: 3_000,
      originalWordCount: 3_103,
      finalWordCount: 2_920,
      lengthRepairCount: 0,
      integrityRepairCount: 1,
    }),
    true,
  );
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      scenario: 'sparse-idea',
      targetWordCount: 3_000,
      originalWordCount: 4_027,
      finalWordCount: 2_820,
      lengthRepairCount: 2,
      integrityRepairCount: 1,
    }),
    true,
  );
});

test('length-control evidence rejects missing, spurious, or unsuccessful repairs', () => {
  const base = {
    scenario: 'sparse-idea' as const,
    targetWordCount: 3_000,
  };
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      ...base,
      originalWordCount: 3_000,
      finalWordCount: 3_000,
      lengthRepairCount: 0,
      integrityRepairCount: 0,
    }),
    true,
  );
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      ...base,
      originalWordCount: 2_334,
      finalWordCount: 2_334,
      lengthRepairCount: 0,
      integrityRepairCount: 0,
    }),
    false,
  );
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      ...base,
      originalWordCount: 2_334,
      finalWordCount: 2_700,
      lengthRepairCount: 0,
      integrityRepairCount: 1,
    }),
    false,
  );
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      ...base,
      originalWordCount: 3_000,
      finalWordCount: 3_100,
      lengthRepairCount: 1,
      integrityRepairCount: 0,
    }),
    false,
  );
  assert.equal(
    isRealAcceptanceLengthControlEvidenceConsistent({
      ...base,
      originalWordCount: 2_334,
      finalWordCount: 2_350,
      lengthRepairCount: 3,
      integrityRepairCount: 0,
    }),
    false,
  );
});
