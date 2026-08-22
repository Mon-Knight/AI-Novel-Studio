import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildBenchmarkPrompt,
  buildCompletedSidecar,
  buildTestingSidecar,
  DEFAULT_BENCHMARK_CASES,
  DEFAULT_BENCHMARK_THRESHOLD,
  evaluateBenchmarkOutput,
  LOCAL_PROSE_BENCHMARK_FIXTURES,
  MAX_BENCHMARK_CASES,
} from './local-model-benchmark-lib.mjs';

const DEFAULT_SIDECAR = path.join(os.homedir(), '.ai-novel-studio-local-model-lifecycle.json');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error('unexpected argument: ' + key);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('missing value for ' + key);
    values[key.slice(2)] = value;
    index += 1;
  }
  const cases = Number(values.cases ?? DEFAULT_BENCHMARK_CASES);
  const threshold = Number(values.threshold ?? DEFAULT_BENCHMARK_THRESHOLD);
  if (!Number.isInteger(cases) || cases < 1 || cases > MAX_BENCHMARK_CASES) {
    throw new Error('--cases must be an integer between 1 and ' + MAX_BENCHMARK_CASES);
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('--threshold must be between 0 and 1');
  }
  if (!values['base-url'] || !values.model) throw new Error('--base-url and --model are required');
  return {
    baseUrl: values['base-url'],
    modelId: values.model,
    providerId: values['provider-id'] ?? 'local_llama_cpp',
    apiKey: values['api-key'] ?? process.env.LOCAL_MODEL_API_KEY ?? 'local-no-key-required',
    sidecarPath: values.sidecar ?? DEFAULT_SIDECAR,
    cases,
    threshold,
    timeoutMs: Math.min(300_000, Math.max(5_000, Number(values['timeout-ms'] ?? 120_000))),
  };
}

function localUrls(baseUrl) {
  const url = new URL(baseUrl);
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    /^127\./.test(hostname);
  if (!loopback || (url.protocol !== 'http:' && url.protocol !== 'https:'))
    throw new Error('local model base URL must use a loopback host');
  const clean = url.toString().replace(/\/+$/, '');
  const root = clean.endsWith('/v1') ? clean.slice(0, -3) : clean;
  const chat = clean.endsWith('/v1') ? clean + '/chat/completions' : clean + '/v1/chat/completions';
  return { root, chat };
}

function headers(apiKey) {
  return { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' };
}

async function requestJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('local model returned HTTP ' + response.status);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp-' + process.pid;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    await rename(temporary, filePath);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EEXIST') throw error;
    await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  }
}

function modelCatalogContains(body, modelId) {
  const rows = [
    ...(Array.isArray(body?.data) ? body.data : []),
    ...(Array.isArray(body?.models) ? body.models : []),
  ];
  return rows.some((row) => [row?.id, row?.model, row?.name].includes(modelId));
}

async function preflight(options, urls) {
  await requestJson(
    urls.root + '/health',
    { method: 'GET', headers: headers(options.apiKey) },
    options.timeoutMs,
  );
  const models = await requestJson(
    urls.root + '/v1/models',
    { method: 'GET', headers: headers(options.apiKey) },
    options.timeoutMs,
  );
  if (!modelCatalogContains(models, options.modelId))
    throw new Error('configured model is missing from /v1/models');
}

async function runCase(options, urls, fixture, sequence) {
  try {
    const body = await requestJson(
      urls.chat,
      {
        method: 'POST',
        headers: headers(options.apiKey),
        body: JSON.stringify({
          model: options.modelId,
          messages: [{ role: 'user', content: buildBenchmarkPrompt(fixture, sequence) }],
          temperature: 0.2,
          max_tokens: 512,
          top_p: 0.8,
          top_k: 20,
          repeat_penalty: 1.08,
          stream: false,
        }),
      },
      options.timeoutMs,
    );
    const choice = body?.choices?.[0] ?? {};
    const text = choice?.message?.content ?? choice?.text ?? '';
    return evaluateBenchmarkOutput({ fixture, text, finishReason: choice?.finish_reason });
  } catch {
    return {
      caseId: fixture.id,
      passed: false,
      score: 0,
      characterCount: 0,
      missingTerms: [...fixture.requiredTerms],
      issues: ['TRANSPORT_ERROR'],
    };
  }
}

export async function runLocalModelBenchmark(options) {
  const urls = localUrls(options.baseUrl);
  const startedAt = new Date().toISOString();
  await atomicWriteJson(
    options.sidecarPath,
    buildTestingSidecar({
      providerId: options.providerId,
      modelId: options.modelId,
      casesTotal: options.cases,
      threshold: options.threshold,
      now: startedAt,
    }),
  );
  try {
    await preflight(options, urls);
    const results = [];
    for (let index = 0; index < options.cases; index += 1) {
      const fixture = LOCAL_PROSE_BENCHMARK_FIXTURES[index % LOCAL_PROSE_BENCHMARK_FIXTURES.length];
      results.push(await runCase(options, urls, fixture, index + 1));
    }
    const completed = buildCompletedSidecar({
      providerId: options.providerId,
      modelId: options.modelId,
      results,
      threshold: options.threshold,
      now: new Date().toISOString(),
    });
    await atomicWriteJson(options.sidecarPath, completed.sidecar);
    return completed;
  } catch (error) {
    const failed = {
      ...buildTestingSidecar({
        providerId: options.providerId,
        modelId: options.modelId,
        casesTotal: options.cases,
        threshold: options.threshold,
        now: new Date().toISOString(),
      }),
      lifecycle: 'FAILED',
      failureReason: 'LOCAL_MODEL_BENCHMARK_RUNTIME_FAILED',
    };
    await atomicWriteJson(options.sidecarPath, failed);
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runLocalModelBenchmark(options);
  const summary = result.sidecar.benchmark;
  console.log(
    JSON.stringify({
      lifecycle: result.sidecar.lifecycle,
      casesPassed: summary.casesPassed,
      casesTotal: summary.casesTotal,
      passRate: summary.passRate,
      reportHash: result.reportHash,
    }),
  );
  process.exitCode = result.sidecar.lifecycle === 'AVAILABLE' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[local-model-benchmark] ' + (error instanceof Error ? error.message : 'failed'));
    process.exitCode = 2;
  });
}
