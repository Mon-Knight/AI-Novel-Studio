import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startMockWorkbenchUpstream } from './mock-workbench-upstream.mjs';

const running = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

const actualNames = Object.freeze({
  'novel.read_context': 'mcp__novel__novel_read_context_111111111111',
  'chapter.read_outline': 'mcp__novel__chapter_read_outline_222222222222',
  get_character_states: 'mcp__novel__get_character_states',
  search_memory: 'mcp__novel__search_memory_333333333333',
  generate_chapter: 'mcp__novel__generate_chapter_444444444444',
});

const tools = Object.values(actualNames).map((name) => ({
  type: 'function',
  function: { name, description: `fixture ${name}`, parameters: { type: 'object' } },
}));

function requestBody(messages, model = 'deepseek-workbench-test') {
  return {
    model,
    messages,
    tools,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 512,
  };
}

async function start(options = {}) {
  const server = await startMockWorkbenchUpstream({
    port: 0,
    novelId: 'novel-fixture',
    chapterId: 'chapter-fixture',
    candidateText: '夜雨刚停，林默推开旧书店的门。\n\n柜台后的钟正指向零点。',
    ...options,
  });
  running.push(server);
  return server;
}

async function chat(server, messages, options = {}) {
  const response = await fetch(server.chatCompletionsUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer super-secret-never-record',
    },
    body: JSON.stringify(requestBody(messages, options.model)),
    signal: options.signal,
  });
  return response;
}

function parseSse(raw) {
  return raw
    .split(/\r?\n\r?\n/u)
    .flatMap((event) =>
      event
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim()),
    )
    .filter(Boolean)
    .map((data) => (data === '[DONE]' ? data : JSON.parse(data)));
}

function toolCalls(events) {
  return events.flatMap((event) => {
    if (event === '[DONE]') return [];
    return event.choices?.[0]?.delta?.tool_calls ?? [];
  });
}

function finishReason(events) {
  return events
    .filter((event) => event !== '[DONE]')
    .map((event) => event.choices?.[0]?.finish_reason)
    .find((value) => typeof value === 'string');
}

function assistantToolMessage(calls) {
  return {
    role: 'assistant',
    content: '',
    reasoning_content: '',
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.function.name, arguments: call.function.arguments },
    })),
  };
}

function toolResults(calls) {
  return calls.map((call) => ({
    role: 'tool',
    tool_call_id: call.id,
    content: JSON.stringify({ ok: true }),
  }));
}

test('explicit Fetch-forbidden ports fail before the mock starts', async () => {
  await assert.rejects(
    startMockWorkbenchUpstream({ port: 10080 }),
    /MOCK_WORKBENCH_PORT 10080 is forbidden by the Fetch standard/u,
  );
});

test('normal mode derives three Workbench phases from actual wire tool names', async () => {
  const server = await start();
  const initial = [{ role: 'user', content: 'private prompt must not be recorded' }];

  const firstEvents = parseSse(await (await chat(server, initial)).text());
  const firstCalls = toolCalls(firstEvents);
  assert.equal(finishReason(firstEvents), 'tool_calls');
  assert.deepEqual(
    firstCalls.map((call) => call.function.name),
    [
      actualNames['novel.read_context'],
      actualNames['chapter.read_outline'],
      actualNames.get_character_states,
      actualNames.search_memory,
    ],
  );
  assert.deepEqual(JSON.parse(firstCalls[0].function.arguments), {
    novelId: 'novel-fixture',
  });

  const afterContext = [...initial, assistantToolMessage(firstCalls), ...toolResults(firstCalls)];
  const secondEvents = parseSse(await (await chat(server, afterContext)).text());
  const secondCalls = toolCalls(secondEvents);
  assert.equal(secondCalls.length, 1);
  assert.equal(secondCalls[0].function.name, actualNames.generate_chapter);
  assert.deepEqual(JSON.parse(secondCalls[0].function.arguments), {
    novelId: 'novel-fixture',
    chapterId: 'chapter-fixture',
    candidateText: '夜雨刚停，林默推开旧书店的门。\n\n柜台后的钟正指向零点。',
  });

  const afterGenerate = [
    ...afterContext,
    assistantToolMessage(secondCalls),
    ...toolResults(secondCalls),
  ];
  const thirdRaw = await (await chat(server, afterGenerate)).text();
  const thirdEvents = parseSse(thirdRaw);
  assert.equal(finishReason(thirdEvents), 'stop');
  assert.match(thirdRaw, /已完成上下文读取/u);
  const finish = thirdEvents.find((event) => event !== '[DONE]' && event.usage);
  assert.ok(finish.usage.prompt_tokens > 0);
  assert.ok(finish.usage.completion_tokens > 0);
  assert.equal(thirdEvents.at(-1), '[DONE]');

  const health = await (await fetch(server.healthUrl)).json();
  assert.deepEqual(
    {
      ok: health.ok,
      ready: health.ready,
      requestCount: health.requestCount,
      activeRequests: health.activeRequests,
    },
    { ok: true, ready: true, requestCount: 3, activeRequests: 0 },
  );
  const snapshotResponse = await fetch(server.requestsUrl);
  const snapshotText = await snapshotResponse.text();
  const snapshot = JSON.parse(snapshotText);
  assert.deepEqual(
    snapshot.requests.map((request) => request.phase),
    ['context-tools', 'generate-chapter', 'assistant-final'],
  );
  assert.deepEqual(snapshot.requests[0].advertisedToolNames, Object.values(actualNames));
  assert.equal(snapshot.requests[0].model, 'deepseek-workbench-test');
  assert.doesNotMatch(snapshotText, /super-secret-never-record/u);
  assert.doesNotMatch(snapshotText, /private prompt must not be recorded/u);
  assert.doesNotMatch(snapshotText, /夜雨刚停/u);
  assert.doesNotMatch(snapshotText, /authorization/iu);
});

