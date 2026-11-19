import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationScopes } from './verification-scopes.mjs';

function owner(file) {
  const result = verificationScopes.find((scope) => scope.match.test(file));
  assert.ok(result, `behavior ownership is required for ${file}`);
  return result;
}

test('new Scene and Beat workflow modules select their behavioral and compatibility tests', () => {
  for (const file of [
    'src/types/chapterWritingWorkflow.ts',
    'src/types/chapterEngineering.ts',
    'src/services/generation/chapterWritingWorkflow.ts',
    'src/services/generation/chapterWritingWorkflowSession.ts',
    'src/services/generation/chapterWritingState.ts',
    'src/services/ai/chapterSceneOnlyPlanService.ts',
    'src/services/ai/chapterSceneBeatPlanService.ts',
    'src/services/ai/chapterBeatStateService.ts',
    'src/services/ai/compilation/chapterPlanningCompilationDefinitions.ts',
    'src/services/engineering/chapterScenePlanNormalization.ts',
    'src/services/ai/mockChapterStagedResponses.ts',
  ]) {
    const scope = owner(file);
    assert.equal(scope.name, 'staged chapter planning and execution');
    assert.ok(scope.tests.includes('src/services/generation/chapterWritingWorkflow.test.ts'));
    assert.ok(scope.tests.includes('src/services/engineering/chapterEngineeringService.test.ts'));
    assert.ok(scope.safety.includes('src/services/ai/aiCancellation.test.ts'));
  }
});

test('native workflow stage facts require the full SQLite domain, not empty repository filters', () => {
  for (const file of [
    'src-tauri/src/repositories/chapter_workflow_stage_repository.rs',
    'src-tauri/src/services/chapter_workflow_stage_service.rs',
    'src-tauri/src/services/chapter_workflow_stage_contract.rs',
    'src-tauri/src/services/chapter_workflow_stage_tests.rs',
    'src-tauri/src/commands/chapter_workflow_stages.rs',
    'src-tauri/src/migrations_chapter_workflow_stages.rs',
    'src/types/chapterWorkflowStage.ts',
  ]) {
    const scope = owner(file);
    assert.equal(scope.name, 'native chapter workflow stages');
    assert.equal(scope.rustFull, true);
    assert.ok(scope.e2e.includes('project-backup-boundary'));
  }
});

test('presentation-only stages keep component checks while summary coverage keeps apply regressions', () => {
  const presentation = owner('src/pages/Workbench/WorkbenchChapterStageTree.tsx');
  assert.equal(presentation.name, 'chapter stage presentation');
  assert.ok(presentation.tests.includes('src/features/workbench/chapterStageProjection.test.ts'));
  const coverage = owner('src-tauri/src/services/summary_coverage.rs');
  assert.equal(coverage.name, 'grounded chapter summaries');
  assert.ok(coverage.rustFilters.includes('services::summary_coverage::'));
  assert.ok(coverage.rustFilters.includes('services::structured_artifact_apply_service::'));
});
