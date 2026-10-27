import assert from 'node:assert/strict';
import type { ScenePlanItem } from '../../types/chapterEngineering';
import type {
  ChapterWritingWorkflowCheckpoint,
  SceneBeatPlan,
} from '../../types/chapterWritingWorkflow';
import { canonicalHash, sha256 } from '../../services/ai/compilation/canonical';
import {
  sceneBeatPlanHash,
  sceneBeatPlanSources,
} from '../../services/generation/chapterWritingWorkflowContext';
import type {
  ChapterWritingWorkflowPorts,
  RunChapterWritingWorkflowInput,
} from '../../services/generation/chapterWritingWorkflowPorts';

export function workflowScene(index: number): ScenePlanItem {
  return {
    id: `scene-${index}`,
    sceneNo: index,
    title: index === 1 ? '城门盘查' : '客栈接头',
    location: index === 1 ? '城门' : '客栈',
    characters: ['沈岚'],
    goal: `完成场景${index}`,
    conflict: '身份受到怀疑',
    keyActions: [],
    keyDialogue: '',
    informationRelease: [],
    result: '计划假结果：持有正式通行证',
    transition: '转入下一场',
    beats: [],
    planVersion: 2,
    contextCapsule: '计划假入口：证件齐全',
    expectedEndState: '计划假结果：持证入住',
    constraints: ['不得提前揭露接头人的身份'],
    targetCharacters: 600,
  };
}

export async function workflowFixture() {
  const sourceContext =
    '前章正式采用稿：沈岚抵达城门。规则：没有证件不能住宿。视角人物尚不知接头人姓名。';
  const input: RunChapterWritingWorkflowInput = {
    identity: {
      schemaVersion: 'chapter_writing_workflow_v1',
      workflowId: 'user-turn-1',
      novelId: 'novel-1',
      chapterId: 'chapter-12',
      contextHash: await sha256(sourceContext),
      modelSnapshotHash: await canonicalHash({ model: 'fixed-test-model' }),
    },
    attemptId: 'attempt-1',
    sourceContext,
    targetCharacters: 1200,
    chapterConstraints: ['不得无来源获得信息'],
    budget: { maxCalls: 20, maxWallClockMs: 480_000, maxBeatAttempts: 2, maxBeats: 8 },
  };
  const events: string[] = [];
  const entries: string[] = [];
  const controls = {
    clock: 1000,
    failState: 0,
    rejectBeat: 0,
    abortWriter: undefined as AbortController | undefined,
    writerDelay: 0,
    writeCount: 0,
    extractCount: 0,
  };
  let saved: ChapterWritingWorkflowCheckpoint | undefined;
  const ports: ChapterWritingWorkflowPorts = {
    load: async () => saved && structuredClone(saved),
    save: async (next, expected) => {
      if (expected === null) assert.equal(saved, undefined);
      else assert.equal(expected, saved?.revision, 'revision compare-and-swap');
      if (saved) {
        assert.equal(next.revision, saved.revision + 1);
        assert.deepEqual(next.identity, saved.identity);
        for (const stage of saved.stages.filter((item) =>
          ['succeeded', 'failed', 'cancelled'].includes(item.status),
        )) {
          assert.deepEqual(
            next.stages.find(
              (item) => item.stageId === stage.stageId && item.attempt === stage.attempt,
            ),
            stage,
            'terminal stage attempts are immutable',
          );
        }
      }
      saved = JSON.parse(JSON.stringify(next)) as ChapterWritingWorkflowCheckpoint;
    },
    assertBaseline: async () => {
      events.push('baseline');
    },
    planScenes: async () => {
      events.push('scene-plan');
      return { schemaVersion: 2, scenes: [workflowScene(1), workflowScene(2)] };
    },
    planBeats: async (value) => {
      events.push(`beat-plan:${value.scene.id}`);
      entries.push(value.actualEntryState);
      const result: Omit<SceneBeatPlan, 'planHash'> = {
        schemaVersion: 1,
        sceneId: value.scene.id,
        ...(await sceneBeatPlanSources(
          value.sourceContext,
          value.acceptedProse,
          value.actualEntryState,
        )),
        beats: [
          {
            id: `${value.scene.id}:beat:1`,
            order: 1,
            text: `推进${value.scene.title}`,
            required: true,
            startState: '以实际入口为准',
            stateChange: `完成${value.scene.title}的当前变化`,
            targetCharacters: 600,
          },
        ],
      };
      return { ...result, planHash: await sceneBeatPlanHash(value.scene, result) };
    },
    writeBeat: async (value) => {
      controls.writeCount += 1;
      events.push(`write:${value.scene.id}`);
      assert.equal(value.fields.beat, value.beat.text);
      assert.equal(value.fields.goal, value.beat.stateChange);
      if (value.scene.sceneNo === 2) assert.match(value.fields.context, /守卫扣下了通行证/);
      controls.clock += controls.writerDelay;
      controls.abortWriter?.abort();
      return {
        text:
          value.scene.sceneNo === 1
            ? '守卫扣下了通行证，只让沈岚徒步进城。'
            : '沈岚说明证件被扣，只能留在客栈门外等候。',
        finishReason: 'stop',
        taskId: `task-${value.scene.id}`,
        artifactId: `artifact-${value.scene.id}`,
      };
    },
    validateBeat: (output) => {
      if (controls.rejectBeat-- > 0) throw new Error('固定的 Beat 验收失败');
      assert.ok(output.text.trim());
      assert.equal(output.finishReason, 'stop');
    },
    extractState: async (value) => {
      controls.extractCount += 1;
      events.push(`state:${value.prose}`);
      if (controls.failState-- > 0) throw new Error('固定的状态服务暂时失败');
      const fact = {
        text: value.prose,
        epistemic: 'explicit',
        evidence: [{ start: 0, end: value.prose.length, quote: value.prose }],
      };
      return {
        schemaVersion: 1,
        sourceTextHash: value.sourceTextHash,
        actualStateChange: [fact],
        endState: fact,
        unknowns: ['接头人的身份仍未知。'],
        semanticValidation: 'not_checked',
      };
    },
    validateChapter: async (text) => {
      events.push('chapter-validation');
      assert.match(text, /守卫扣下了通行证/);
      assert.match(text, /只能留在客栈门外/);
      assert.doesNotMatch(text, /计划假结果/);
    },
    now: () => controls.clock,
  };
  return {
    input,
    ports,
    events,
    entries,
    controls,
    get checkpoint() {
      return saved!;
    },
    replaceCheckpoint: (next: ChapterWritingWorkflowCheckpoint) => {
      saved = structuredClone(next);
    },
  };
}
