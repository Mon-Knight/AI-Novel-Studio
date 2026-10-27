import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import type { AiExecutionResult } from './aiExecutionPipeline';
import { AiRequestCancelledError } from './aiCancellation';
import type { ChapterPlanningTaskExecutor } from './chapterPlanningCandidate';
import { sha256 } from './compilation/canonical';
import {
  CHAPTER_BEAT_STATE_EXTRACT_TASK_TYPE,
  extractActualBeatState,
  type ExtractActualBeatStateInput,
} from './chapterBeatStateService';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'state-test-secret',
  modelName: 'deepseek-v4-flash',
  temperature: 0.15,
  maxTokens: 2048,
  timeoutSeconds: 30,
  mockMode: false,
};

const prose = '守卫收起了通行证，只准沈岚徒步进城。沈岚摸着空衣袋，仍不知道接头人的姓名。';

async function validPayload() {
  const quote = '守卫收起了通行证';
  const start = prose.indexOf(quote);
  const fact = {
    text: '通行证留在守卫手中。',
    epistemic: 'explicit' as const,
    evidence: [{ start, end: start + quote.length, quote }],
  };
  return {
    schemaVersion: 1,
    sourceTextHash: await sha256(prose),
    actualStateChange: [fact],
    endState: fact,
    unknowns: ['接头人的姓名仍未知。'],
    semanticValidation: 'not_checked' as const,
  };
}

function executionResult(text: string, payload?: unknown): AiExecutionResult {
  return {
    persistence: 'ephemeral_browser',
    text,
    ...(payload === undefined ? {} : { structuredPayloadJson: payload }),
    provider: {
      text,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      durationMs: 1,
    },
  };
}

function baseInput(
  execute: ChapterPlanningTaskExecutor,
  overrides: Partial<ExtractActualBeatStateInput> = {},
): ExtractActualBeatStateInput {
  return {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    operationId: 'beat-state-1',
    settings,
    prose,
    previousState: '沈岚抵达城门外，木匣仍在手中。',
    sceneNo: 1,
    beatOrder: 2,
    execute,
    ...overrides,
  };
}

test('extractActualBeatState sends only actual prose and the previous state', async () => {
  let captured: Parameters<ChapterPlanningTaskExecutor>[0] | undefined;
  const execute: ChapterPlanningTaskExecutor = async (input) => {
    captured = input;
    const payload = await validPayload();
    return executionResult(JSON.stringify(payload), payload);
  };

  const result = await extractActualBeatState(baseInput(execute));

  assert.equal(result.state.actualStateChange[0].text, '通行证留在守卫手中。');
  assert.equal(result.state.sourceTextHash, await sha256(prose));
  assert.equal(result.execution.text.includes('sourceTextHash'), true);
  assert.equal(captured?.taskType, CHAPTER_BEAT_STATE_EXTRACT_TASK_TYPE);
  assert.equal(captured?.scopeType, 'chapter');
  assert.equal(captured?.novelId, 'novel-1');
  assert.equal(captured?.chapterId, 'chapter-1');
  assert.equal(captured?.operationId, 'beat-state-1');
  assert.ok(captured);
  assert.equal(captured.compilation.sources.length, 1);
  const source = captured.compilation.sources[0];
  assert.equal(source.sourceType, 'request_context');
  assert.equal(source.sourceVersion, await sha256(prose));
  assert.equal(source.required, true);
  assert.equal(source.requireFull, true);
  const context = JSON.parse(source.content) as Record<string, unknown>;
  assert.deepEqual(Object.keys(context), ['previousState', 'prose']);
  assert.equal(context.prose, prose);
  assert.equal(context.previousState, '沈岚抵达城门外，木匣仍在手中。');
  assert.equal('plan' in context, false);
  assert.equal('expectedEndState' in context, false);
  assert.equal('scenes' in context, false);
  assert.equal(captured.compilation.taskInput?.sourceTextHash, await sha256(prose));
  assert.equal(captured.compilation.taskInput?.sceneNo, 1);
  assert.equal(captured.compilation.taskInput?.beatOrder, 2);
});

test('missing previous state is explicit null rather than plan-derived text', async () => {
  let sourceContent = '';
  const execute: ChapterPlanningTaskExecutor = async (input) => {
    sourceContent = input.compilation.sources[0].content;
    const payload = await validPayload();
    return executionResult(JSON.stringify(payload), payload);
  };
  await extractActualBeatState(baseInput(execute, { previousState: undefined }));
  const context = JSON.parse(sourceContent) as Record<string, unknown>;
  assert.equal(context.previousState, null);
});

test('rejects structurally incomplete model output without retrying', async () => {
  let calls = 0;
  const execute: ChapterPlanningTaskExecutor = async () => {
    calls += 1;
    return executionResult('{}', {});
  };
  await assert.rejects(extractActualBeatState(baseInput(execute)), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'CHAPTER_BEAT_STATE_INVALID');
    return true;
  });
  assert.equal(calls, 1);
});