test('text-only and tool-error modes remain deterministic', async () => {
  const textOnly = await start({ mode: 'text-only' });
  const textRaw = await (await chat(textOnly, [{ role: 'user', content: 'text' }])).text();
  assert.equal(finishReason(parseSse(textRaw)), 'stop');
  assert.equal(toolCalls(parseSse(textRaw)).length, 0);
  assert.match(textRaw, /仅文本模式/u);

  const toolError = await start({ mode: 'tool-error' });
  const initial = [{ role: 'user', content: 'error' }];
  const firstEvents = parseSse(await (await chat(toolError, initial)).text());
  const calls = toolCalls(firstEvents);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, actualNames['chapter.read_outline']);
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { novelId: 'novel-fixture' });
  const finalRaw = await (
    await chat(toolError, [
      ...initial,
      assistantToolMessage(calls),
      { role: 'tool', tool_call_id: calls[0].id, content: 'schema validation failed' },
    ])
  ).text();
  assert.equal(finishReason(parseSse(finalRaw)), 'stop');
  assert.match(finalRaw, /工具调用按预期失败/u);
});

test('missing required actual tools fails loud without inventing a tool name', async () => {
  const server = await start();
  const body = requestBody([{ role: 'user', content: 'missing tool' }]);
  body.tools = body.tools.filter(
    (tool) => tool.function.name !== actualNames['chapter.read_outline'],
  );
  const response = await fetch(server.chatCompletionsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 422);
  const failure = await response.json();
  assert.equal(failure.error.code, 'MOCK_REQUIRED_TOOL_MISSING');
  assert.deepEqual(failure.error.missingTools, ['chapter.read_outline']);
  const snapshot = await (await fetch(server.requestsUrl)).json();
  assert.equal(snapshot.requests[0].outcome, 'contract_error');
});

test('delay mode exposes overlapping requests for concurrency assertions', async () => {
  const server = await start({ mode: 'delay', delayMs: 25 });
  const messages = [{ role: 'user', content: 'parallel' }];
  await Promise.all([
    chat(server, messages).then((response) => response.text()),
    chat(server, messages).then((response) => response.text()),
  ]);

  const snapshot = await (await fetch(server.requestsUrl)).json();
  assert.equal(snapshot.requestCount, 2);
  assert.equal(snapshot.activeRequests, 0);
  assert.equal(snapshot.peakActiveRequests, 2);
  assert.ok(snapshot.requests.every((request) => request.outcome === 'completed'));
});

test('cancel mode records client_closed without leaking the request', async () => {
  const server = await start({ mode: 'cancel', delayMs: 2_000 });
  const controller = new AbortController();
  const response = await chat(server, [{ role: 'user', content: 'cancel-private-content' }], {
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  controller.abort();
  await assert.rejects(reader.read());

  let snapshot;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    snapshot = await (await fetch(server.requestsUrl)).json();
    if (snapshot.requests[0]?.outcome === 'client_closed') break;
    await delay(10);
  }
  assert.equal(snapshot.requests[0].outcome, 'client_closed');
  assert.equal(snapshot.activeRequests, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /cancel-private-content/u);
});
