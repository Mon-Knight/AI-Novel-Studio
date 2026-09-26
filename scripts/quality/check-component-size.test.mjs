import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_TS_BASELINE,
  MAX_PRODUCTION_LINES,
  countLines,
  evaluate,
  isProductionSource,
} from './check-component-size.mjs';

const limit = MAX_PRODUCTION_LINES;
const baseline = Object.freeze({ 'src/services/legacy.ts': 900 });

test('countLines ignores a single trailing newline and empty content', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\r\nb'), 2);
});

test('isProductionSource excludes test files and test directories', () => {
  assert.equal(isProductionSource('src/services/a.ts'), true);
  assert.equal(isProductionSource('src/components/A.tsx'), true);
  assert.equal(isProductionSource('src/services/a.test.ts'), false);
  assert.equal(isProductionSource('src/components/A.test.tsx'), false);
  assert.equal(isProductionSource('src/test/helpers.ts'), false);
  assert.equal(isProductionSource('src/services/__tests__/a.ts'), false);
  assert.equal(isProductionSource('src/styles/a.css'), false);
});

test('TSX components are held to the hard limit regardless of the baseline', () => {
  const { violations } = evaluate({
    files: [
      { file: 'src/components/AtLimit.tsx', lines: limit },
      { file: 'src/components/Over.tsx', lines: limit + 1 },
    ],
    baseline,
    limit,
  });
  assert.deepEqual(
    violations.map(({ file, reason }) => ({ file, reason })),
    [{ file: 'src/components/Over.tsx', reason: 'over-limit' }],
  );
});

test('a new TS module over the limit fails closed', () => {
  const { violations } = evaluate({
    files: [{ file: 'src/services/fresh.ts', lines: limit + 1 }],
    baseline,
    limit,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, 'over-limit');
  assert.equal(violations[0].budget, limit);
});

test('a frozen TS module passes at its recorded size and fails when it grows', () => {
  const held = evaluate({
    files: [{ file: 'src/services/legacy.ts', lines: 900 }],
    baseline,
    limit,
  });
  assert.deepEqual(held.violations, []);
  assert.deepEqual(held.staleBaseline, []);

  const grown = evaluate({
    files: [{ file: 'src/services/legacy.ts', lines: 901 }],
    baseline,
    limit,
  });
  assert.equal(grown.violations.length, 1);
  assert.equal(grown.violations[0].reason, 'over-baseline');
  assert.equal(grown.violations[0].budget, 900);
});

test('a frozen TS module may shrink while it stays above the limit', () => {
  const { violations, staleBaseline } = evaluate({
    files: [{ file: 'src/services/legacy.ts', lines: limit + 1 }],
    baseline,
    limit,
  });
  assert.deepEqual(violations, []);
  assert.deepEqual(staleBaseline, []);
});

test('the budget ratchets down when a module reaches the hard limit', () => {
  const shrunk = evaluate({
    files: [{ file: 'src/services/legacy.ts', lines: limit }],
    baseline,
    limit,
  });
  assert.deepEqual(shrunk.violations, []);
  assert.deepEqual(shrunk.staleBaseline, [{ file: 'src/services/legacy.ts', lines: limit }]);

  const deleted = evaluate({ files: [], baseline, limit });
  assert.deepEqual(deleted.staleBaseline, [{ file: 'src/services/legacy.ts', lines: undefined }]);
});

test('a module that shrank to the hard limit fails closed when it regrows', () => {
  const regrown = evaluate({
    files: [{ file: 'src/services/legacy.ts', lines: limit + 1 }],
    baseline: {},
    limit,
  });
  assert.deepEqual(regrown.staleBaseline, []);
  assert.deepEqual(regrown.violations, [
    { file: 'src/services/legacy.ts', lines: limit + 1, budget: limit, reason: 'over-limit' },
  ]);
});

test('a committed baseline at or below the hard limit is stale', () => {
  const misRecorded = evaluate({
    files: [{ file: 'src/services/legacy.ts', lines: limit + 1 }],
    baseline: { 'src/services/legacy.ts': limit },
    limit,
  });
  assert.deepEqual(misRecorded.staleBaseline, [
    { file: 'src/services/legacy.ts', lines: limit + 1 },
  ]);
});

test('every committed baseline entry is above the limit', () => {
  const useless = Object.entries(LEGACY_TS_BASELINE).filter(([, lines]) => lines <= limit);
  assert.deepEqual(useless, []);
});

test('the committed baseline only waives TS modules', () => {
  const wrongKind = Object.keys(LEGACY_TS_BASELINE).filter((file) => !file.endsWith('.ts'));
  assert.deepEqual(wrongKind, []);
});
