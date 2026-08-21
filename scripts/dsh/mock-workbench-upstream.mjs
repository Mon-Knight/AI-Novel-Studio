/**
 * Deterministic loopback-only DeepSeek/OpenAI SSE upstream for Workbench tests.
 *
 * The server derives each model step from the request's actual tool roster and
 * replayed assistant tool calls. It does not keep an Agent/session state
 * machine and never accesses the network. Stdout is reserved for one ready
 * JSON line so Rust and desktop E2E fixtures can discover the random port.
 *
 * Environment:
 *   MOCK_WORKBENCH_PORT        Loopback port; 0/default asks the OS to choose.
 *   MOCK_WORKBENCH_MODE        normal | text-only | tool-error | delay | cancel
 *   MOCK_WORKBENCH_NOVEL_ID    novelId placed in scripted tool arguments.
 *   MOCK_WORKBENCH_CHAPTER_ID  chapterId placed in scripted tool arguments.
 *   MOCK_WORKBENCH_CANDIDATE_TEXT  generate_chapter candidate (never exposed in summaries).
 *   MOCK_WORKBENCH_DELAY_MS    Delay between SSE phases for delay/cancel modes.
 *
 * Security: request bodies and headers are never retained. In particular,
 * Authorization, cookies, credentials, prompts, tool arguments, and tool
 * results cannot appear in stdout or the request-summary endpoint.
 */

import http from 'node:http';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_SAFE_NAME_CHARS = 200;
const MODES = new Set(['normal', 'text-only', 'tool-error', 'delay', 'cancel']);
const CONTEXT_TOOLS = ['novel.read_context', 'chapter.read_outline', 'search_memory'];
const GENERATE_TOOL = 'generate_chapter';

const TOOL_MARKERS = new Map([
  ['novel.read_context', ['novel_read_context', 'get_metadata']],
  ['chapter.read_outline', ['chapter_read_outline', 'get_chapter_context']],
  ['search_memory', ['search_memory']],
  [GENERATE_TOOL, ['generate_chapter']],
]);

class ClientClosedError extends Error {
  constructor() {
    super('mock client closed the response');
    this.name = 'ClientClosedError';
  }
}

class ContractError extends Error {
  constructor(message, missingTools = []) {
    super(message);
    this.name = 'ContractError';
    this.missingTools = missingTools;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integerOption(value, label, { minimum, maximum }) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function nonEmptyOption(value, label, fallback) {
  const selected = value ?? fallback;
  if (typeof selected !== 'string' || selected.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return selected;
}

function resolveMode(value) {
  const selected = value === 'delay/cancel' ? 'cancel' : (value ?? 'normal');
  if (!MODES.has(selected)) {
    throw new TypeError(`mode must be one of: ${[...MODES].join(', ')}`);
  }
  return selected;
}

function resolveOptions(options = {}) {
  const mode = resolveMode(options.mode ?? process.env.MOCK_WORKBENCH_MODE);
  const defaultDelay = mode === 'cancel' ? 30_000 : mode === 'delay' ? 150 : 0;
  return Object.freeze({
    mode,
    port: integerOption(
      options.port ?? process.env.MOCK_WORKBENCH_PORT ?? 0,
      'MOCK_WORKBENCH_PORT',
      { minimum: 0, maximum: 65_535 },
    ),
    novelId: nonEmptyOption(
      options.novelId ?? process.env.MOCK_WORKBENCH_NOVEL_ID,
      'MOCK_WORKBENCH_NOVEL_ID',
      'mock-workbench-novel',
    ),
    chapterId: nonEmptyOption(
      options.chapterId ?? process.env.MOCK_WORKBENCH_CHAPTER_ID,
      'MOCK_WORKBENCH_CHAPTER_ID',
      'mock-workbench-chapter',
    ),
    candidateText: nonEmptyOption(
      options.candidateText ?? process.env.MOCK_WORKBENCH_CANDIDATE_TEXT,
      'MOCK_WORKBENCH_CANDIDATE_TEXT',
      '雨停在城门开启之前。沈砚收起湿透的地图，沿着石阶走进尚未苏醒的长街。\n\n远处钟声响起，他知道真正的考验才刚刚开始。',
    ),
    delayMs: integerOption(
      options.delayMs ?? process.env.MOCK_WORKBENCH_DELAY_MS ?? defaultDelay,
      'MOCK_WORKBENCH_DELAY_MS',
      { minimum: 0, maximum: 120_000 },
    ),
  });
}

function normalizedToolName(value) {
  return typeof value === 'string' ? value.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '_') : '';
}

function canonicalToolName(value) {
  const normalized = normalizedToolName(value);
  for (const [canonical, markers] of TOOL_MARKERS) {
    if (markers.some((marker) => normalized.includes(marker))) return canonical;
  }
  return undefined;
}

function safeName(value) {
  if (typeof value !== 'string') return 'unknown';
  const redacted = value
    .replaceAll(/[\u0000-\u001f\u007f]/g, '?')
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk|api[_-]?key|access[_-]?token)[_-][A-Za-z0-9._~+/=-]{8,}/giu, '[redacted]');
  return [...redacted].slice(0, MAX_SAFE_NAME_CHARS).join('');
}

