import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultScenePlan,
  isScenePlanV2,
  normalizeChapterEngineeringState,
  normalizeScenePlan,
  normalizeScenePlanV2,
} from './chapterEngineeringService';

test('legacy ScenePlan fields are normalized into ordered scene-local Beats', () => {
  const scenes = normalizeScenePlan([
    {
      id: 'legacy',
      sceneNo: 4,
      title: '旧场景',
      location: '',
      characters: [],
      goal: '完成目标',
      conflict: '',
      keyActions: ['发现入口', '进入房间'],
      keyDialogue: '“你来了。”',
      informationRelease: ['门后有脚步声'],
      result: '角色确认有人在场',
      transition: '转入下一场景',
    },
  ]);

  assert.equal(scenes[0].sceneNo, 1);
  assert.deepEqual(
    scenes[0].beats.map((beat) => ({
      order: beat.order,
      text: beat.text,
      required: beat.required,
    })),
    [
      { order: 1, text: '发现入口', required: true },
      { order: 2, text: '进入房间', required: true },
      { order: 3, text: '关键对白：“你来了。”', required: true },
      { order: 4, text: '释放信息：门后有脚步声', required: true },
      { order: 5, text: '场景结果：角色确认有人在场', required: true },
      { order: 6, text: '场景转场：转入下一场景', required: true },
    ],
  );
});

test('SceneBeat order is sorted and normalized while optional metadata survives', () => {
  const [scene] = normalizeScenePlan([
    {
      id: 'ordered',
      sceneNo: 2,
      title: '有序场景',
      location: '',
      characters: [],
      goal: '',
      conflict: '',
      keyActions: [],
      keyDialogue: '',
      informationRelease: [],
      result: '',
      transition: '',
      beats: [
        { id: 'b2', order: 20, text: '第二步', required: false, stateChange: '门已打开' },
        { id: 'b1', order: 1, text: '第一步', required: true, characterIds: ['c1'] },
      ],
      constraints: ['保持第三人称'],
      contextCapsule: '人物刚抵达门前。',
      expectedEndState: '人物进入门内。',
      targetCharacters: 600,
    },
  ]);

  assert.deepEqual(
    scene.beats.map((beat) => beat.order),
    [1, 2],
  );
  assert.equal(scene.beats[0].text, '第一步');
  assert.deepEqual(scene.beats[0].characterIds, ['c1']);
  assert.equal(scene.beats[1].required, false);
  assert.equal(scene.beats[1].stateChange, '门已打开');
  assert.deepEqual(scene.constraints, ['保持第三人称']);
  assert.equal(scene.contextCapsule, '人物刚抵达门前。');
  assert.equal(scene.expectedEndState, '人物进入门内。');
  assert.equal(scene.targetCharacters, 600);
});

test('Scene-only v2 plans never legacy-back-fill Beats', () => {
  const scenes = normalizeScenePlan([
    {
      id: 'v2-scene',
      sceneNo: 1,
      title: '城门盘查',
      location: '城门',
      characters: ['沈岚'],
      goal: '通过盘查',
      conflict: '守卫索要路引',
      keyActions: ['递上路引', '被要求开箱'],
      keyDialogue: '“打开箱子。”',
      informationRelease: ['路引上的印章有异'],
      result: '主角进入城内',
      transition: '转入客栈',
      contextCapsule: '沈岚带着一只不能示人的木匣抵达城门。',
      constraints: ['保持第三人称限知'],
      expectedEndState: '沈岚进入城门，但守卫记住了她的脸。',
      targetCharacters: 900,
      planVersion: 2,
      beats: [],
    },
  ]);

  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].planVersion, 2);
  assert.equal(isScenePlanV2(scenes[0]), true);
  assert.deepEqual(scenes[0].beats, []);
  assert.equal(scenes[0].targetCharacters, 900);
});

test('Scene-only v2 normalizer forces the version marker on every Scene', () => {
  const scenes = normalizeScenePlanV2([
    { id: 'a', sceneNo: 2, title: '第二场', goal: '目标', beats: [] },
    { id: 'b', sceneNo: 1, title: '第一场', goal: '目标', beats: [] },
  ]);

  assert.deepEqual(
    scenes.map((scene) => scene.sceneNo),
    [1, 2],
  );
  assert.deepEqual(
    scenes.map((scene) => scene.planVersion),
    [2, 2],
  );
  assert.deepEqual(
    scenes.map((scene) => scene.beats),
    [[], []],
  );
});

test('Beat plan metadata survives normalization without weakening legacy plans', () => {
  const [scene] = normalizeScenePlan([
    {
      id: 'beat-metadata',
      sceneNo: 1,
      title: '场景',
      goal: '目标',
      beats: [
        {
          id: 'b1',
          order: 1,
          text: '推门进入',
          required: true,
          startState: '门外无人',
          stateChange: '进入室内',
          targetCharacters: 700,
        },
      ],
    },
  ]);

  assert.equal(scene.beats[0].startState, '门外无人');
  assert.equal(scene.beats[0].stateChange, '进入室内');
  assert.equal(scene.beats[0].targetCharacters, 700);
  assert.equal(scene.planVersion, undefined);

  const [defaultScene] = createDefaultScenePlan({ title: '第一章', goal: '找到线索' });
  assert.equal(isScenePlanV2(defaultScene), false);
});

test('default scene always carries a usable local Beat', () => {
  const [scene] = createDefaultScenePlan({ title: '第一章', goal: '找到线索' });
  assert.equal(scene.beats.length, 1);
  assert.match(scene.beats[0].text, /找到线索/);
  assert.equal(scene.beats[0].required, true);
});
test('Tauri camelCase JSON fields preserve persisted engineering state', () => {
  const legacyReservedMysteriesKey = ['reserved', 'Secrets'].join('');
  const state = normalizeChapterEngineeringState({
    id: 'engineering-db',
    novelId: 'novel-db',
    chapterId: 'chapter-db',
    chapterCardJson: JSON.stringify({
      chapterTitle: 'Persisted chapter',
      chapterGoal: 'Persisted goal',
      [legacyReservedMysteriesKey]: ['不要提前揭示来信作者'],
    }),
    scenePlanJson: JSON.stringify([
      {
        id: 'scene-db',
        sceneNo: 1,
        title: 'Persisted scene',
        goal: 'Persisted scene goal',
        beats: [],
      },
    ]),
    generationConstraintsJson: JSON.stringify({ mustFollow: ['Persisted rule'] }),
    qualityRulesJson: JSON.stringify({ strictness: 'strict' }),
    draftVersion: 4,
    activeVersion: 4,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  assert.ok(state);
  assert.equal(state.chapterCard.chapterTitle, 'Persisted chapter');
  assert.equal(state.chapterCard.chapterGoal, 'Persisted goal');
  assert.deepEqual(state.chapterCard.reservedMysteries, ['不要提前揭示来信作者']);
  assert.equal(state.scenePlan[0].title, 'Persisted scene');
  assert.equal(state.scenePlan[0].goal, 'Persisted scene goal');
  assert.equal(state.scenePlan[0].beats.length, 0);
  assert.deepEqual(state.generationConstraints.mustFollow, ['Persisted rule']);
  assert.equal(state.qualityRules.strictness, 'strict');
});
