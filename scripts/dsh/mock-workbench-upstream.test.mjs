import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalToolName, startMockWorkbenchUpstream } from './mock-workbench-upstream.mjs';

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

test('canonicalToolName recognizes legacy markers and exact Canonical names', () => {
  assert.equal(canonicalToolName('novel.read'), 'novel.read');
  assert.equal(canonicalToolName('mcp__novel__novel.read'), 'novel.read');
  assert.equal(canonicalToolName('novel.read@1'), 'novel.read');
  assert.equal(canonicalToolName('mcp__novel__novel.read@1'), 'novel.read');
  assert.equal(canonicalToolName('novel_read_1e2b3adf9a19'), 'novel.read');
  assert.equal(canonicalToolName('structure.read'), 'structure.read');
  assert.equal(canonicalToolName('mcp__novel__structure.read'), 'structure.read');
  assert.equal(canonicalToolName('context.read@1'), 'context.read');
  assert.equal(canonicalToolName('mcp__novel__memory.search'), 'memory.search');
  assert.equal(canonicalToolName('memory.search@1'), 'memory.search');
  assert.equal(
    canonicalToolName('mcp__novel__novel_read_context_111111111111'),
    'novel.read_context',
  );
  assert.equal(canonicalToolName('novel.read_context'), 'novel.read_context');
  assert.equal(canonicalToolName('mcp__novel__search_memory_333333333333'), 'search_memory');
  assert.equal(canonicalToolName('mcp__novel__generate_chapter_444444444444'), 'generate_chapter');
  assert.notEqual(canonicalToolName('novel.read_context'), 'novel.read');
  assert.notEqual(canonicalToolName('mcp__novel__novel_read_context_abc'), 'novel.read');
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

test('Canonical-only advertised tools call read tools and skip generate_chapter', async () => {
  const canonicalNames = Object.freeze({
    'novel.read': 'mcp__novel__novel.read',
    'structure.read': 'structure.read@1',
    'context.read': 'context.read',
    'memory.search': 'mcp__novel__memory.search@1',
  });
  const canonicalTools = Object.values(canonicalNames).map((name) => ({
    type: 'function',
    function: { name, description: `fixture ${name}`, parameters: { type: 'object' } },
  }));
  const server = await start();
  const initial = [{ role: 'user', content: 'private canonical read prompt' }];
  const body = requestBody(initial);
  body.tools = canonicalTools;

  const firstResponse = await fetch(server.chatCompletionsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const firstEvents = parseSse(await firstResponse.text());
  const firstCalls = toolCalls(firstEvents);
  assert.equal(finishReason(firstEvents), 'tool_calls');
  assert.deepEqual(
    firstCalls.map((call) => call.function.name),
    [
      canonicalNames['novel.read'],
      canonicalNames['structure.read'],
      canonicalNames['context.read'],
      canonicalNames['memory.search'],
    ],
  );
  assert.deepEqual(JSON.parse(firstCalls[0].function.arguments), { novelId: 'novel-fixture' });
  assert.deepEqual(JSON.parse(firstCalls[1].function.arguments), {
    novelId: 'novel-fixture',
    chapterId: 'chapter-fixture',
  });
  assert.deepEqual(JSON.parse(firstCalls[2].function.arguments), {
    novelId: 'novel-fixture',
    chapterId: 'chapter-fixture',
  });
  assert.deepEqual(JSON.parse(firstCalls[3].function.arguments), {
    novelId: 'novel-fixture',
    query: '章节创作上下文',
  });

  const afterContext = [...initial, assistantToolMessage(firstCalls), ...toolResults(firstCalls)];
  const secondBody = requestBody(afterContext);
  secondBody.tools = canonicalTools;
  const secondRaw = await (
    await fetch(server.chatCompletionsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(secondBody),
    })
  ).text();
  const secondEvents = parseSse(secondRaw);
  assert.equal(finishReason(secondEvents), 'stop');
  assert.equal(toolCalls(secondEvents).length, 0);
  const secondText = secondEvents
    .filter((event) => event !== '[DONE]')
    .map((event) => event.choices?.[0]?.delta?.content ?? '')
    .join('');
  assert.match(secondText, /已读取当前作品与章节上下文/u);
  assert.match(secondText, /建议下一步/u);
  assert.doesNotMatch(secondRaw, /generate_chapter/u);
  assert.doesNotMatch(secondRaw, /候选/u);
  assert.doesNotMatch(secondRaw, /正式正文/u);

  const snapshot = await (await fetch(server.requestsUrl)).json();
  assert.deepEqual(
    snapshot.requests.map((request) => request.phase),
    ['canonical-read-tools', 'canonical-read-final'],
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /private canonical read prompt/u);
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

test('delayed-text mode delays a read-only response without calling candidate tools', async () => {
  const server = await start({ mode: 'delayed-text', delayMs: 30 });
  const startedAt = Date.now();
  const raw = await (await chat(server, [{ role: 'user', content: 'read only' }])).text();

  assert.ok(Date.now() - startedAt >= 20);
  assert.equal(finishReason(parseSse(raw)), 'stop');
  assert.equal(toolCalls(parseSse(raw)).length, 0);
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

async function completeContextReads(server, initial) {
  const firstCalls = toolCalls(parseSse(await (await chat(server, initial)).text()));
  assert.equal(firstCalls.length, 4);
  return [...initial, assistantToolMessage(firstCalls), ...toolResults(firstCalls)];
}

test('forbidden-tool mode calls a tool outside the advertised roster exactly once', async () => {
  const server = await start({ mode: 'forbidden-tool' });
  const afterContext = await completeContextReads(server, [{ role: 'user', content: '写本章' }]);

  const forbiddenEvents = parseSse(await (await chat(server, afterContext)).text());
  const forbiddenCalls = toolCalls(forbiddenEvents);
  assert.equal(finishReason(forbiddenEvents), 'tool_calls');
  assert.equal(forbiddenCalls.length, 1);
  assert.equal(forbiddenCalls[0].function.name, 'mcp__novel__expand_settings');
  assert.ok(!Object.values(actualNames).includes(forbiddenCalls[0].function.name));
  assert.deepEqual(Object.keys(JSON.parse(forbiddenCalls[0].function.arguments)), [
    'novelId',
    'settings',
  ]);

  const afterForbidden = [
    ...afterContext,
    assistantToolMessage(forbiddenCalls),
    { role: 'tool', tool_call_id: forbiddenCalls[0].id, content: JSON.stringify({ error: 'x' }) },
  ];
  const finalRaw = await (await chat(server, afterForbidden)).text();
  const finalEvents = parseSse(finalRaw);
  assert.equal(finishReason(finalEvents), 'stop');
  assert.equal(toolCalls(finalEvents).length, 0);
  assert.match(finalRaw, /越权工具调用已被拒绝/u);
  const snapshot = await (await fetch(server.requestsUrl)).json();
  assert.deepEqual(
    snapshot.requests.map((request) => request.phase),
    ['context-tools', 'forbidden-tool', 'forbidden-tool-final'],
  );
});

test('cross-novel mode keeps reads in scope and submits the candidate for the foreign book', async () => {
  const server = await start({
    mode: 'cross-novel',
    foreignNovelId: 'novel-foreign',
    foreignChapterId: 'chapter-foreign',
  });
  const initial = [{ role: 'user', content: '写本章' }];
  const firstCalls = toolCalls(parseSse(await (await chat(server, initial)).text()));
  for (const call of firstCalls) {
    assert.equal(JSON.parse(call.function.arguments).novelId, 'novel-fixture');
  }
  const afterContext = [...initial, assistantToolMessage(firstCalls), ...toolResults(firstCalls)];
  const generateCalls = toolCalls(parseSse(await (await chat(server, afterContext)).text()));
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].function.name, actualNames.generate_chapter);
  const args = JSON.parse(generateCalls[0].function.arguments);
  assert.equal(args.novelId, 'novel-foreign');
  assert.equal(args.chapterId, 'chapter-foreign');
  assert.ok(args.candidateText.length > 0);
});

test('upstream-error-once fails the first non-attestation completion with HTTP 500 only', async () => {
  const server = await start({ mode: 'upstream-error-once' });
  const initial = [{ role: 'user', content: '写本章' }];
  const failed = await chat(server, initial);
  assert.equal(failed.status, 500);
  const body = await failed.json();
  assert.equal(body.error.code, 'MOCK_INJECTED_UPSTREAM_FAILURE');

  const recovered = await chat(server, initial);
  assert.equal(recovered.status, 200);
  assert.equal(toolCalls(parseSse(await recovered.text())).length, 4);
  const snapshot = await (await fetch(server.requestsUrl)).json();
  assert.equal(snapshot.injectedUpstreamFailures, 1);
  assert.deepEqual(
    snapshot.requests.map((request) => [request.phase, request.outcome]),
    [
      ['injected-upstream-failure', 'injected_failure'],
      ['context-tools', 'completed'],
    ],
  );
});

test('upstream-error keeps failing until the mode changes and resets its counter on switch', async () => {
  const server = await start({ mode: 'upstream-error' });
  const initial = [{ role: 'user', content: '写本章' }];
  assert.equal((await chat(server, initial)).status, 500);
  assert.equal((await chat(server, initial)).status, 500);
  assert.equal(server.snapshot().injectedUpstreamFailures, 2);
  server.configure({ mode: 'normal' });
  assert.equal((await chat(server, initial)).status, 200);
  assert.equal(server.configure({ mode: 'upstream-error' }).mode, 'upstream-error');
  assert.equal(server.snapshot().injectedUpstreamFailures, 0);
});

test('hold-generate parks the candidate completion until the client disconnects', async () => {
  const server = await start({ mode: 'hold-generate' });
  const afterContext = await completeContextReads(server, [{ role: 'user', content: '写本章' }]);
  const controller = new AbortController();
  const held = await chat(server, afterContext, { signal: controller.signal });
  const reader = held.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  const raced = await Promise.race([
    reader.read().then(() => 'chunk'),
    delay(300).then(() => 'held'),
  ]);
  assert.equal(raced, 'held');
  controller.abort();
  await assert.rejects(reader.read());
  let snapshot;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    snapshot = await (await fetch(server.requestsUrl)).json();
    if (snapshot.requests[1]?.outcome === 'client_closed') break;
    await delay(10);
  }
  assert.equal(snapshot.requests[1].phase, 'hold-generate');
  assert.equal(snapshot.requests[1].outcome, 'client_closed');
  assert.equal(snapshot.activeRequests, 0);
});

test('a resumed session only counts tool calls made after the newest user message', async () => {
  const server = await start();
  const previousTurn = await completeContextReads(server, [{ role: 'user', content: '写本章' }]);
  // The previous turn was interrupted before generate_chapter; the retry appends a new user
  // message behind the replayed transcript.
  const resumed = [...previousTurn, { role: 'user', content: '重试：写本章' }];
  const calls = toolCalls(parseSse(await (await chat(server, resumed)).text()));
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((call) => call.function.name),
    [
      actualNames['novel.read_context'],
      actualNames['chapter.read_outline'],
      actualNames.get_character_states,
      actualNames.search_memory,
    ],
  );
  const afterReRead = [...resumed, assistantToolMessage(calls), ...toolResults(calls)];
  const generate = toolCalls(parseSse(await (await chat(server, afterReRead)).text()));
  assert.equal(generate.length, 1);
  assert.equal(generate[0].function.name, actualNames.generate_chapter);
});

test('request summaries record only whether the host retry notice was present', async () => {
  const server = await start();
  await chat(server, [{ role: 'user', content: '写本章' }]);
  await chat(server, [
    { role: 'user', content: '写本章' },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '用户意图：写本章\n\n用户重试：同一目标此前已有 1 次失败或中断的运行。私密提示词',
        },
      ],
    },
  ]);
  const snapshot = await (await fetch(server.requestsUrl)).json();
  assert.deepEqual(
    snapshot.requests.map((request) => request.userRetryNotice),
    [false, true],
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /私密提示词/u);
});

test('configure switches mode and ids in place while keeping the bound port', async () => {
  const server = await start({ mode: 'hold-generate' });
  const port = server.port;
  assert.equal(server.mode, 'hold-generate');
  const options = server.configure({ mode: 'normal', chapterId: 'chapter-second' });
  assert.equal(options.mode, 'normal');
  assert.equal(options.delayMs, 0);
  assert.equal(server.mode, 'normal');
  assert.equal(server.port, port);
  const initial = [{ role: 'user', content: '写本章' }];
  const afterContext = await completeContextReads(server, initial);
  const generateCalls = toolCalls(parseSse(await (await chat(server, afterContext)).text()));
  assert.equal(JSON.parse(generateCalls[0].function.arguments).chapterId, 'chapter-second');
  assert.equal(server.configure({ mode: 'cancel' }).delayMs, 30_000);
  assert.equal(server.configure({ mode: 'upstream-error-once' }).mode, 'upstream-error-once');
  assert.equal(server.snapshot().injectedUpstreamFailures, 0);
  assert.equal((await (await fetch(server.healthUrl)).json()).mode, 'upstream-error-once');
  assert.throws(() => server.configure({ mode: 'nonsense' }), /mode must be one of/u);
});
