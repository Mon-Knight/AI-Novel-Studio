import assert from 'node:assert/strict';
import test from 'node:test';
import { validateActualBeatState } from '../generation/chapterWritingState';
import { sha256 } from './compilation/canonical';
import { MockAiClient } from './mockAiClient';

const client = new MockAiClient();

function scenePlanMessages(targetWords: number) {
  return [
    {
      role: 'system' as const,
      content: '你是章节 Scene 规划器，只生成 Scene。',
    },
    {
      role: 'user' as const,
      content: [
        '请根据 Context 为当前章节生成可人工确认的 Scene-only 候选规划。',
        '本轮不得输出 beats 字段。',
        '章节：第十二章 城门',
        `章节目标字数：${targetWords}`,
      ].join('\n'),
    },
  ];
}

function beatPlanMessages(sourceContext: string, actualEntryState: string) {
  const context = JSON.stringify({
    scene: {
      id: 'scene-2',
      sceneNo: 2,
      title: '客栈接头',
      goal: '确认接头暗号并取得线索',
    },
    actual: { actualEntryState },
  });
  return [
    {
      role: 'system' as const,
      content: [
        '你是当前 Scene Beat 规划器，只规划当前 Scene 的 Beats。',
        '【编译上下文】',
        `## 当前 Scene 与实际已写状态\n${context}`,
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        '请只规划 Context 中当前这一个 Scene 的 Beats。',
        'JSON 顶层必须是 {"beats": [...]}，且必须恰好包含 3 个有序 Beat。',
        '当前 Scene：2（scene-2）',
        `基线 SHA-256：${sourceContext}`,
      ].join('\n'),
    },
  ];
}