function wireTools(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const actualNames = [];
  const byCanonical = new Map();
  for (const tool of tools) {
    const name = tool?.type === 'function' ? tool?.function?.name : undefined;
    if (typeof name !== 'string' || name.trim() === '') continue;
    actualNames.push(safeName(name));
    const canonical = canonicalToolName(name);
    if (canonical !== undefined && !byCanonical.has(canonical)) {
      byCanonical.set(canonical, name);
    }
  }
  return { actualNames, byCanonical };
}

function calledTools(messages) {
  const called = new Set();
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      const canonical = canonicalToolName(call?.function?.name);
      if (canonical !== undefined) called.add(canonical);
    }
  }
  return called;
}

function contentLength(value) {
  if (typeof value === 'string') return value.length;
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, block) => {
    if (typeof block === 'string') return total + block.length;
    return total + (typeof block?.text === 'string' ? block.text.length : 0);
  }, 0);
}

function summarizeMessages(messages) {
  const roles = { system: 0, user: 0, assistant: 0, tool: 0, other: 0 };
  let promptChars = 0;
  let lastUserChars = 0;
  let toolResultCount = 0;
  for (const message of messages) {
    const role = typeof message?.role === 'string' ? message.role : 'other';
    if (Object.hasOwn(roles, role)) roles[role] += 1;
    else roles.other += 1;
    const length = contentLength(message?.content);
    promptChars += length;
    if (role === 'user') lastUserChars = length;
    if (role === 'tool') toolResultCount += 1;
  }
  return { roles, promptChars, lastUserChars, toolResultCount };
}

function toolArguments(canonical, options, { invalid = false } = {}) {
  if (invalid) return { novelId: options.novelId };
  switch (canonical) {
    case 'novel.read_context':
      return { novelId: options.novelId };
    case 'chapter.read_outline':
      return { novelId: options.novelId, chapterId: options.chapterId };
    case 'search_memory':
      return {
        novelId: options.novelId,
        chapterId: options.chapterId,
        query: '章节创作上下文',
        topK: 5,
      };
    case GENERATE_TOOL:
      return {
        novelId: options.novelId,
        chapterId: options.chapterId,
        candidateText: options.candidateText,
      };
    default:
      throw new ContractError(`unsupported canonical tool: ${canonical}`);
  }
}

function requireWireTools(byCanonical, canonicalNames) {
  const missing = canonicalNames.filter((name) => !byCanonical.has(name));
  if (missing.length > 0) {
    throw new ContractError('request does not advertise the required Workbench tools', missing);
  }
}

