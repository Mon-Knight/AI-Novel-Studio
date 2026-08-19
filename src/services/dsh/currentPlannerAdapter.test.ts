// CurrentPlannerAdapter 确定性映射单测（构造 bundle，无真实 AI / 无 Tauri）。

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentPlanBundle } from '../../types/agentPlan';
import type { ChapterPreparationInput } from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';
import { createCurrentPlannerAdapter, mapBundleToProposal } from './currentPlannerAdapter';

function input(): ChapterPreparationInput {
  return {
    novelId: 'nov-a',
    chapterId: 'ch-a1',
    baselineRevisions: CHAPTER_PREPARATION_SOURCES.map((source) => ({ source, revision: 5 })),
  };
}

function step(key: string, ordinal: number, data: unknown): Record<string, unknown> {
  return {
    stepId: key + '-id',
    planId: 'plan-1',
    stepKey: key,
    ordinal,
    title: key,
    toolName: key,
    toolVersion: '1',
    toolIdentity: key + '@1',
    registryHash: 'h',
    inputSchemaHash: 'h',
    outputSchemaHash: 'h',
    permissionsJson: [],
    scope: 'chapter',
    argumentsJson: {},
    argumentsHash: 'h',
    status: 'completed',
    stateRevision: 1,
    outputJson: data,
    createdAt: 't',
    updatedAt: 't',
  };
}

function completedBundle(): AgentPlanBundle {
  const readiness = {
    ok: true,
    data: {
      ready: true,
      score: 1,
      missing: [{ code: 'STYLE_PROFILE', label: '风格方案缺失', blocking: true }],
      warnings: ['草稿为空'],
      summary: '基本就绪',
    },
  };
  return {
    plan: {
      planId: 'plan-1',
      operationId: 'op-1',
      requestHash: 'h',
      contractVersion: 'agent_plan_v1',
      plannerId: 'chapter_readiness_plan_v1',
      plannerVersion: 1,
      registryHash: 'h',
      novelId: 'nov-a',
      chapterId: 'ch-a1',
      status: 'completed',
      stateRevision: 1,
      resultJson: readiness,
      createdAt: 't',
      updatedAt: 't',
    },
    steps: [
      step('read_novel_context', 1, { ok: true, data: { novel: { title: '零点潮汐' } } }),
      step('read_chapter_outline', 2, {
        ok: true,
        data: { chapter: { title: '废弃塔中的求救信', goal: '揭示第一线索' } },
      }),
      step('read_chapter_context', 3, {
        ok: true,
        data: {
          chapterCharacters: [{ id: 'char-1', name: '林舟', roleInChapter: '主角', mustAppear: 1 }],
        },
      }),
      step('read_style_profile', 4, { ok: true, data: { activeStyle: { name: '冷峻悬疑' } } }),
      step('read_output_control', 5, { ok: true, data: { profiles: [] } }),
      step('check_readiness', 6, readiness),
    ],
    dependencies: [],
    attempts: [],
    checkpoints: [],
  } as unknown as AgentPlanBundle;
}

test('mapBundleToProposal: 确定性映射产出合法提案', () => {
  const startedAt = Date.now() - 1234;
  const proposal = mapBundleToProposal(completedBundle(), input(), startedAt);

  assert.equal(proposal.schemaVersion, 1);
  assert.equal(proposal.planner, 'current_chapter_readiness_v1');
  assert.deepEqual(proposal.targetChapter, { novelId: 'nov-a', chapterId: 'ch-a1' });
  assert.deepEqual(proposal.baselineRevisions, input().baselineRevisions);
  assert.equal(proposal.retrievedEvidence.length, 6);
  for (const item of proposal.retrievedEvidence) {
    assert.equal(item.revision, 5, item.source + ' revision 必须回显 baseline');
  }
  assert.ok(proposal.chapterGoals[0].includes('揭示第一线索'));
  assert.equal(proposal.scenePlan[0].title, '废弃塔中的求救信');
  assert.equal(proposal.characterConstraints[0].characterId, 'char-1');
  assert.ok(proposal.continuityRisks.some((risk) => risk.kind === 'readiness_missing'));
  assert.ok(proposal.unresolvedQuestions.some((question) => question.includes('风格方案')));
  assert.ok(proposal.recommendedActions.some((action) => action.type === 'ask_user'));
  assert.equal(proposal.metrics.planner, 'current_chapter_readiness_v1');
  assert.equal(proposal.metrics.toolCallCount, 6);
  assert.ok(proposal.metrics.durationMs >= 1234);
});

test('mapBundleToProposal: 未完成状态拒绝产出', () => {
  const bundle = completedBundle();
  bundle.plan.status = 'waiting_retry';
  assert.throws(() => mapBundleToProposal(bundle, input(), Date.now()), /未完成/);
});

test('adapter.prepare: 编排 runtime 并校验产出', async () => {
  const runtime = {
    createAndRun: async () => completedBundle(),
  };
  const adapter = createCurrentPlannerAdapter({ runtime });
  const proposal = await adapter.prepare(input());
  assert.equal(proposal.planner, 'current_chapter_readiness_v1');
  assert.equal(proposal.schemaVersion, 1);
});
