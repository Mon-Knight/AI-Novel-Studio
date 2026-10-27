import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScenePlanItem } from '../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { AiSettings } from '../../types/ai';
import {
  assertStagedChapterOrder,
  stagedScenePlanFromSnapshot,
  runWorkbenchStagedChapter,
} from './workbenchStagedChapterWrite';

function scene(version: 2 | undefined, beats: ScenePlanItem['beats']): ScenePlanItem {
  return {
    id: beats.length ? 'legacy' : 'scene-1',
    sceneNo: 1,
    title: '城门',
    location: '城门',
    characters: ['沈岚'],
    goal: '入城',
    conflict: '盘查',
    keyActions: [],
    keyDialogue: '',
    informationRelease: [],
    result: '',
    transition: '',
    beats,
    targetCharacters: 600,
    ...(version ? { planVersion: version } : {}),
  };
}

function snapshot(scenes: ScenePlanItem[] | undefined): ChapterGenerationSnapshot {
  return {
    id: 'snapshot-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    compiledPromptText: '已采用前文。',
    promptSummary: '摘要',
    contextHash: 'a'.repeat(64),
    sources: [],
    createdAt: '2026-10-20T00:00:00Z',
    compiledContext: {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContext: { novelTitle: '测试', chapterTitle: '第十二章' },
      sections: [],
      sources: [],
      warnings: [],
      compiledAt: '2026-10-20T00:00:00Z',
      ...(scenes
        ? {
            activeEngineeringState: {
              id: 'engineering-1',
              novelId: 'novel-1',
              chapterId: 'chapter-1',
              chapterCard: {
                chapterTitle: '第十二章',
                volumeTitle: '',
                chapterGoal: '',
                openingState: '',
                endingState: '',
                appearingCharacters: [],
                viewpointCharacter: '',
                primaryLocation: '',
                coreConflict: '',
                mustHappenEvents: [],
                forbiddenEvents: [],
                knownInformation: [],
                unknownInformation: [],
                releasedInformation: [],
                reservedMysteries: [],
                emotionalCurve: '',
                endingHook: '',
                styleRequirements: [],
                forbiddenWriting: [],
              },
              scenePlan: scenes,
              generationConstraints: {
                mustFollow: [],
                forbiddenChanges: [],
                forbiddenAdditions: [],
                forbiddenEarlyEvents: [],
                forbiddenEarlyReveals: [],
                bannedWords: [],
                bannedSentencePatterns: [],
                narrativePerson: '',
                wordRange: {},
                pacingRequirement: '',
                dialogueRatio: '',
                descriptionRatio: '',
                combatStyle: '',
                informationReleaseMode: '',
              },
              qualityRules: {
                enabledChecks: [],
                strictness: 'normal',
                manualReviewRequired: true,
                customRules: [],
                autoFixAllowed: false,
                autoFixForbidden: [],
              },
              draftVersion: 1,
              activeVersion: 1,
              status: 'active',
              createdAt: '2026-10-20T00:00:00Z',
              updatedAt: '2026-10-20T00:00:00Z',
            },
          }
        : {}),
    },
  };
}

test('only an applied Scene-only v2 plan selects staged writing', () => {
  assert.equal(stagedScenePlanFromSnapshot(snapshot(undefined)), undefined);
  assert.equal(
    stagedScenePlanFromSnapshot(
      snapshot([scene(undefined, [{ id: 'b', order: 1, text: '旧', required: true }])]),
    ),
    undefined,
  );
  assert.equal(
    stagedScenePlanFromSnapshot(
      snapshot([scene(2, [{ id: 'b', order: 1, text: '已有', required: true }])]),
    ),
    undefined,
  );
  assert.equal(stagedScenePlanFromSnapshot(snapshot([scene(2, [])]))?.length, 1);
});

