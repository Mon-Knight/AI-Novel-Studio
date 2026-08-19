import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHAPTER_SCENE_PLAN_ATTEMPTS,
  expectedChapterBeatCount,
  isRetryableChapterScenePlanError,
  parseChapterScenePlanCandidate,
  validateChapterSceneBeatEnvelope,
} from './chapterScenePlanService';
import {
  CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS,
  CHAPTER_SCENE_PLAN_TEMPERATURE,
  chapterScenePlanThinkingModeForModel,
} from './chapterScenePlanPolicy';

test('Scene/Beat planner parser accepts JSON fences and keeps candidate array', () => {
  const fenced =
    '\x60\x60\x60json\n{"scenes":[{"sceneNo":1,"title":"车站","beats":[{"order":1,"text":"发现怀表","required":true}]}]}\n\x60\x60\x60';
  const parsed = parseChapterScenePlanCandidate(fenced);
  assert.equal(parsed?.scenes.length, 1);
});

test('Scene/Beat planner parser rejects prose without a scenes array', () => {
  assert.equal(parseChapterScenePlanCandidate('这不是 JSON'), undefined);
  assert.equal(parseChapterScenePlanCandidate('{"items":[]}'), undefined);
});

test('Scene/Beat planner maps a 2500-word chapter to four one-call Beat units', () => {
  assert.equal(expectedChapterBeatCount({ targetWordCount: 2500 }), 4);
  assert.doesNotThrow(() =>
    validateChapterSceneBeatEnvelope(
      [
        { sceneNo: 1, beats: [{}, {}] },
        { sceneNo: 2, beats: [{}, {}] },
      ],
      { targetWordCount: 2500 },
    ),
  );
  assert.throws(
    () =>
      validateChapterSceneBeatEnvelope([{ sceneNo: 1, beats: [{}, {}, {}, {}] }], {
        targetWordCount: 2500,
      }),
    /每个 Scene 必须包含 1–3 个 Beat/,
  );
  assert.throws(
    () =>
      validateChapterSceneBeatEnvelope(
        [
          { sceneNo: 1, beats: [{}, {}] },
          { sceneNo: 2, beats: [{}] },
        ],
        { targetWordCount: 2500 },
      ),
    /必须规划 4 个 Beat/,
  );
});

test('Scene/Beat planner bounds compact output and disables DeepSeek V4 thinking', () => {
  assert.equal(CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS, 4_096);
  assert.equal(CHAPTER_SCENE_PLAN_TEMPERATURE, 0.4);
  assert.equal(MAX_CHAPTER_SCENE_PLAN_ATTEMPTS, 3);
  assert.equal(chapterScenePlanThinkingModeForModel('deepseek-v4-flash'), 'disabled');
  assert.equal(chapterScenePlanThinkingModeForModel('deepseek-v4-pro-2026-07'), 'disabled');
  assert.equal(chapterScenePlanThinkingModeForModel('other-openai-compatible-model'), undefined);
  assert.equal(
    isRetryableChapterScenePlanError(
      new Error('AI 调用失败：模型在输出 Token 上限处停止，响应内容不完整且未采纳。'),
    ),
    true,
  );
  assert.equal(
    isRetryableChapterScenePlanError({
      code: 'AI_PROVIDER_SERVER_ERROR',
      message: 'AI 调用失败：模型服务错误（503）',
      retryable: true,
    }),
    true,
  );
  assert.equal(isRetryableChapterScenePlanError(new Error('请求参数不合法')), false);
});
