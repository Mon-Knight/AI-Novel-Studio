import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkLocalChapterModel,
  checkLocalChapterModelAvailability,
} from './localChapterModelHealthService';

test('browser local model health check verifies health, model identity and smoke output', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/health')) {
      return new Response('{"status":"ok"}', { status: 200 });
    }
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({ models: [{ name: 'qwen35-9b-novel-v3', model: 'qwen35-9b-novel-v3' }] }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '一段场景正文。' } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const result = await checkLocalChapterModel({
      enabled: true,
      providerId: 'local_llama_cpp',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'local-no-key-required',
      modelName: 'qwen35-9b-novel-v3',
      timeoutSeconds: 10,
      contextTokens: 4096,
      maxTokens: 1024,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.08,
    });
    assert.equal(result.healthOk, true);
    assert.equal(result.modelOk, true);
    assert.equal(result.smokeOk, true);
    assert.deepEqual(urls, [
      'http://127.0.0.1:8080/health',
      'http://127.0.0.1:8080/v1/models',
      'http://127.0.0.1:8080/v1/chat/completions',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generation preflight checks service and model without spending a smoke request', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/health')) return new Response('{"status":"ok"}', { status: 200 });
    return new Response(JSON.stringify({ models: [{ name: 'qwen35-9b-novel-v3' }] }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    const result = await checkLocalChapterModelAvailability({
      enabled: true,
      providerId: 'local_llama_cpp',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'local-no-key-required',
      modelName: 'qwen35-9b-novel-v3',
      timeoutSeconds: 10,
      contextTokens: 4096,
      maxTokens: 1024,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.08,
    });
    assert.equal(result.healthOk, true);
    assert.equal(result.modelOk, true);
    assert.equal(result.smokeOk, false);
    assert.deepEqual(urls, ['http://127.0.0.1:8080/health', 'http://127.0.0.1:8080/v1/models']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('local model health rejects remote endpoints before any transport call', async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('transport must not run');
  }) as typeof fetch;
  try {
    await assert.rejects(
      checkLocalChapterModel({
        enabled: true,
        providerId: 'local_llama_cpp',
        baseUrl: 'https://remote.example/v1',
        apiKey: 'must-not-leave-device',
        modelName: 'qwen35-9b-novel-v3',
        timeoutSeconds: 30,
        contextTokens: 4096,
        maxTokens: 1024,
        temperature: 0.7,
        topP: 0.8,
        topK: 20,
        repeatPenalty: 1.08,
      }),
      /只允许 localhost、127\.0\.0\.0\/8 或 \[::1\]/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