function createToolCalls(canonicalNames, byCanonical, options, sequence, invalid = false) {
  requireWireTools(byCanonical, canonicalNames);
  return canonicalNames.map((canonical, index) => ({
    canonical,
    id: `call_mock_${sequence}_${index}_${canonical.replaceAll(/[^a-z0-9]/g, '_')}`,
    name: byCanonical.get(canonical),
    arguments: JSON.stringify(toolArguments(canonical, options, { invalid })),
  }));
}

function createPlan(body, options, sequence) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const { actualNames, byCanonical } = wireTools(body);
  const alreadyCalled = calledTools(messages);

  if (options.mode === 'text-only') {
    return {
      kind: 'text',
      phase: 'text-only',
      text: '这是仅文本模式的测试回复；没有调用工具，也没有生成正式产物。',
      advertisedToolNames: actualNames,
    };
  }

  if (options.mode === 'tool-error') {
    if (alreadyCalled.size === 0) {
      const canonical = 'chapter.read_outline';
      return {
        kind: 'tools',
        phase: 'tool-error',
        calls: createToolCalls([canonical], byCanonical, options, sequence, true),
        advertisedToolNames: actualNames,
      };
    }
    return {
      kind: 'text',
      phase: 'tool-error-final',
      text: '工具调用按预期失败，未生成章节候选，也未修改正式小说事实。',
      advertisedToolNames: actualNames,
    };
  }

  const missingContext = CONTEXT_TOOLS.filter((canonical) => !alreadyCalled.has(canonical));
  if (missingContext.length > 0) {
    return {
      kind: 'tools',
      phase: 'context-tools',
      calls: createToolCalls(missingContext, byCanonical, options, sequence),
      advertisedToolNames: actualNames,
    };
  }
  if (!alreadyCalled.has(GENERATE_TOOL)) {
    return {
      kind: 'tools',
      phase: 'generate-chapter',
      calls: createToolCalls([GENERATE_TOOL], byCanonical, options, sequence),
      advertisedToolNames: actualNames,
    };
  }
  return {
    kind: 'text',
    phase: 'assistant-final',
    text: '已完成上下文读取、记忆检索和章节候选生成。候选正文仅用于人工审阅，尚未写入正式正文。',
    advertisedToolNames: actualNames,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new RangeError('request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw new SyntaxError('request body is empty');
  return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')), bytes };
}

function jsonResponse(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
  });
  response.end(encoded);
}

function chatChunk(requestId, model, choices, usage) {
  return {
    id: requestId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    ...(usage === undefined ? {} : { usage }),
  };
}

function usageFor(summary, completionChars) {
  const promptTokens = Math.max(1, Math.ceil(summary.promptChars / 4));
  return {
    prompt_tokens: promptTokens,
    completion_tokens: Math.max(1, Math.ceil(completionChars / 4)),
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: promptTokens,
  };
}

async function writeEvent(response, signal, summary, payload) {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    throw new ClientClosedError();
  }
  response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
  summary.chunksSent += 1;
}

async function waitForScriptDelay(options, signal) {
  if (options.delayMs === 0) return;
  try {
    await delay(options.delayMs, undefined, { signal });
  } catch (error) {
    if (signal.aborted || error?.name === 'AbortError') throw new ClientClosedError();
    throw error;
  }
}

