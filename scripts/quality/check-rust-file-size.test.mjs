import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_RUST_BASELINE,
  MAX_RUST_LINES,
  countLines,
  evaluate,
  isRustSource,
} from './check-rust-file-size.mjs';

const limit = MAX_RUST_LINES;
const baseline = Object.freeze({ 'src-tauri/src/services/legacy.rs': 900 });

test('countLines ignores a single trailing newline and empty content', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\r\nb'), 2);
});

test('isRustSource keeps production modules and drops test-only or generated sources', () => {
  assert.equal(isRustSource('src-tauri/src/commands.rs'), true);
  assert.equal(isRustSource('src-tauri/src/services/dsh/task_runtime.rs'), true);
  assert.equal(isRustSource('src-tauri/src/services/dsh/task_runtime_tests.rs'), false);
  assert.equal(isRustSource('src-tauri/src/services/dsh/tests.rs'), false);
  assert.equal(isRustSource('src-tauri/src/services/test/support.rs'), false);
  assert.equal(isRustSource('src-tauri/src/services/fixtures/sample.rs'), false);
  assert.equal(isRustSource('src-tauri/target/debug/build/out.rs'), false);
  assert.equal(isRustSource('src-tauri/src/main.ts'), false);
});

test('a new Rust module over the limit fails closed at the hard budget', () => {
  const atLimit = evaluate({
    files: [{ file: 'src-tauri/src/services/AtLimit.rs', lines: limit }],
    baseline,
    limit,
  });
  assert.deepEqual(atLimit.violations, []);

  const fresh = evaluate({
    files: [{ file: 'src-tauri/src/services/fresh.rs', lines: limit + 1 }],
    baseline,
    limit,
  });
  assert.equal(fresh.violations.length, 1);
  assert.equal(fresh.violations[0].reason, 'over-limit');
  assert.equal(fresh.violations[0].budget, limit);
});

test('a frozen Rust module passes at its recorded size and fails when it grows', () => {
  const held = evaluate({
    files: [{ file: 'src-tauri/src/services/legacy.rs', lines: 900 }],
    baseline,
    limit,
  });
  assert.deepEqual(held.violations, []);
  assert.deepEqual(held.staleBaseline, []);

  const grown = evaluate({
    files: [{ file: 'src-tauri/src/services/legacy.rs', lines: 901 }],
    baseline,
    limit,
  });
  assert.equal(grown.violations.length, 1);
  assert.equal(grown.violations[0].reason, 'over-baseline');
  assert.equal(grown.violations[0].budget, 900);
});

test('a frozen Rust module may shrink while it stays above the limit', () => {
  const { violations, staleBaseline } = evaluate({
    files: [{ file: 'src-tauri/src/services/legacy.rs', lines: limit + 1 }],
    baseline,
    limit,
  });
  assert.deepEqual(violations, []);
  assert.deepEqual(staleBaseline, []);
});

test('the budget ratchets down when a module reaches the hard limit', () => {
  const shrunk = evaluate({
    files: [{ file: 'src-tauri/src/services/legacy.rs', lines: limit }],
    baseline,
    limit,
  });
  assert.deepEqual(shrunk.violations, []);
  assert.deepEqual(shrunk.staleBaseline, [
    { file: 'src-tauri/src/services/legacy.rs', lines: limit },
  ]);

  const deleted = evaluate({ files: [], baseline, limit });
  assert.deepEqual(deleted.staleBaseline, [
    { file: 'src-tauri/src/services/legacy.rs', lines: undefined },
  ]);
});

test('a module that shrank to the hard limit fails closed when it regrows', () => {
  const regrown = evaluate({
    files: [{ file: 'src-tauri/src/services/legacy.rs', lines: limit + 1 }],
    baseline: {},
    limit,
  });
  assert.deepEqual(regrown.staleBaseline, []);
  assert.deepEqual(regrown.violations, [
    {
      file: 'src-tauri/src/services/legacy.rs',
      lines: limit + 1,
      budget: limit,
      reason: 'over-limit',
    },
  ]);
});

test('a committed baseline entry that is not above the limit is itself a stale waiver', () => {
  const misRecorded = evaluate({
    files: [{ file: 'src-tauri/src/services/small.rs', lines: limit + 1 }],
    baseline: { 'src-tauri/src/services/small.rs': limit },
    limit,
  });
  assert.deepEqual(
    [...misRecorded.staleBaseline],
    [{ file: 'src-tauri/src/services/small.rs', lines: limit + 1 }],
  );
});

test('every committed baseline entry is above the limit', () => {
  const useless = Object.entries(LEGACY_RUST_BASELINE).filter(([, lines]) => lines <= limit);
  assert.deepEqual(useless, []);
});

test('the committed baseline only waives production Rust modules under src-tauri', () => {
  const wrongKind = Object.keys(LEGACY_RUST_BASELINE).filter(
    (file) => !file.endsWith('.rs') || !file.startsWith('src-tauri/') || !isRustSource(file),
  );
  assert.deepEqual(wrongKind, []);
});
