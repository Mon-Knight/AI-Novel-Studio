import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chapterRequiredError,
  classifyWorkbenchFailure,
  formatWorkbenchFailure,
} from './workbenchFailure';

test('classifies missing chapter, candidate, service and model failures', () => {
  assert.equal(classifyWorkbenchFailure(chapterRequiredError()).code, 'WORKBENCH_CHAPTER_REQUIRED');
  assert.equal(
    classifyWorkbenchFailure(new Error('candidateText must be a non-empty string')).layer,
    'parameter',
  );
  assert.equal(classifyWorkbenchFailure(new Error('chapter not found in novel')).layer, 'data');
  assert.equal(
    classifyWorkbenchFailure(new Error('generate_chapter 缺少实际治理请求身份')).layer,
    'service',
  );
  const compatibility = classifyWorkbenchFailure(
    new Error('MODEL_TOOL_CALLING_NOT_VERIFIED: NO_TOOL_CALL'),
  );
  assert.equal(compatibility.code, 'MODEL_TOOL_CALLING_NOT_VERIFIED');
  assert.match(compatibility.message, /工具调用能力验证/);
  assert.match(compatibility.hint, /重试验证/);
  assert.equal(classifyWorkbenchFailure(new Error('模型拒绝输出')).layer, 'model');
  assert.match(formatWorkbenchFailure(chapterRequiredError()), /选择目标章节/);
});

test('classifies generation readiness failures as project data problems', () => {
  const readinessError = Object.assign(
    new Error('生成正文前请先补齐：章节大纲、世界设定、主角设定。'),
    { code: 'GENERATION_CORE_ASSETS_MISSING' },
  );
  const readiness = classifyWorkbenchFailure(readinessError);
  assert.equal(readiness.layer, 'data');
  assert.equal(readiness.code, 'GENERATION_CORE_ASSETS_MISSING');
  assert.match(readiness.hint, /作品详情/);
  assert.doesNotMatch(readiness.hint, /模型/);

  for (const fixture of [
    {
      code: 'WORKBENCH_PREVIOUS_CHAPTER_NOT_ADOPTED',
      message: '上一章尚未采用为正式正文。',
      hint: /审阅与采用/,
    },
    {
      code: 'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE',
      message: '上一章的已采用正文为空或不可读取。',
      hint: /恢复上一章/,
    },
  ]) {
    const failure = classifyWorkbenchFailure(
      Object.assign(new Error(fixture.message), { code: fixture.code }),
    );
    assert.equal(failure.layer, 'data');
    assert.equal(failure.code, fixture.code);
    assert.match(failure.hint, fixture.hint);
    assert.doesNotMatch(failure.hint, /换模型/);
  }
});

test('classifies unsafe retry targets as persisted data failures', () => {
  for (const code of [
    'WORKBENCH_RETRY_TARGET_MISSING',
    'WORKBENCH_RETRY_TARGET_CONFLICT',
    'WORKBENCH_RETRY_TARGET_INVALID',
  ]) {
    const failure = classifyWorkbenchFailure(
      Object.assign(new Error('原运行章节目标无法安全恢复。'), { code }),
    );
    assert.equal(failure.layer, 'data');
    assert.equal(failure.code, code);
    assert.match(failure.hint, /重新发送/);
    assert.doesNotMatch(failure.hint, /换模型/);
  }
});