async function streamPlan(response, body, plan, options, summary, signal) {
  const model = safeName(body.model);
  const requestId = summary.requestId;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-mock-request-id': requestId,
  });

  await writeEvent(
    response,
    signal,
    summary,
    chatChunk(requestId, model, [
      {
        index: 0,
        delta: { role: 'assistant', content: null, reasoning_content: '' },
        finish_reason: null,
      },
    ]),
  );

  if (options.mode === 'delay' || options.mode === 'cancel') {
    await waitForScriptDelay(options, signal);
  }

  let completionChars = 0;
  let finishReason;
  if (plan.kind === 'tools') {
    const toolCalls = plan.calls.map((call, index) => ({
      index,
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    completionChars = plan.calls.reduce(
      (total, call) => total + call.name.length + call.arguments.length,
      0,
    );
    await writeEvent(
      response,
      signal,
      summary,
      chatChunk(requestId, model, [
        {
          index: 0,
          delta: { content: null, tool_calls: toolCalls },
          finish_reason: null,
        },
      ]),
    );
    finishReason = 'tool_calls';
  } else {
    const characters = [...plan.text];
    for (let offset = 0; offset < characters.length; offset += 16) {
      const content = characters.slice(offset, offset + 16).join('');
      completionChars += content.length;
      await writeEvent(
        response,
        signal,
        summary,
        chatChunk(requestId, model, [{ index: 0, delta: { content }, finish_reason: null }]),
      );
      if (options.mode === 'delay') await waitForScriptDelay(options, signal);
    }
    finishReason = 'stop';
  }

  await writeEvent(
    response,
    signal,
    summary,
    chatChunk(
      requestId,
      model,
      [{ index: 0, delta: { content: '' }, finish_reason: finishReason }],
      usageFor(summary, completionChars),
    ),
  );
  await writeEvent(response, signal, summary, '[DONE]');
}

function finishSummary(state, summary, outcome) {
  if (summary.outcome !== 'streaming') return;
  summary.outcome = outcome;
  summary.completedAt = new Date().toISOString();
  summary.durationMs = Math.max(0, Date.now() - summary.startedAtMs);
  delete summary.startedAtMs;
  state.activeRequests = Math.max(0, state.activeRequests - 1);
}

async function handleChat(request, response, state, options, pathname) {
  state.activeRequests += 1;
  state.peakActiveRequests = Math.max(state.peakActiveRequests, state.activeRequests);
  const sequence = ++state.sequence;
  const controller = new AbortController();
  state.controllers.add(controller);
  let completed = false;
  let summary;
  const clientClosed = () => {
    if (!completed) controller.abort(new ClientClosedError());
  };
  request.once('aborted', clientClosed);
  response.once('close', clientClosed);

  try {
    const { body, bytes } = await readJsonBody(request);
    if (!isRecord(body)) throw new TypeError('request body must be a JSON object');
    if (body.stream !== true) throw new TypeError('mock upstream requires stream=true');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const messageSummary = summarizeMessages(messages);
    const requestId = `chatcmpl-mock-workbench-${sequence}`;
    summary = {
      sequence,
      requestId,
      path: pathname,
      mode: options.mode,
      phase: 'planning',
      model: safeName(body.model),
      stream: true,
      includeUsage: body.stream_options?.include_usage === true,
      requestBytes: bytes,
      messageCount: messages.length,
      ...messageSummary,
      maxTokens: Number.isSafeInteger(body.max_tokens) ? body.max_tokens : null,
      advertisedToolNames: [],
      requestedToolNames: [],
      chunksSent: 0,
      outcome: 'streaming',
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
    };
    state.requests.push(summary);

    let plan;
    try {
      plan = createPlan(body, options, sequence);
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      summary.phase = 'contract-error';
      summary.advertisedToolNames = wireTools(body).actualNames;
      summary.missingCanonicalTools = error.missingTools;
      jsonResponse(response, 422, {
        error: {
          message: error.message,
          code: 'MOCK_REQUIRED_TOOL_MISSING',
          missingTools: error.missingTools,
        },
      });
      completed = true;
      finishSummary(state, summary, 'contract_error');
      return;
    }

    summary.phase = plan.phase;
    summary.advertisedToolNames = plan.advertisedToolNames;
    summary.requestedToolNames =
      plan.kind === 'tools' ? plan.calls.map((call) => safeName(call.name)) : [];
    await streamPlan(response, body, plan, options, summary, controller.signal);
    completed = true;
    finishSummary(state, summary, 'completed');
    response.end();
  } catch (error) {
    if (summary === undefined) {
      state.activeRequests = Math.max(0, state.activeRequests - 1);
      const status = error instanceof RangeError ? 413 : 400;
      if (!response.headersSent && !response.destroyed) {
        jsonResponse(response, status, {
          error: {
            message:
              status === 413 ? 'request body is too large' : 'request must be valid streaming JSON',
            code: status === 413 ? 'MOCK_BODY_TOO_LARGE' : 'MOCK_INVALID_REQUEST',
          },
        });
      }
      return;
    }
    const closed =
      error instanceof ClientClosedError || controller.signal.aborted || response.destroyed;
    finishSummary(state, summary, closed ? 'client_closed' : 'server_error');
    if (!closed && !response.headersSent) {
      jsonResponse(response, 500, {
        error: { message: 'mock upstream failed', code: 'MOCK_UPSTREAM_FAILED' },
      });
    } else if (!closed && !response.writableEnded) {
      response.destroy();
    }
  } finally {
    request.off('aborted', clientClosed);
    response.off('close', clientClosed);
    state.controllers.delete(controller);
  }
}

function createState(options) {
  return {
    options,
    baseUrl: undefined,
    sequence: 0,
    activeRequests: 0,
    peakActiveRequests: 0,
    requests: [],
    controllers: new Set(),
  };
}

function requestSnapshot(state) {
  return {
    mode: state.options.mode,
    requestCount: state.requests.length,
    activeRequests: state.activeRequests,
    peakActiveRequests: state.peakActiveRequests,
    requests: state.requests.map((summary) => {
      const safe = { ...summary };
      delete safe.startedAtMs;
      return safe;
    }),
  };
}

/** Start the loopback-only mock and return its discovery/teardown handle. */
export async function startMockWorkbenchUpstream(options = {}) {
  const resolved = resolveOptions(options);
  const state = createState(resolved);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://mock.invalid').pathname;
    if (request.method === 'GET' && pathname === '/health') {
      jsonResponse(response, 200, {
        ok: true,
        ready: true,
        host: HOST,
        mode: resolved.mode,
        requestCount: state.requests.length,
        activeRequests: state.activeRequests,
        peakActiveRequests: state.peakActiveRequests,
      });
      return;
    }
    if (
      request.method === 'GET' &&
      (pathname === '/requests' || pathname === '/request-summaries')
    ) {
      jsonResponse(response, 200, requestSnapshot(state));
      return;
    }
    if (
      request.method === 'POST' &&
      (pathname === '/chat/completions' || pathname === '/v1/chat/completions')
    ) {
      void handleChat(request, response, state, resolved, pathname);
      return;
    }
    if (pathname.endsWith('/chat/completions')) {
      response.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(resolved.port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('mock upstream did not bind a TCP port');
  }
  const baseUrl = `http://${HOST}:${address.port}`;
  state.baseUrl = baseUrl;
  let closeTask;
  const close = () =>
    (closeTask ??= new Promise((resolve) => {
      for (const controller of state.controllers) {
        controller.abort(new Error('mock upstream shutting down'));
      }
      server.close(() => resolve());
      server.closeAllConnections?.();
    }));

  return Object.freeze({
    host: HOST,
    port: address.port,
    mode: resolved.mode,
    baseUrl,
    upstreamBaseUrl: `${baseUrl}/v1`,
    chatCompletionsUrl: `${baseUrl}/v1/chat/completions`,
    healthUrl: `${baseUrl}/health`,
    requestsUrl: `${baseUrl}/requests`,
    close,
  });
}

function isMainModule() {
  if (process.argv[1] === undefined) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    const mock = await startMockWorkbenchUpstream();
    const ready = {
      type: 'mock-workbench-upstream.ready',
      pid: process.pid,
      host: mock.host,
      port: mock.port,
      mode: mock.mode,
      baseUrl: mock.baseUrl,
      upstreamBaseUrl: mock.upstreamBaseUrl,
      chatCompletionsUrl: mock.chatCompletionsUrl,
      healthUrl: mock.healthUrl,
      requestsUrl: mock.requestsUrl,
    };
    process.stdout.write(`${JSON.stringify(ready)}\n`);

    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void mock.close().then(() => {
        process.exitCode = 0;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown startup error';
    process.stderr.write(`[mock-workbench-upstream] ${message}\n`);
    process.exitCode = 1;
  }
}
