import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-proxy.mjs');
const HOST = '127.0.0.1';
const MAX_RANDOM_PORT_ATTEMPTS = 32;
// Keep this aligned with the WHATWG Fetch forbidden-port table used by the
// Workbench mock. Fetch rejects these ports before reaching loopback servers.
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

function listenOnce(server) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('fixture server did not bind a TCP port'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, HOST);
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

async function listen(server) {
  for (let attempt = 0; attempt < MAX_RANDOM_PORT_ATTEMPTS; attempt += 1) {
    const port = await listenOnce(server);
    if (!FETCH_FORBIDDEN_PORTS.has(port)) return port;
    await close(server);
  }
  throw new Error('fixture server could not allocate a Fetch-compatible random port');
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  child.kill();
  const stopped = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for proxy observation');
}

async function startFixture({
  upstreamResponse,
  timeoutMs = 2_000,
  model = 'fixture-model',
  environment = {},
}) {
  const policyCalls = [];
  const upstreamPaths = [];
  const upstream = http.createServer(async (request, response) => {
    upstreamPaths.push(request.url);
    for await (const _chunk of request) {
      // Drain the request without retaining prompts or tool arguments.
    }
    await upstreamResponse(request, response);
  });
  const policy = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    policyCalls.push({ path: request.url, payload });
    const body = request.url === '/reserve' ? { ticket: 'ticket-1' } : { settled: true };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  let proxy;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await stopChild(proxy?.child);
    await Promise.all([close(policy), close(upstream)]);
  };

  try {
    const upstreamPort = await listen(upstream);
    const policyPort = await listen(policy);
    const proxyEnvironment = {
      ...process.env,
      PROXY_PORT: '0',
      PROXY_UPSTREAM: `http://${HOST}:${upstreamPort}`,
      PROXY_UPSTREAM_KEY: 'fixture-secret-never-log',
      PROXY_POLICY_URL: `http://${HOST}:${policyPort}`,
      PROXY_REQUEST_PREFIX: 'integration',
      PROXY_REQUEST_TIMEOUT_MS: String(timeoutMs),
      PROXY_MODEL: model,
      ...environment,
    };

    for (let attempt = 0; attempt < MAX_RANDOM_PORT_ATTEMPTS; attempt += 1) {
      const child = spawn(process.execPath, [script], {
        env: proxyEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });
      proxy = { child, output: () => output };
      const portMatch = await waitFor(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`model proxy exited before readiness: ${output}`);
        }
        return output.match(/\[model-proxy\] listening on 127\.0\.0\.1:(\d+)/);
      });
      const proxyPort = Number(portMatch[1]);
      if (!FETCH_FORBIDDEN_PORTS.has(proxyPort)) {
        return {
          url: `http://${HOST}:${proxyPort}`,
          policyCalls,
          upstreamPaths,
          output: proxy.output,
          stop,
        };
      }
      await stopChild(child);
      proxy = undefined;
    }
    throw new Error('model proxy could not allocate a Fetch-compatible random port');
  } catch (error) {
    await stop();
    throw error;
  }
}

function requestBody() {
  return JSON.stringify({
    model: 'fixture-model',
    stream: true,
    max_tokens: 32,
    messages: [{ role: 'user', content: 'fixture prompt' }],
  });
}

async function post(url) {
  return fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody(),
  });
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