test('rejects non-JSON output instead of filling state from prose or plan', async () => {
  let calls = 0;
  const execute: ChapterPlanningTaskExecutor = async () => {
    calls += 1;
    return executionResult('这不是 JSON');
  };
  await assert.rejects(extractActualBeatState(baseInput(execute)), /未返回有效的实际状态 JSON/u);
  assert.equal(calls, 1);
});

test('rejects missing arrays, missing unknowns and false semantic claims', async () => {
  const payload = await validPayload();
  const missingUnknowns = { ...payload, unknowns: undefined };
  const missingEndState = { ...payload, endState: undefined };
  const semanticClaim = { ...payload, semanticValidation: 'passed' };
  for (const candidate of [missingUnknowns, missingEndState, semanticClaim]) {
    const execute: ChapterPlanningTaskExecutor = async () =>
      executionResult(JSON.stringify(candidate), candidate);
    await assert.rejects(extractActualBeatState(baseInput(execute)), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'CHAPTER_BEAT_STATE_INVALID');
      return true;
    });
  }
});

test('rejects unknown end state without an explicit unknown list', async () => {
  const payload = {
    ...(await validPayload()),
    actualStateChange: [],
    endState: null,
    unknowns: [],
  };
  const execute: ChapterPlanningTaskExecutor = async () =>
    executionResult(JSON.stringify(payload), payload);
  await assert.rejects(extractActualBeatState(baseInput(execute)), /说明未知项/u);
});

test('rejects a source hash that does not bind the exact Beat prose', async () => {
  const payload = await validPayload();
  payload.sourceTextHash = await sha256(`${prose}改动`);
  const execute: ChapterPlanningTaskExecutor = async () =>
    executionResult(JSON.stringify(payload), payload);
  await assert.rejects(extractActualBeatState(baseInput(execute)), /状态来源正文哈希不匹配/u);
});

test('rejects evidence that does not match UTF-16 positions in the Beat prose', async () => {
  const payload = await validPayload();
  payload.actualStateChange[0].evidence[0].start += 1;
  const execute: ChapterPlanningTaskExecutor = async () =>
    executionResult(JSON.stringify(payload), payload);
  await assert.rejects(extractActualBeatState(baseInput(execute)), /逐字匹配/u);
});

test('propagates cancellation before any Provider work and after a late result', async () => {
  let calls = 0;
  const execute: ChapterPlanningTaskExecutor = async () => {
    calls += 1;
    const payload = await validPayload();
    return executionResult(JSON.stringify(payload), payload);
  };
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    extractActualBeatState(baseInput(execute, { signal: aborted.signal })),
    (error: unknown) => error instanceof AiRequestCancelledError,
  );
  assert.equal(calls, 0);

  const late = new AbortController();
  const lateExecute: ChapterPlanningTaskExecutor = async () => {
    calls += 1;
    late.abort();
    const payload = await validPayload();
    return executionResult(JSON.stringify(payload), payload);
  };
  await assert.rejects(
    extractActualBeatState(baseInput(lateExecute, { signal: late.signal })),
    (error: unknown) => error instanceof AiRequestCancelledError,
  );
  assert.equal(calls, 1);
});

test('rejects empty prose before calling the executor', async () => {
  let calls = 0;
  const execute: ChapterPlanningTaskExecutor = async () => {
    calls += 1;
    return executionResult('{}', {});
  };
  await assert.rejects(
    extractActualBeatState(baseInput(execute, { prose: '   ' })),
    /当前 Beat 正文 不能为空/u,
  );
  assert.equal(calls, 0);
});

test('rejects invalid scene or Beat identifiers before calling the executor', async () => {
  let calls = 0;
  const execute: ChapterPlanningTaskExecutor = async () => {
    calls += 1;
    return executionResult('{}', {});
  };
  await assert.rejects(
    extractActualBeatState(baseInput(execute, { sceneNo: 0 })),
    /sceneNo 必须是正整数/u,
  );
  await assert.rejects(
    extractActualBeatState(baseInput(execute, { beatOrder: 1.5 })),
    /beatOrder 必须是正整数/u,
  );
  assert.equal(calls, 0);
});

test('does not expose formal write authority or planned state on the result', async () => {
  const execute: ChapterPlanningTaskExecutor = async () => {
    const payload = await validPayload();
    return executionResult(JSON.stringify(payload), payload);
  };
  const result = await extractActualBeatState(baseInput(execute));
  assert.deepEqual(Object.keys(result).sort(), ['execution', 'state']);
  assert.equal(result.state.semanticValidation, 'not_checked');
  assert.equal(result.state.endState?.text, '通行证留在守卫手中。');
});
