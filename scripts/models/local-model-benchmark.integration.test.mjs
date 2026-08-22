import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directoryPath = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(directoryPath, 'local-model-benchmark.mjs');
const lifecycleScript = path.join(directoryPath, 'local-model-lifecycle.mjs');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function startModelServer(outputForPrompt) {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const requestBody = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/health') {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'qwen-benchmark' }] }));
      return;
    }
    const prompt = requestBody?.messages?.[0]?.content ?? '';
    response.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: outputForPrompt(prompt) } }],
      }),
    );
  });
  const port = await listen(server);
  return { server, baseUrl: 'http://127.0.0.1:' + port + '/v1' };
}

function validOutput(prompt) {
  const match = prompt.match(/正文必须原样保留这些事实词：([^\n]+)/);
  const terms = match?.[1] ?? '人物、目标';
  return (
    terms +
    '。' +
    '雨声压低了周围的杂音，人物立刻完成眼前动作，并从现场变化中确认结果已经发生。所有视线和反应都停留在当前目标上，没有越过这一刻去处理后续事件。'.repeat(
      4,
    )
  );
}

function runScript(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [executable, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => (output += chunk.toString('utf8')));
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('lifecycle CLI marks training but refuses to self-authorize AVAILABLE', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ans-local-lifecycle-'));
  const sidecar = path.join(directory, 'lifecycle.json');
  try {
    const training = await runScript(lifecycleScript, [
      '--model',
      'qwen-benchmark',
      '--lifecycle',
      'TRAINING',
      '--sidecar',
      sidecar,
    ]);
    assert.equal(training.code, 0, training.output);
    const state = JSON.parse(await readFile(sidecar, 'utf8'));
    assert.equal(state.lifecycle, 'TRAINING');
    assert.equal(state.endpointId, 'local.local_llama_cpp.qwen-benchmark');

    const available = await runScript(lifecycleScript, [
      '--model',
      'qwen-benchmark',
      '--lifecycle',
      'AVAILABLE',
      '--sidecar',
      sidecar,
    ]);
    assert.equal(available.code, 2);
    assert.match(available.output, /AVAILABLE requires benchmark/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark CLI promotes a passing local endpoint and writes no credential', async () => {
  const fixture = await startModelServer(validOutput);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ans-local-benchmark-'));
  const sidecar = path.join(directory, 'lifecycle.json');
  try {
    const result = await runScript(script, [
      '--base-url',
      fixture.baseUrl,
      '--model',
      'qwen-benchmark',
      '--provider-id',
      'local_llama_cpp',
      '--api-key',
      'secret-never-persist',
      '--sidecar',
      sidecar,
      '--cases',
      '3',
      '--threshold',
      '1',
    ]);
    assert.equal(result.code, 0, result.output);
    const raw = await readFile(sidecar, 'utf8');
    const state = JSON.parse(raw);
    assert.equal(state.lifecycle, 'AVAILABLE');
    assert.equal(state.benchmark.casesPassed, 3);
    assert.match(state.benchmark.reportHash, /^[0-9a-f]{64}$/);
    assert.equal(raw.includes('secret-never-persist'), false);
  } finally {
    await close(fixture.server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark CLI leaves a failing endpoint unavailable', async () => {
  const fixture = await startModelServer(() => '<think>analysis</think>短文');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ans-local-benchmark-'));
  const sidecar = path.join(directory, 'lifecycle.json');
  try {
    const result = await runScript(script, [
      '--base-url',
      fixture.baseUrl,
      '--model',
      'qwen-benchmark',
      '--sidecar',
      sidecar,
      '--cases',
      '2',
      '--threshold',
      '1',
    ]);
    assert.equal(result.code, 1, result.output);
    const state = JSON.parse(await readFile(sidecar, 'utf8'));
    assert.equal(state.lifecycle, 'FAILED');
    assert.equal(state.benchmark.casesPassed, 0);
  } finally {
    await close(fixture.server);
    await rm(directory, { recursive: true, force: true });
  }
});
