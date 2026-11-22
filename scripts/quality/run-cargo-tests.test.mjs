import assert from 'node:assert/strict';
import test from 'node:test';
import { runCargoTests, rustExecutionBatches, selectRustTests } from './run-cargo-tests.mjs';

const listing =
  'services::draft::db04: test\nservices::draft::db05: test\nservices::other::untouched: test\n';
test('exact selections execute only their unique cases, locked and serial', () => {
  const calls = [];
  const selected = runCargoTests(
    { exact: ['services::draft::db04', 'services::draft::db04'] },
    (_, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: args.includes('--list') ? listing : 'test result: ok. 1 passed; 0 failed;\n',
      };
    },
  );
  assert.deepEqual(selected, ['services::draft::db04']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => args.includes('--locked')));
  assert.ok(calls[1].includes('--exact'));
  assert.ok(calls[1].includes('--test-threads=1'));
  assert.ok(calls[1].includes('services::draft::db04'));
  assert.ok(!calls[1].includes('services::other::untouched'));
});
test('zero, ambiguous and empty selection cannot become a successful no-op', () => {
  for (const options of [{ exact: ['missing'] }, { filters: ['missing'] }, { filters: [''] }, {}])
    assert.throws(() => selectRustTests(listing, options));
  assert.throws(() => selectRustTests(listing + listing, { exact: ['services::draft::db04'] }));
});
test('validated filter runs once and failure propagates', () => {
  let count = 0;
  assert.throws(
    () =>
      runCargoTests({ filters: ['services::draft::'] }, (_, args) => {
        count++;
        if (args.includes('--list')) return { status: 0, stdout: listing };
        assert.ok(args.includes('services::draft::'));
        return { status: 7 };
      }),
    /cargo failed \(7\)/u,
  );
  assert.equal(count, 2);
});
test('discovery-only preserves required test existence without rerunning full-suite members', () => {
  let count = 0;
  const selected = runCargoTests({ filters: ['services::draft::'], listOnly: true }, () => {
    count++;
    return { status: 0, stdout: listing };
  });
  assert.equal(selected.length, 2);
  assert.equal(count, 1);
});

test('an ignored-only execution fails even when discovery found the test', () => {
  assert.throws(
    () =>
      runCargoTests({ exact: ['services::draft::db04'] }, (_, args) => ({
        status: 0,
        stdout: args.includes('--list')
          ? listing
          : 'test result: ok. 0 passed; 0 failed; 1 ignored;\n',
      })),
    /zero passed/u,
  );
});

test('multiple exact names or multiple filters execute in one batched cargo invocation', () => {
  const calls = [];
  const selected = runCargoTests(
    {
      exact: ['services::draft::db04', 'services::draft::db05'],
      filters: ['services::other::'],
    },
    (_, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: args.includes('--list') ? listing : 'test result: ok. 3 passed; 0 failed;\n',
      };
    },
  );
  assert.deepEqual(selected, [
    'services::draft::db04',
    'services::draft::db05',
    'services::other::untouched',
  ]);
  assert.equal(calls.length, 2);
  const runArgs = calls[1];
  const sepIndex = runArgs.indexOf('--');
  const exactIndex = runArgs.indexOf('--exact');
  assert.ok(sepIndex >= 0 && exactIndex > sepIndex);
  assert.ok(runArgs.includes('services::draft::db04'));
  assert.ok(runArgs.includes('services::draft::db05'));
  assert.ok(runArgs.includes('services::other::untouched'));
  assert.ok(runArgs.includes('--test-threads=1'));
});

test('a partially ignored batched execution fails instead of passing silently', () => {
  assert.throws(
    () =>
      runCargoTests({ exact: ['services::draft::db04', 'services::draft::db05'] }, (_, args) => ({
        status: 0,
        stdout: args.includes('--list')
          ? listing
          : 'test result: ok. 1 passed; 0 failed; 1 ignored;\n',
      })),
    /expected 2 passed tests, got 1/u,
  );
});

test('rustExecutionBatches splits large selections within maxCharacters without losing entries', () => {
  const names = Array.from({ length: 40 }, (_, index) => `services::module::case_${index}`);
  const batches = rustExecutionBatches(names, 120);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), names);
  assert.ok(batches.every((batch) => batch.join(' ').length <= 120));
});
