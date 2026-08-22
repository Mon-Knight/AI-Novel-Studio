import assert from 'node:assert/strict';
import test from 'node:test';
import { scenePlanFromInput, validateLocalGenerationPlan } from './scenePlanParser';
import type { ChapterGenerationExecutionInput } from '../chapterGenerationExecutionService';

test('scenePlanFromInput parses structured scenes and orders beats', () => {
  const input: ChapterGenerationExecutionInput = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    operationId: 'op-1',
    settings: {} as never,
    request: { taskType: 'chapter_generate', messages: [] },
    sourceId: 'src-1',
    sourceVersion: 'v1',
    taskInput: {
      scenePlan: [
        {
          sceneNo: 2,
          title: '场景 2',
          beats: [
            { order: 2, text: '第二个事件推进' },
            { order: 1, text: '第一个事件推进' },
          ],
        },
        {
          sceneNo: 1,
          title: '场景 1',
          beats: [{ order: 1, text: '开场事件' }],
        },
      ],
    },
  };

  const parsed = scenePlanFromInput(input);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sceneNo, 1);
  assert.equal(parsed[0].title, '场景 1');
  assert.equal(parsed[0].beats.length, 1);
  assert.equal(parsed[0].beats[0].text, '开场事件');

  assert.equal(parsed[1].sceneNo, 2);
  assert.equal(parsed[1].title, '场景 2');
  assert.equal(parsed[1].beats.length, 2);
  assert.equal(parsed[1].beats[0].order, 1);
  assert.equal(parsed[1].beats[0].text, '第一个事件推进');
  assert.equal(parsed[1].beats[1].order, 2);
  assert.equal(parsed[1].beats[1].text, '第二个事件推进');
});

test('scenePlanFromInput provides fallback scene when input scenePlan is empty', () => {
  const input: ChapterGenerationExecutionInput = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    operationId: 'op-1',
    settings: {} as never,
    request: { taskType: 'chapter_generate', messages: [] },
    sourceId: 'src-1',
    sourceVersion: 'v1',
    taskInput: {
      sceneTitle: '默认场景',
      sceneGoal: '推进核心目标',
      sceneBeats: ['事件 A', '事件 B'],
    },
  };

  const parsed = scenePlanFromInput(input);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, '默认场景');
  assert.equal(parsed[0].beats.length, 2);
  assert.equal(parsed[0].beats[0].text, '事件 A');
  assert.equal(parsed[0].beats[1].text, '事件 B');
});

test('validateLocalGenerationPlan rejects scene plans outside 3-5 beat bounds or with >3 beats per scene', () => {
  assert.throws(
    () =>
      validateLocalGenerationPlan([
        { sceneNo: 1, beats: [{ order: 1, text: 'a', required: true }] },
        { sceneNo: 2, beats: [{ order: 1, text: 'b', required: true }] },
      ]),
    /整章必须包含 3–5 个 Beat/,
  );

  assert.throws(
    () =>
      validateLocalGenerationPlan([
        {
          sceneNo: 1,
          beats: [
            { order: 1, text: 'a', required: true },
            { order: 2, text: 'b', required: true },
            { order: 3, text: 'c', required: true },
            { order: 4, text: 'd', required: true },
          ],
        },
      ]),
    /每个 Scene 必须包含 1–3 个 Beat/,
  );

  assert.doesNotThrow(() =>
    validateLocalGenerationPlan([
      {
        sceneNo: 1,
        beats: [
          { order: 1, text: 'a', required: true },
          { order: 2, text: 'b', required: true },
        ],
      },
      {
        sceneNo: 2,
        beats: [
          { order: 1, text: 'c', required: true },
          { order: 2, text: 'd', required: true },
        ],
      },
    ]),
  );
});
