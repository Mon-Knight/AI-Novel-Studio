import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chapterRequiredError,
  classifyWorkbenchFailure,
  formatWorkbenchFailure,
} from './workbenchFailure';

test('a denied model tool is not misclassified as a database persistence or credential error', () => {
  const failure = classifyWorkbenchFailure(
    'DSH 回合失败: session.event rejected: DSH 调用了未授权工具: generate_chapter',
  );
  assert.equal(failure.layer, 'model');
  assert.equal(failure.code, 'DSH_TOOL_NOT_AUTHORIZED');
  assert.match(failure.hint, /失败阶段/);
  assert.doesNotMatch(failure.message + failure.hint, /API Key|数据库/);
});

test('unsafe legacy recovery explains how to explicitly start a new task without claiming recovery', () => {
  for (const code of ['DSH_RETRY_LEGACY_RANGE_MISSING', 'DSH_RETRY_LEGACY_CONTRACT_MISSING']) {
    const failure = classifyWorkbenchFailure(`${code}: 旧执行事实不完整`);
    assert.equal(failure.layer, 'data');
    assert.match(failure.hint, /输入框.*目标章节和字数.*新任务/);
    assert.match(failure.hint, /不会报告为旧回合恢复/);
    assert.doesNotMatch(failure.hint, /API Key|换模型/);
  }
});

test('length rejection gives a recoverable target instruction without suggesting wider acceptance', () => {
  const message = 'DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED: 章节候选3586字超出2400～3450（目标3000）';
  const failure = classifyWorkbenchFailure(message);
  assert.equal(failure.code, 'DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED');
  assert.equal(failure.message, message);
  assert.match(failure.hint, /未生成可采用产物/u);
  assert.match(failure.hint, /有限修正/u);
  assert.match(failure.hint, /本任务目标字数设为3200字/u);
});

test('goal clarification is a parameter decision, not a model retry failure', () => {
  const failure = classifyWorkbenchFailure(
    Object.assign(new Error('请明确本回合动作。'), {
      code: 'WORKBENCH_GOAL_CLARIFICATION_REQUIRED',
    }),
  );
  assert.equal(failure.layer, 'parameter');
  assert.match(failure.hint, /尚未调用模型/);
  assert.doesNotMatch(failure.hint, /换模型/);
});

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

test('attestation failures explain public reasons without echoing provider details', () => {
  for (const [reason, explanation] of [
    ['NO_TOOL_CALL', '没有返回原生工具调用'],
    ['INVALID_TOOL_CALL', '名称、参数或结束状态'],
    ['PROBE_TIMEOUT', '超时'],
    ['PROBE_TRANSPORT_FAILED', '通信失败'],
    ['ATTESTATION_IDENTITY_MISMATCH', '固定模型不一致'],
  ]) {
    const failure = formatWorkbenchFailure(
      `MODEL_TOOL_CALLING_NOT_VERIFIED: ${reason} (API_KEY_SECRET) https://private.example`,
    );
    assert.match(failure, new RegExp(explanation));
    assert.ok(failure.includes(reason));
    assert.doesNotMatch(failure, /API_KEY_SECRET|private\.example/);
  }
  for (const reason of ['UNKNOWN_SECRET', '__proto__', 'constructor']) {
    const failure = formatWorkbenchFailure(`MODEL_TOOL_CALLING_NOT_VERIFIED: ${reason}`);
    assert.doesNotMatch(failure, /原因：|UNKNOWN_SECRET|__proto__|constructor/);
    assert.match(failure, /重试验证/);
  }
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

test('classifies missing frozen-model credentials as a recoverable service failure', () => {
  const failure = classifyWorkbenchFailure(
    Object.assign(
      new Error('当前任务固定模型 openai_compatible:gpt-5.6-luna 的本次会话凭据不可用。'),
      { code: 'WORKBENCH_MODEL_CREDENTIAL_UNAVAILABLE' },
    ),
  );
  assert.equal(failure.layer, 'service');
  assert.equal(failure.code, 'WORKBENCH_MODEL_CREDENTIAL_UNAVAILABLE');
  assert.match(failure.hint, /浏览器凭据只在当前会话内存/);
  assert.doesNotMatch(failure.hint, /API Key\s*[:=]/i);
});

test('classifies incomplete DSH context coverage as a data read failure, not a credential failure', () => {
  const withCode = Object.assign(
    new Error('必需上下文覆盖未完成：旧读取结果没有覆盖凭据，请重新读取'),
    { code: 'DSH_CONTEXT_INCOMPLETE' },
  );
  const failure = classifyWorkbenchFailure(withCode);
  assert.equal(failure.layer, 'data');
  assert.equal(failure.code, 'DSH_CONTEXT_INCOMPLETE');
  assert.match(failure.hint, /重新读取必需上下文/);
  assert.match(failure.hint, /补全或缩小/);
  assert.match(failure.hint, /不是 API Key 凭据错误/);
  assert.doesNotMatch(failure.hint, /检查设置中心/);

  const nativeMessageOnly = classifyWorkbenchFailure(
    'DSH_CONTEXT_INCOMPLETE: 旧读取结果没有覆盖凭据，请重新读取',
  );
  assert.equal(nativeMessageOnly.layer, 'data');
  assert.equal(nativeMessageOnly.code, 'DSH_CONTEXT_INCOMPLETE');
});

test('classifies normalized transient Provider failures as retryable service problems', () => {
  for (const message of [
    'AI 调用失败：模型服务错误（502），请稍后重试。',
    'AI 调用失败：请求过于频繁或额度不足（429 Rate Limit），请稍后重试或检查账户额度。',
    'AI 调用失败：模型服务当前过载（overloaded_error），请稍后重试。',
    'generate_chapter: HTTP_503 Service Unavailable',
  ]) {
    const failure = classifyWorkbenchFailure(new Error(message));
    assert.equal(failure.layer, 'service', message);
    assert.equal(failure.code, 'WORKBENCH_PROVIDER_TRANSIENT', message);
    assert.match(failure.hint, /重试本回合/);
    assert.doesNotMatch(failure.hint, /换模型/);
  }

  for (const code of [
    'AI_PROVIDER_TIMEOUT',
    'AI_PROVIDER_RATE_LIMITED',
    'AI_PROVIDER_SERVER_ERROR',
    'AI_PROVIDER_NETWORK_ERROR',
  ]) {
    const failure = classifyWorkbenchFailure(
      Object.assign(new Error('Provider 暂时不可用。'), { code, retryable: true }),
    );
    assert.equal(failure.layer, 'service', code);
    assert.equal(failure.code, code);
    assert.match(failure.hint, /固定的模型/);
  }

  assert.equal(
    classifyWorkbenchFailure(new Error('AI 调用失败：请求参数不合法（400 Bad Request）。')).layer,
    'model',
  );
});
