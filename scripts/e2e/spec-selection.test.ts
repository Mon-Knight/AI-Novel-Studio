import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyPanelSpecs, selectDesktopSpecs } from './spec-selection.ts';
const all = [
  'app-start.spec.ts',
  'workbench-writing-smoke.spec.ts',
  'candidate-review-apply.spec.ts',
];
test('multiple selected specs share one ordered, deduplicated run', () => {
  assert.deepEqual(
    selectDesktopSpecs(
      ['--spec', 'app-start', '--spec', 'candidate-review-apply', '--spec', 'app-start.spec.ts'],
      all,
    ),
    [all[0], all[2]],
  );
});
test('smoke verifies a production writing journey and never enables compatibility panels', () => {
  const selected = selectDesktopSpecs(['--smoke'], all);
  assert.deepEqual(selected, all.slice(0, 2));
  assert.ok(selected.every((spec) => !legacyPanelSpecs.has(spec)));
  assert.ok(legacyPanelSpecs.has('candidate-review-apply.spec.ts'));
});
test('unknown, empty and conflicting selections fail before building an app', () => {
  for (const args of [
    ['--spec'],
    ['--spec', 'missing'],
    ['--smoke', '--spec', 'app-start'],
    ['--skip'],
  ])
    assert.throws(() => selectDesktopSpecs(args, all));
  assert.throws(() => selectDesktopSpecs([], []));
});