test('real-E2E capture persists correlated hash-only automatic asset request evidence', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ans-provider-evidence-'));
  const evidenceDirectory = path.join(temporaryRoot, 'requests');
  fs.mkdirSync(evidenceDirectory);
  const fixtureCanaries = [
    { id: 'prepared_world', value: '近未来海港城临雾依靠回声档案' },
    { id: 'prepared_outline', value: '空白航海日志' },
  ];
  const creativeBrief = '写个六万字左右的悬疑故事。';
  const latestUserMessage = [
    '小说 ID：novel-1',
    '用户意图：生成世界与规则设定候选。',
    '',
    '[[ANS_CREATIVE_BRIEF:v1]]',
    JSON.stringify({
      schema: 'ans_core_asset_creative_brief_v1',
      source: 'original_user_goal',
      content: creativeBrief,
    }),
    '',
    '[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]',
    '工作台说明：这是自动资产准备回合。',
    '',
    '宿主契约：taskKind=setting_expand',
  ].join('\n');
  const messages = [
    { role: 'system', content: '只生成候选。' },
    { role: 'user', content: latestUserMessage },
  ];
  const body = JSON.stringify({ model: 'fixture-model', stream: true, messages });
  const fixture = await startFixture({
    environment: {
      AI_NOVEL_STUDIO_REAL_E2E: '1',
      AI_NOVEL_STUDIO_REAL_E2E_PROVIDER_EVIDENCE_DIR: evidenceDirectory,
      AI_NOVEL_STUDIO_REAL_E2E_PREPARED_FIXTURE_CANARIES_JSON: JSON.stringify(fixtureCanaries),
    },
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"choices":[]}\n\ndata: [DONE]\n\n');
    },
  });
  try {
    const response = await fetch(`${fixture.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();

    const requestIdHash = sha256('integration:1');
    const evidencePath = path.join(evidenceDirectory, `${requestIdHash}.json`);
    await waitFor(() => fs.existsSync(evidencePath));
    const evidenceText = fs.readFileSync(evidencePath, 'utf8');
    const evidence = JSON.parse(evidenceText);
    assert.deepEqual(evidence, {
      schemaVersion: 'real_conversation_provider_request_evidence_v1',
      captureMode: 'hash_only',
      hashAlgorithm: 'sha256',
      messagesSerialization: 'json_stringify_messages_v1',
      providerRequestIdSha256: requestIdHash,
      requestBodySha256: sha256(body),
      messagesSha256: sha256(JSON.stringify(messages)),
      messageCount: 2,
      messageTextSha256: sha256(
        JSON.stringify(messages.flatMap((message) => Object.values(message))),
      ),
      messageTextCount: 4,
      latestUserMessageSha256: sha256(latestUserMessage),
      latestUserMessageLength: latestUserMessage.length,
      classification: 'automatic_asset_preparation',
      turnOrigin: 'workbench_asset_preparation',
      assetKind: 'world_setting',
      creativeBriefParseStatus: 'valid',
      creativeBrief: {
        schema: 'ans_core_asset_creative_brief_v1',
        source: 'original_user_goal',
        contentSha256: sha256(creativeBrief),
        contentLength: creativeBrief.length,
      },
      creativeBriefMarkerCount: 1,
      latestUserCreativeBriefMarkerCount: 1,
      configuredPreparedFixtureCanaryIds: fixtureCanaries.map((canary) => canary.id),
      matchedPreparedFixtureCanaryIds: [],
      rawMessageContentPersisted: false,
    });
    assert.equal(evidenceText.includes(creativeBrief), false);
    assert.equal(evidenceText.includes(latestUserMessage), false);
    assert.equal(evidenceText.includes(fixtureCanaries[0].value), false);

    const leakingBody = JSON.stringify({
      model: 'fixture-model',
      stream: true,
      messages: [...messages, { role: 'tool', content: `fixture:${fixtureCanaries[0].value}` }],
    });
    const leakingResponse = await fetch(`${fixture.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: leakingBody,
    });
    assert.equal(leakingResponse.status, 200);
    await leakingResponse.arrayBuffer();
    const leakingEvidencePath = path.join(evidenceDirectory, `${sha256('integration:2')}.json`);
    await waitFor(() => fs.existsSync(leakingEvidencePath));
    const leakingEvidenceText = fs.readFileSync(leakingEvidencePath, 'utf8');
    const leakingEvidence = JSON.parse(leakingEvidenceText);
    assert.deepEqual(leakingEvidence.matchedPreparedFixtureCanaryIds, ['prepared_world']);
    assert.equal(leakingEvidenceText.includes(fixtureCanaries[0].value), false);
  } finally {
    await fixture.stop();
    for (const name of fs.readdirSync(evidenceDirectory)) {
      fs.rmSync(path.join(evidenceDirectory, name), { force: true });
    }
    fs.rmdirSync(evidenceDirectory);
    fs.rmdirSync(temporaryRoot);
  }
});

test('governed proxy settles successful usage with the measured token pair', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\ndata: [DONE]\n\n',
      );
    },
  });
  try {
    assert.equal((await post(fixture.url)).status, 200);
    const settle = await waitFor(() => fixture.policyCalls.find((call) => call.path === '/settle'));
    assert.deepEqual(settle.payload, {
      ticket: 'ticket-1',
      outcome: 'succeeded',
      tokenInput: 11,
      tokenOutput: 7,
    });
    assert.match(fixture.policyCalls[0].payload.providerRequestId, /^integration:1$/);
    assert.equal(fixture.output().includes('fixture-secret-never-log'), false);
  } finally {
    await fixture.stop();
  }
});

