import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationScopes } from './verification-scopes.mjs';
import { createVerificationPlan } from './verify-change.mjs';

const owner = (file) => verificationScopes.find((scope) => scope.match.test(file));

test('manual profile and chapter saves own guarded persistence and real navigation regressions', () => {
  for (const file of [
    'src-tauri/src/services/chapter_details_service.rs',
    'src/services/chapters/chapterDetails.ts',
    'src/components/outline/ChapterFormModal.tsx',
  ]) {
    assert.equal(owner(file)?.name, 'guarded chapter details and adopted outline routing');
    assert.ok(owner(file).rustFilters.includes('services::chapter_details_service::'));
    assert.ok(owner(file).tests.includes('src/test/components/OutlineEditorRoute.test.tsx'));
  }
  for (const file of [
    'src-tauri/src/services/character_profile_service.rs',
    'src/features/characters/useCharacterProfileEditor.ts',
  ]) {
    assert.equal(owner(file)?.name, 'guarded character profile editing');
    assert.ok(owner(file).rustFilters.includes('services::character_profile_service::'));
  }
});

test('writing fault evidence retains planner classification, mock and isolated desktop gates', () => {
  const inventory = [
    'scripts/e2e/run-writing-fault-injection.test.mjs',
    'tests/real-acceptance/writing-subagent-fault-evidence.test.ts',
    'scripts/dsh/mock-workbench-upstream.test.mjs',
  ];
  const file = 'tests/real-acceptance/writing-subagent-fault-evidence.ts';
  assert.equal(owner(file)?.name, 'isolated writing fault carrier');
  assert.equal(owner(file)?.faultInjection, true);
  const plan = createVerificationPlan([file], inventory);
  for (const item of inventory) assert.ok(plan.tests.includes(item), item);
});

test('model inheritance and chapter handoff keep integration tests alongside adjacent unit tests', () => {
  const inventory = [
    'src/services/conversation/projectTaskModel.test.ts',
    'src/pages/Workbench/hooks/useWorkbenchTaskCreator.test.tsx',
    'src/services/conversation/chapterWorkflowService.test.ts',
    'src/features/workbench/useWorkbenchChapterHandoff.test.tsx',
    'src/test/components/ChapterSummaryWorkflowNotice.test.tsx',
  ];
  const modelPlan = createVerificationPlan(
    ['src/services/conversation/projectTaskModel.ts'],
    inventory,
  );
  assert.ok(modelPlan.tests.includes(inventory[0]));
  assert.ok(modelPlan.tests.includes(inventory[1]));
  for (const file of [
    'src/services/conversation/chapterWorkflowService.ts',
    'src/features/workspace/useChapterSummaryWorkflow.ts',
    'src/components/workspace/ChapterSummaryDetails.tsx',
    'src/pages/Workbench/WorkbenchChapterSummaryStatus.tsx',
    'src/pages/WritingWorkspace/WorkspaceSummaryDialogs.tsx',
  ]) {
    const plan = createVerificationPlan([file], inventory);
    assert.ok(plan.tests.includes(inventory[2]), file);
    assert.ok(plan.tests.includes(inventory[3]), file);
    assert.ok(plan.e2e.includes('workbench-writing-smoke'), file);
  }
});

test('source routing, retry extraction and word preferences retain their adapter integration gates', () => {
  const inventory = [
    'src/services/conversation/taskGoalRouting.test.ts',
    'src/services/conversation/artifactRevisionSourceService.test.ts',
    'src/services/conversation/workbenchRetryTarget.test.ts',
    'src/services/dsh/taskSessionAdapter.test.ts',
    'src/services/dsh/taskRetryRecovery.test.ts',
    'src/pages/Workbench/hooks/useWorkbenchTaskRunner.test.tsx',
  ];
  for (const file of [
    'src/services/conversation/artifactRevisionRouting.ts',
    'src/services/conversation/taskGoalRouting.ts',
  ]) {
    const plan = createVerificationPlan([file], inventory);
    assert.ok(plan.tests.includes(inventory[1]), file);
    assert.ok(plan.tests.includes(inventory[3]), file);
  }
  const retry = createVerificationPlan(
    ['src/features/workbench/prepareWorkbenchRetry.ts'],
    inventory,
  );
  assert.ok(retry.tests.includes(inventory[2]));
  assert.ok(retry.tests.includes(inventory[4]));
  assert.ok(retry.tests.includes(inventory[5]));
  for (const file of [
    'src/services/conversation/taskWritingPreferences.ts',
    'src/services/conversation/taskWordTarget.ts',
  ]) {
    assert.ok(createVerificationPlan([file], inventory).tests.includes(inventory[3]), file);
  }
  assert.equal(owner('src-tauri/src/services/dsh/task_runtime_word_target.rs')?.rustFull, true);
});

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

test('previously size-only native modules have executable regression ownership', () => {
  for (const file of [
    'src-tauri/src/repositories/novel_repository.rs',
    'src-tauri/src/repositories/character_state_repository.rs',
    'src-tauri/src/services/legacy_migration_service.rs',
    'src-tauri/src/services/ai_task_creation.rs',
    'src-tauri/src/services/structured_setting_apply.rs',
    'src-tauri/src/services/structured_artifact_rule_governance_tests.rs',
    'src-tauri/src/repositories/conversation_review_authorization.rs',
  ]) {
    const plan = createVerificationPlan([file], []);
    assert.ok(plan.rustFull || plan.rustFilters.length > 0, file);
    assert.ok(plan.e2e.length > 0, file);
  }
});

test('extracted native startup tests retain their runnable test owner', () => {
  assert.deepEqual(owner('src-tauri/src/main_startup_tests.rs')?.rustFilters, ['startup_tests::']);
});

test('real-use repairs select source, grounding, word-preview and export behaviors', () => {
  assert.equal(
    owner('src-tauri/src/services/chapter_source_reference.rs')?.name,
    'chapter source reconciliation',
  );
  assert.ok(
    owner('src-tauri/src/services/chapter_source_reference_tests.rs')?.rustFilters.includes(
      'services::chapter_source_reference::',
    ),
  );
  assert.equal(
    owner('tests/fixtures/chapter-summary-grounding.json')?.name,
    'grounded chapter summaries',
  );
  assert.equal(
    owner('src-tauri/src/services/summary_grounding_source.rs')?.name,
    'grounded chapter summaries',
  );
  const exportTests = ['src/test/export/manuscriptExport.test.ts'];
  assert.deepEqual(
    createVerificationPlan(['src/utils/chapterHeading.ts'], exportTests).tests,
    exportTests,
  );
  const previewTests = ['src/test/components/WorkbenchWordPreview.test.tsx'];
  assert.deepEqual(
    createVerificationPlan(['src/features/workbench/useWorkbenchWordPreview.ts'], previewTests)
      .tests,
    previewTests,
  );
});