test('assembled chapter text must equal the planned beat order', () => {
  const scenes = [{ id: 'scene-1' }, { id: 'scene-2' }];
  const beatPlans = [
    { sceneId: 'scene-1', beats: [{ id: 'beat-1' }] },
    { sceneId: 'scene-2', beats: [{ id: 'beat-2' }] },
  ];
  const prose = [
    { sceneId: 'scene-1', beatId: 'beat-1', text: '先入城。' },
    { sceneId: 'scene-2', beatId: 'beat-2', text: '后接头。' },
  ];
  assert.doesNotThrow(() =>
    assertStagedChapterOrder({ scenes, beatPlans, prose, text: '先入城。\n\n后接头。' }),
  );
  assert.throws(
    () =>
      assertStagedChapterOrder({
        scenes,
        beatPlans,
        prose: [...prose].reverse(),
        text: '后接头。\n\n先入城。',
      }),
    /CHAPTER_WORKFLOW_ORDER_INVALID/,
  );
  assert.throws(
    () =>
      assertStagedChapterOrder({
        scenes,
        beatPlans,
        prose,
        text: '先入城。\n\n后接头。\n\n额外。',
      }),
    /CHAPTER_WORKFLOW_ORDER_INVALID/,
  );
  assert.throws(
    () =>
      assertStagedChapterOrder({
        scenes,
        beatPlans: [beatPlans[0]],
        prose,
        text: '先入城。\n\n后接头。',
      }),
    /CHAPTER_WORKFLOW_ORDER_INVALID/,
  );
});

test('scene 2 is planned from scene 1 prose and does not call a second scene planner', async () => {
  const settings = {
    provider: 'mock',
    modelName: 'fixed',
    runtimeMode: 'mock',
    baseUrl: '',
    apiKey: '',
    temperature: 0,
    maxTokens: 100,
    timeoutSeconds: 1,
  } as AiSettings;
  const scenes = [scene(2, []), { ...scene(2, []), id: 'scene-2', sceneNo: 2, title: '客栈' }];
  const events: string[] = [];
  let prose = '';
  const result = await runWorkbenchStagedChapter({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    operationId: 'op-1',
    attemptId: 'attempt-1',
    settings,
    snapshot: snapshot(scenes),
    checkpoints: new Map(),
    planBeats: async (plan) => {
      events.push(`plan:${plan.scene.id}:${plan.acceptedProse}`);
      const { sceneBeatPlanHash, sceneBeatPlanSources } =
        await import('../generation/chapterWritingWorkflowContext');
      const sources = await sceneBeatPlanSources(
        plan.sourceContext,
        plan.acceptedProse,
        plan.actualEntryState,
      );
      const beats = [
        {
          id: `${plan.scene.id}:beat:1`,
          order: 1,
          text: `推进${plan.scene.title}`,
          required: true,
          startState: '实际入口',
          stateChange: '完成当前变化',
          targetCharacters: 600,
        },
      ];
      return {
        schemaVersion: 1,
        sceneId: plan.scene.id,
        ...sources,
        beats,
        planHash: await sceneBeatPlanHash(plan.scene, {
          schemaVersion: 1,
          sceneId: plan.scene.id,
          ...sources,
          beats,
        }),
        rawText: '',
        execution: {
          persistence: 'ephemeral_browser',
          text: '',
          provider: { text: '', providerId: 'mock', modelId: 'fixed', durationMs: 0 },
        },
        policy: {
          minBeatsPerScene: 1,
          minBeatCharacters: 500,
          maxBeatCharacters: 900,
          maxBeatsPerScene: 6,
          targetCharactersPerBeat: 650,
        },
      };
    },
    writeBeat: async (beat) => {
      events.push(`write:${beat.scene.id}`);
      const text = `${'字'.repeat(600)}${beat.scene.id}`;
      prose = beat.scene.id === 'scene-2' ? beat.fields.context : prose;
      return { text, finishReason: 'stop' };
    },
    validateChapter: () => undefined,
    extractState: async (state) => ({
      schemaVersion: 1,
      sourceTextHash: state.sourceTextHash,
      actualStateChange: [
        {
          text: '原文记录',
          epistemic: 'explicit',
          evidence: [{ start: 0, end: 1, quote: state.prose.slice(0, 1) }],
        },
      ],
      endState: {
        text: '原文记录',
        epistemic: 'explicit',
        evidence: [{ start: 0, end: 1, quote: state.prose.slice(0, 1) }],
      },
      unknowns: ['仍未知'],
      semanticValidation: 'not_checked',
    }),
  });
  assert.ok(
    events.indexOf('plan:scene-2:' + '字'.repeat(600) + 'scene-1') >
      events.indexOf('write:scene-1'),
  );
  assert.equal(events.filter((event) => event.startsWith('plan:')).length, 2);
  assert.match(result.text, /scene-1/);
  assert.match(result.text, /scene-2/);
  assert.match(prose, /scene-1/);
});