test('proxy exposes a redacted model catalog and preserves /v1 downstream prefixes', async () => {
  const fixture = await startFixture({
    model: 'dsh-real-model-fixture',
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      );
    },
  });
  try {
    const models = await fetch(`${fixture.url}/v1/models`);
    assert.equal(models.status, 200);
    assert.deepEqual((await models.json()).data, [
      { id: 'dsh-real-model-fixture', object: 'model' },
    ]);

    const response = await fetch(`${fixture.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody(),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.deepEqual(fixture.upstreamPaths, ['/chat/completions']);
  } finally {
    await fixture.stop();
  }
});

test('proxy rejects an invalid catalog model identity before listening', async () => {
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PROXY_PORT: String(await freePort()),
      PROXY_UPSTREAM: 'http://127.0.0.1:9/v1',
      PROXY_UPSTREAM_KEY: 'fixture-secret-never-log',
      PROXY_MODEL: '   ',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  const exit = await waitForExit(child);
  assert.equal(exit.code, 2);
  assert.match(output, /PROXY_MODEL must be a non-empty model identity/u);
  assert.doesNotMatch(output, /listening on/u);
  assert.equal(output.includes('fixture-secret-never-log'), false);
});

test('governed proxy preserves conservative success settlement when usage is missing', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  try {
    assert.equal((await post(fixture.url)).status, 200);
    const settle = await waitFor(() => fixture.policyCalls.find((call) => call.path === '/settle'));
    assert.deepEqual(settle.payload, { ticket: 'ticket-1', outcome: 'succeeded' });
  } finally {
    await fixture.stop();
  }
});

test('proxy appends DONE only after an explicit SSE finish reason', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.end(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"fixture_tool","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      );
    },
  });
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /data: \[DONE\]\n\n$/u);
    assert.equal(body.match(/data: \[DONE\]/gu)?.length, 1);
    await waitFor(() => fixture.output().includes('[model-proxy] done model='));
    assert.match(fixture.output(), /normalized terminal SSE without \[DONE\]/u);
    assert.match(
      fixture.output(),
      /responseStats status=200 payloads=1 choices=1 contentChars=0 reasoningChars=0 alternateReasoningChars=0 toolCallParts=1 legacyFunctionCallParts=0 toolNames=fixture_tool messageKeys=tool_calls finish=tool_calls done=true/u,
    );
  } finally {
    await fixture.stop();
  }
});

test('proxy diagnostics report request shape without logging prompt or tool arguments', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  try {
    const secretPrompt = 'fixture-prompt-must-not-appear';
    const secretArgument = 'fixture-argument-must-not-appear';
    const response = await fetch(`${fixture.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fixture-model',
        stream: true,
        messages: [{ role: 'user', content: secretPrompt }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'fixture_tool',
              description: secretArgument,
              parameters: { type: 'object' },
            },
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    await waitFor(() => fixture.output().includes('[model-proxy] responseStats'));
    assert.match(
      fixture.output(),
      /messages=1 tools=1 invalidToolNames=0 thinking=unspecified effort=unspecified/u,
    );
    assert.equal(fixture.output().includes(secretPrompt), false);
    assert.equal(fixture.output().includes(secretArgument), false);
  } finally {
    await fixture.stop();
  }
});

test('proxy leaves a genuinely truncated SSE stream without DONE', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    },
  });
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.doesNotMatch(body, /data: \[DONE\]/u);
    await waitFor(() => fixture.output().includes('[model-proxy] done model='));
    assert.doesNotMatch(fixture.output(), /normalized terminal SSE/u);
  } finally {
    await fixture.stop();
  }
});

test('governed proxy settles an upstream HTTP failure conservatively', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"fixture_unavailable"}}');
    },
  });
  try {
    assert.equal((await post(fixture.url)).status, 503);
    const settle = await waitFor(() => fixture.policyCalls.find((call) => call.path === '/settle'));
    assert.deepEqual(settle.payload, { ticket: 'ticket-1', outcome: 'failed' });
  } finally {
    await fixture.stop();
  }
});

test('governed proxy aborts and conservatively settles a timed-out upstream request', async () => {
  const fixture = await startFixture({
    timeoutMs: 1_000,
    upstreamResponse: async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"choices":[]}');
    },
  });
  try {
    const response = await post(fixture.url);
    assert.equal(response.status, 504);
    const settle = await waitFor(() => fixture.policyCalls.find((call) => call.path === '/settle'));
    assert.deepEqual(settle.payload, { ticket: 'ticket-1', outcome: 'failed' });
    assert.match(fixture.output(), /upstream timeout/);
  } finally {
    await fixture.stop();
  }
});

test('governed proxy aborts and settles when the downstream caller disconnects', async () => {
  const fixture = await startFixture({
    upstreamResponse: async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"choices":[]}');
    },
  });
  try {
    await new Promise((resolve) => {
      const request = http.request(`${fixture.url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      request.on('error', () => resolve());
      request.end(requestBody(), () => setTimeout(() => request.destroy(), 100));
    });
    const settle = await waitFor(() => fixture.policyCalls.find((call) => call.path === '/settle'));
    assert.deepEqual(settle.payload, { ticket: 'ticket-1', outcome: 'failed' });
    assert.match(fixture.output(), /upstream cancelled/);
  } finally {
    await fixture.stop();
  }
});
