import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationScopes } from './verification-scopes.mjs';
import { createVerificationPlan } from './verify-change.mjs';

const owner = (file) => verificationScopes.find((scope) => scope.match.test(file));

test('new world rule and verified revision native modules select real Rust safety work', () => {
  for (const file of [
    'src-tauri/shared/world_rule_fingerprint.rs',
    'src-tauri/src/services/world_rule_schema.rs',
    'src-tauri/src/services/world_rule_governance_tests.rs',
    'src-tauri/src/services/setting_suggestion_adoption_service.rs',
    'src-tauri/src/services/structured_rule_apply_receipt.rs',
    'src-tauri/src/services/chapter_revision_artifact.rs',
  ]) {
    assert.equal(owner(file)?.name, 'world rule and revision native authority', file);
    assert.equal(owner(file)?.rustFull, true, file);
    assert.ok(owner(file)?.e2e.includes('interaction-world-rules-repair'), file);
  }
});

test('structured world material and native save contracts cannot fall through to primitive-only tests', () => {
  const inventory = ['src/services/worldRules/worldRuleSchema.test.ts'];
  for (const file of [
    'src/services/worldRules/worldRuleFormatting.ts',
    'src/types/worldRules.ts',
    'src/services/database/settingRepository.ts',
  ]) {
    const plan = createVerificationPlan([file], inventory);
    assert.equal(plan.rustFull, true, file);
    assert.ok(plan.tests.includes(inventory[0]), file);
    assert.ok(plan.e2e.includes('interaction-world-rules-repair'), file);
  }
});

test('interaction and exact artifact focus map to their desktop journey without unrelated Rust expansion', () => {
  const inventory = ['src/pages/Workbench/hooks/useWorkbenchArtifactFocus.test.tsx'];
  const plan = createVerificationPlan(
    ['src/pages/Workbench/hooks/useWorkbenchArtifactFocus.ts'],
    inventory,
  );
  assert.deepEqual(plan.tests, inventory);
  assert.equal(plan.rustFull, false);
  assert.ok(plan.e2e.includes('interaction-world-rules-repair'));
  assert.equal(
    owner('src/styles/workbench-zcode.css')?.name,
    'workbench interaction and candidate continuity',
  );
  assert.equal(
    owner('src/store/workbenchDraftStore.ts')?.name,
    'workbench interaction and candidate continuity',
  );
});

test('extracted native startup tests retain their runnable test owner', () => {
  assert.deepEqual(owner('src-tauri/src/main_startup_tests.rs')?.rustFilters, ['startup_tests::']);
});