function stateMessages(prose: string, previousState: string) {
  return [
    {
      role: 'system' as const,
      content: [
        '你是未采用候选正文状态提取器，只提取当前 Beat 的实际状态。',
        '【编译上下文】',
        `## 当前 Beat 正文与进入前的实际状态\n${JSON.stringify({ previousState, prose })}`,
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: '只输出 JSON；语义一致性不由你证明。',
    },
  ];
}

test('mock v2 Scene plan is Scene-only and distributes the exact chapter target', async () => {
  const response = await client.generate({
    taskType: 'chapter_scene_plan_v2_generate',
    messages: scenePlanMessages(2_500),
  });
  const plan = JSON.parse(response.text) as {
    scenes: Array<{ targetCharacters: number; beats?: unknown; contextCapsule: string }>;
  };
  assert.equal(plan.scenes.length, 2);
  assert.equal(
    plan.scenes.reduce((sum, scene) => sum + scene.targetCharacters, 0),
    2_500,
  );
  assert.equal(
    plan.scenes.some((scene) => 'beats' in scene),
    false,
  );
  assert.ok(plan.scenes.every((scene) => scene.contextCapsule.length > 0));
  assert.ok(plan.scenes.every((scene) => scene.targetCharacters >= 500));

  const oddResponse = await client.generate({
    taskType: 'chapter_scene_plan_v2_generate',
    messages: scenePlanMessages(2_501),
  });
  const oddPlan = JSON.parse(oddResponse.text) as {
    scenes: Array<{ targetCharacters: number }>;
  };
  assert.equal(
    oddPlan.scenes.reduce((sum, scene) => sum + scene.targetCharacters, 0),
    2_501,
  );
});

test('mock v2 Scene plan uses one feasible Scene or fails instead of faking prose length', async () => {
  const single = await client.generate({
    taskType: 'chapter_scene_plan_v2_generate',
    messages: scenePlanMessages(700),
  });
  const plan = JSON.parse(single.text) as { scenes: Array<{ targetCharacters: number }> };
  assert.equal(plan.scenes.length, 1);
  assert.equal(plan.scenes[0].targetCharacters, 700);

  await assert.rejects(
    client.generate({
      taskType: 'chapter_scene_plan_v2_generate',
      messages: scenePlanMessages(400),
    }),
    /至少一个合法 Beat/u,
  );
});

test('mock Beat plan emits exactly the requested ordered Beats from actual entry state', async () => {
  const response = await client.generate({
    taskType: 'chapter_beat_plan_generate',
    messages: beatPlanMessages('a'.repeat(64), '沈岚刚踏进客栈，尚未确认掌柜身份。'),
  });
  const payload = JSON.parse(response.text) as {
    beats: Array<{
      order: number;
      text: string;
      required: boolean;
      startState: string;
      stateChange: string;
    }>;
  };
  assert.equal(payload.beats.length, 3);
  assert.deepEqual(
    payload.beats.map((beat) => beat.order),
    [1, 2, 3],
  );
  assert.equal(payload.beats[0].startState, '沈岚刚踏进客栈，尚未确认掌柜身份。');
  assert.ok(
    payload.beats.every(
      (beat, index) =>
        beat.order === index + 1 &&
        typeof beat.required === 'boolean' &&
        beat.required &&
        beat.text.length > 0 &&
        beat.startState.length > 0 &&
        beat.stateChange.length > 0,
    ),
  );
});

test('mock Beat plan fails closed when the requested count is absent', async () => {
  await assert.rejects(
    client.generate({
      taskType: 'chapter_beat_plan_generate',
      messages: [{ role: 'user', content: '请规划当前 Scene 的 Beats，但没有数量。' }],
    }),
    /targetBeatCount/u,
  );
});

test('mock state extraction quotes the exact actual prose at UTF-16 offsets', async () => {
  const prose = '守卫收起了通行证，只准沈岚徒步进城。沈岚摸着空衣袋，仍不知道接头人的姓名。';
  const response = await client.generate({
    taskType: 'chapter_beat_state_extract',
    messages: stateMessages(prose, '沈岚抵达城门外。'),
  });
  const state = JSON.parse(response.text) as {
    schemaVersion: number;
    sourceTextHash: string;
    actualStateChange: Array<{
      text: string;
      epistemic: string;
      evidence: Array<{ start: number; end: number; quote: string }>;
    }>;
    endState: unknown;
    unknowns: unknown[];
    semanticValidation: string;
  };
  const evidence = state.actualStateChange[0].evidence[0];
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.sourceTextHash, await sha256(prose));
  assert.equal(prose.slice(evidence.start, evidence.end), evidence.quote);
  assert.ok(evidence.quote.length > 0);
  assert.equal(state.semanticValidation, 'not_checked');
  assert.deepEqual(state.unknowns, []);
  assert.ok(state.endState);

  const validated = await validateActualBeatState(state, prose);
  assert.equal(validated.sourceTextHash, state.sourceTextHash);
  assert.equal(validated.actualStateChange[0].text, state.actualStateChange[0].text);
});

test('mock state extraction derives different grounded results for different prose', async () => {
  const firstProse = '城门在雨里显得更低。守卫抬手拦住来人。';
  const secondProse = '客栈的门轴响了一声。掌柜从柜台后抬起眼。';
  const first = JSON.parse(
    (
      await client.generate({
        taskType: 'chapter_beat_state_extract',
        messages: stateMessages(firstProse, ''),
      })
    ).text,
  ) as { sourceTextHash: string; actualStateChange: Array<{ evidence: Array<{ quote: string }> }> };
  const second = JSON.parse(
    (
      await client.generate({
        taskType: 'chapter_beat_state_extract',
        messages: stateMessages(secondProse, ''),
      })
    ).text,
  ) as { sourceTextHash: string; actualStateChange: Array<{ evidence: Array<{ quote: string }> }> };
  assert.notEqual(first.sourceTextHash, second.sourceTextHash);
  assert.notEqual(
    first.actualStateChange[0].evidence[0].quote,
    second.actualStateChange[0].evidence[0].quote,
  );
  assert.ok(firstProse.includes(first.actualStateChange[0].evidence[0].quote));
  assert.ok(secondProse.includes(second.actualStateChange[0].evidence[0].quote));
});

test('mock state extraction fails closed when the Context has no prose', async () => {
  await assert.rejects(
    client.generate({
      taskType: 'chapter_beat_state_extract',
      messages: [
        {
          role: 'system',
          content: '【编译上下文】\n## 状态\n{"previousState":"沈岚抵达城门外。"}',
        },
      ],
    }),
    /缺少当前 Beat 正文/u,
  );
});
