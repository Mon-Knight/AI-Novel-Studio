import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-proxy.mjs');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
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

async function startFixture({ upstreamResponse, timeoutMs = 2_000 }) {
  const policyCalls = [];
  const upstream = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request without retaining prompts or tool arguments.
    }
    await upstreamResponse(request, response);
  });
  const upstreamPort = await listen(upstream);
  const policy = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    policyCalls.push({ path: request.url, payload });
    const body = request.url === '/reserve' ? { ticket: 'ticket-1' } : { settled: true };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  const policyPort = await listen(policy);
  const proxyPort = await freePort();
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PROXY_PORT: String(proxyPort),
      PROXY_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      PROXY_UPSTREAM_KEY: 'fixture-secret-never-log',
      PROXY_POLICY_URL: `http://127.0.0.1:${policyPort}`,
      PROXY_REQUEST_PREFIX: 'integration',
      PROXY_REQUEST_TIMEOUT_MS: String(timeoutMs),
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
  await waitFor(() => output.includes('[model-proxy] listening'));
  return {
    url: `http://127.0.0.1:${proxyPort}`,
    policyCalls,
    output: () => output,
    async stop() {
      if (child.exitCode === null) child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      await Promise.all([close(policy), close(upstream)]);
    },
  };
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
