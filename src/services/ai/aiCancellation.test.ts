import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { createServer } from 'vite';
import type {
  AiGenerateRequest,
  AiPricingSnapshot,
  AiStreamEvent,
  AiTaskRecord,
} from '../../types/ai';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const originalFetch = globalThis.fetch;
const vite = await createServer({
  appType: 'custom',
  define: {
    'import.meta.env.VITE_AI_NOVEL_STUDIO_E2E': JSON.stringify('1'),
  },
  server: { middlewareMode: true, hmr: false },
});

const realModule = (await vite.ssrLoadModule(
  '/src/services/ai/realAiClient.ts',
)) as typeof import('./realAiClient');
const compilationRegistryModule = (await vite.ssrLoadModule(
  '/src/services/ai/compilation/productionCompilationRegistry.ts',
)) as typeof import('./compilation/productionCompilationRegistry');
const mockModule = (await vite.ssrLoadModule(
  '/src/services/ai/mockAiClient.ts',
)) as typeof import('./mockAiClient');
const cancellationModule = (await vite.ssrLoadModule(
  '/src/services/ai/aiCancellation.ts',
)) as typeof import('./aiCancellation');
const qualityModule = (await vite.ssrLoadModule(
  '/src/services/ai/qualityCheckAiService.ts',
)) as typeof import('./qualityCheckAiService');
const taskModule = (await vite.ssrLoadModule(
  '/src/services/ai/aiTaskService.ts',
)) as typeof import('./aiTaskService');

const request: AiGenerateRequest = {
  taskType: 'quality_check',
  messages: [
    { role: 'system', content: '质量检查' },
    { role: 'user', content: '测试正文' },
  ],
};

const POLICY_IPC_UNHANDLED = Symbol('policy-ipc-unhandled');

function handlePolicyIpc(command: string, args: Record<string, unknown>): unknown {
  if (command === 'reserve_ai_request') {
    const input = args.input as Record<string, unknown>;
    return {
      reservationId: `reservation-${String(input.ownerId)}`,
      ownerId: input.ownerId,
      providerRequestId: input.providerRequestId,
      leaseToken: 'test-policy-lease-token',
      expiresAtMs: Date.now() + 120_000,
      policyRevision: 1,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: input.estimatedOutputTokens,
      estimatedTokens:
        Number(input.estimatedInputTokens ?? 0) + Number(input.estimatedOutputTokens ?? 0),
      inputPricePerMillionTokens: input.inputPricePerMillionTokens,
      outputPricePerMillionTokens: input.outputPricePerMillionTokens,
    };
  }
  if (command === 'settle_ai_request') {
    const input = args.input as Record<string, unknown>;
    return {
      reservationId: input.reservationId,
      status: input.outcome === 'succeeded' ? 'settled' : 'failed',
      replayed: false,
    };
  }
  return POLICY_IPC_UNHANDLED;
}

function createRealClient(timeoutSeconds = 1) {
  return new realModule.RealAiClient({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    modelName: 'test-model',
    timeoutSeconds,
  });
}

async function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  clearMocks();
  storage.clear();
  globalThis.fetch = originalFetch;
  if (mockModule.getMockAiGateStateForE2e().paused) {
    mockModule.releaseMockAiForE2e();
  }
});

after(async () => {
  clearMocks();
  globalThis.fetch = originalFetch;
  if (mockModule.getMockAiGateStateForE2e().paused) {
    mockModule.releaseMockAiForE2e();
  }
  await vite.close();
});

test('Tauri cancellation waits for cancel_ai_request confirmation', async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  let rejectActiveRequest: ((reason?: unknown) => void) | undefined;
  let confirmCancellation: (() => void) | undefined;
  let markRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });

  mockIPC((command, args) => {
    calls.push({ command, args });
    const policyResult = handlePolicyIpc(command, args);
    if (policyResult !== POLICY_IPC_UNHANDLED) return policyResult;
    if (command === 'ai_chat_completion') {
      markRequestStarted?.();
      return new Promise((_resolve, reject) => {
        rejectActiveRequest = reject;
      });
    }
    if (command === 'cancel_ai_request') {
      return new Promise<boolean>((resolve) => {
        confirmCancellation = () => {
          rejectActiveRequest?.(cancellationModule.AI_REQUEST_CANCELLED);
          resolve(true);
        };
      });
    }
    throw new Error(`Unexpected command: ${command}`);
  });

  const controller = new AbortController();
  const result = createRealClient().generate(request, {
    signal: controller.signal,
    requestId: 'request-cancel-test',
  });
  let resultSettled = false;
  void result.then(
    () => {
      resultSettled = true;
    },
    () => {
      resultSettled = true;
    },
  );
  await requestStarted;
  controller.abort();

  await waitForCondition(
    () => calls.some((call) => call.command === 'cancel_ai_request'),
    'cancel_ai_request was not invoked',
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resultSettled, false);
  assert.ok(confirmCancellation);
  confirmCancellation();
  await assert.rejects(result, (error: unknown) => cancellationModule.isAiRequestCancelled(error));

  const startCall = calls.find((call) => call.command === 'ai_chat_completion');
  const startRequest = startCall?.args.request as Record<string, unknown> | undefined;
  const cancelCall = calls.find((call) => call.command === 'cancel_ai_request');
  assert.equal(startRequest?.requestId, 'request-cancel-test');
  assert.deepEqual(startRequest?.policyLease, {
    reservationId: startRequest?.policyLease
      ? (startRequest.policyLease as Record<string, unknown>).reservationId
      : undefined,
    ownerId: startRequest?.policyLease
      ? (startRequest.policyLease as Record<string, unknown>).ownerId
      : undefined,
    providerRequestId: 'request-cancel-test',
    leaseToken: 'test-policy-lease-token',
  });
  assert.equal(cancelCall?.args.requestId, 'request-cancel-test');
  assert.equal(calls.filter((call) => call.command === 'cancel_ai_request').length, 1);
});

test('Tauri cancellation IPC failure waits for the original request to settle', async () => {
  let resolveActiveRequest: ((value: { text: string }) => void) | undefined;
  let markRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));

  try {
    mockIPC((command, args) => {
      const policyResult = handlePolicyIpc(command, args);
      if (policyResult !== POLICY_IPC_UNHANDLED) return policyResult;
      if (command === 'ai_chat_completion') {
        markRequestStarted?.();
        return new Promise<{ text: string }>((resolve) => {
          resolveActiveRequest = resolve;
        });
      }
      if (command === 'cancel_ai_request') {
        throw new Error('Bearer secret-token cancellation transport failure');
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const controller = new AbortController();
    const result = createRealClient().generate(request, {
      signal: controller.signal,
      requestId: 'request-cancel-ipc-failure',
    });
    let resultSettled = false;
    void result.then(
      () => {
        resultSettled = true;
      },
      () => {
        resultSettled = true;
      },
    );
    await requestStarted;
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(resultSettled, false);
    assert.ok(resolveActiveRequest);
    resolveActiveRequest({ text: 'late provider response' });
    await assert.rejects(result, (error: unknown) =>
      cancellationModule.isAiRequestCancelled(error),
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not be confirmed/);
    assert.doesNotMatch(warnings[0], /secret-token|Bearer/);
  } finally {
    console.warn = originalWarn;
  }
});

test('Tauri cancellation settles when the original request finishes before a stalled cancel IPC', async () => {
  const calls: string[] = [];
  let resolveActiveRequest: ((value: { text: string }) => void) | undefined;
  let markRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });

  mockIPC((command, args) => {
    const policyResult = handlePolicyIpc(command, args);
    if (policyResult !== POLICY_IPC_UNHANDLED) return policyResult;
    calls.push(command);
    if (command === 'ai_chat_completion') {
      markRequestStarted?.();
      return new Promise<{ text: string }>((resolve) => {
        resolveActiveRequest = resolve;
      });
    }
    if (command === 'cancel_ai_request') {
      return new Promise<boolean>(() => {});
    }
    throw new Error(`Unexpected command: ${command}`);
  });

  const controller = new AbortController();
  const result = createRealClient().generate(request, {
    signal: controller.signal,
    requestId: 'request-cancel-ipc-stalled',
  });
  let resultSettled = false;
  void result.then(
    () => {
      resultSettled = true;
    },
    () => {
      resultSettled = true;
    },
  );
  await requestStarted;
  controller.abort();
  await waitForCondition(
    () => calls.includes('cancel_ai_request'),
    'stalled cancel_ai_request was not invoked',
  );
  assert.equal(resultSettled, false);

  assert.ok(resolveActiveRequest);
  resolveActiveRequest({ text: 'late but safely settled provider response' });
  await waitForCondition(
    () => resultSettled,
    'caller remained blocked after the original request safely settled',
  );
  await assert.rejects(result, (error: unknown) => cancellationModule.isAiRequestCancelled(error));
});

test('provider failure remains primary when conservative policy settlement also fails', async () => {
  const providerFailure = new Error('primary provider failure');
  const settlementFailure = new Error('secondary settlement failure');
  const capturedErrors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => capturedErrors.push(args.map(String).join(' '));

  try {
    mockIPC((command, args) => {
      if (command === 'reserve_ai_request') return handlePolicyIpc(command, args);
      if (command === 'ai_chat_completion') throw providerFailure;
      if (command === 'settle_ai_request') throw settlementFailure;
      throw new Error(`Unexpected command: ${command}`);
    });

    await assert.rejects(
      createRealClient().generate(request, { requestId: 'provider-primary-error' }),
      (error: unknown) => error === providerFailure,
    );
    assert.equal(capturedErrors.length, 1);
    assert.match(capturedErrors[0], /AI_REQUEST_POLICY_SETTLEMENT_FAILED_AFTER_PROVIDER_FAILURE/);
    assert.doesNotMatch(capturedErrors[0], /secondary settlement failure/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('successful provider output is withheld when policy settlement fails closed', async () => {
  const settlementFailure = new Error('settlement unavailable');
  mockIPC((command, args) => {
    if (command === 'reserve_ai_request') return handlePolicyIpc(command, args);
    if (command === 'ai_chat_completion') return { text: 'provider success' };
    if (command === 'settle_ai_request') throw settlementFailure;
    throw new Error(`Unexpected command: ${command}`);
  });

  await assert.rejects(
    createRealClient().generate(request, { requestId: 'provider-success-settle-failure' }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'UNKNOWN_ERROR' &&
      (error as { message?: string }).message === settlementFailure.message,
  );
});

test('browser caller cancellation is distinct from request timeout', async () => {
  clearMocks();
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', rejectAbort, { once: true });
      if (signal?.aborted) rejectAbort();
    })) as typeof fetch;

  const controller = new AbortController();
  const cancelled = createRealClient().generate(request, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, (error: unknown) =>
    cancellationModule.isAiRequestCancelled(error),
  );

  const timedOut = createRealClient(0.01).generate(request);
  await assert.rejects(
    timedOut,
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('请求超时') &&
      !cancellationModule.isAiRequestCancelled(error),
  );
});

test('browser HTTP errors do not expose provider response bodies', async () => {
  clearMocks();
  const sensitiveBody = 'Bearer secret-token full sensitive prompt';
  globalThis.fetch = (async () => new Response(sensitiveBody, { status: 500 })) as typeof fetch;

  await assert.rejects(
    createRealClient().generate(request),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('模型服务错误（500）') &&
      !error.message.includes(sensitiveBody) &&
      !error.message.includes('secret-token'),
  );
});

test('browser malformed success responses do not expose provider response bodies', async () => {
  clearMocks();
  const sensitiveBody = 'Bearer secret-token full sensitive prompt';
  globalThis.fetch = (async () => new Response(sensitiveBody, { status: 200 })) as typeof fetch;

  await assert.rejects(
    createRealClient().generate(request),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'AI 调用失败：模型服务返回了无法解析的响应。' &&
      !error.message.includes(sensitiveBody) &&
      !error.message.includes('secret-token'),
  );
});

test('connection test reserves enough output budget for reasoning-compatible models', () => {
  assert.equal(
    compilationRegistryModule.productionCompilationRegistryPrivate.definitions.connection_test
      ?.maxOutputTokens,
    128,
  );
});

test('local scene request body carries llama.cpp sampling parameters', () => {
  const body = realModule.buildOpenAiChatRequestBody(
    {
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'local-no-key-required',
      modelName: 'qwen35-9b-novel-v3',
      temperature: 0.7,
      maxTokens: 1024,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.08,
      seed: 7,
    },
    {
      taskType: 'chapter_scene_generate',
      messages: [{ role: 'user', content: 'scene smoke test' }],
    },
  );
  assert.equal(body.model, 'qwen35-9b-novel-v3');
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.top_p, 0.8);
  assert.equal(body.top_k, 20);
  assert.equal(body.repeat_penalty, 1.08);
  assert.equal(body.seed, 7);
  assert.equal(body.stream, undefined);
});

test('DeepSeek V4 Beat repair request body disables high-cost thinking', () => {
  const body = realModule.buildOpenAiChatRequestBody(
    {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key',
      modelName: 'deepseek-v4-flash',
    },
    {
      taskType: 'chapter_beat_repair',
      messages: [{ role: 'user', content: 'repair one Beat' }],
      thinkingMode: 'disabled',
      maxTokens: 4_000,
    },
  );
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.max_tokens, 4_000);
});

test('chapter generation is registered as a candidate-only compiled contract', () => {
  const definition =
    compilationRegistryModule.productionCompilationRegistryPrivate.definitions.chapter_generate;
  assert.equal(definition?.expectedArtifactType, 'chapter_text');
  assert.deepEqual(definition?.requiredSourceTypes, ['request_context']);
  assert.equal(definition?.constraints.candidateOnly, true);
  assert.equal(definition?.constraints.mayWriteBusinessData, false);
  assert.equal(typeof definition?.userPrompt, 'function');
  if (typeof definition?.userPrompt === 'function') {
    assert.match(
      definition.userPrompt({ chapterTitle: '第一章', contextHash: 'a'.repeat(64) }),
      /CHAPTER_GENERATE_REQUEST/,
    );
  }
});

test('external Beat repair has a dedicated reasoning-aware compiled contract', () => {
  const definition =
    compilationRegistryModule.productionCompilationRegistryPrivate.definitions.chapter_beat_repair;
  assert.equal(definition?.expectedArtifactType, 'chapter_text');
  assert.equal(definition?.constraints.outputMode, 'beat_prose');
  assert.equal(definition?.constraints.candidateOnly, true);
  assert.equal(definition?.maxOutputTokens, 4_000);
  assert.equal(definition?.defaultTemperature, 0.35);
  assert.equal(definition?.thinkingMode, 'disabled');
  assert.match(definition?.promptTemplateBody ?? '', /exactly one rejected Beat/);
  assert.equal(typeof definition?.userPrompt, 'function');
  if (typeof definition?.userPrompt === 'function') {
    assert.match(
      definition.userPrompt({
        chapterTitle: '第二章',
        contextHash: 'b'.repeat(64),
        sceneNo: 1,
        beatOrder: 2,
        targetWordCount: 1150,
        minimumCharacterCount: 500,
        maximumCharacterCount: 750,
        rawMinimumCharacterCount: 1550,
        rawMaximumCharacterCount: 1850,
        paragraphCount: 14,
        requiredBeatText: '多户案例指向海葵诊所，林舟决定次日伪装成患者调查。',
      }),
      /CHAPTER_BEAT_REPAIR_REQUEST[\s\S]*Minimum effective narrative characters[\s\S]*: 1150[\s\S]*Accepted envelope after safe complete-sentence trimming: 500-750[\s\S]*generation target intentionally exceeds[\s\S]*Required Beat[\s\S]*海葵诊所[\s\S]*until at least 1150 effective characters[\s\S]*must contain 1550-1850 characters[\s\S]*Use exactly 14 substantive prose paragraphs/,
    );
  }
});

test('browser discards non-empty partial output when the provider reports token truncation', async () => {
  clearMocks();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: 'partial response contains Bearer private-output and must not be surfaced',
              reasoning_content: 'private reasoning must not be surfaced',
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  await assert.rejects(
    createRealClient().generate(request),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('输出 Token 上限') &&
      error.message.includes('内容不完整且未采纳') &&
      !error.message.includes('private-output') &&
      !error.message.includes('private reasoning') &&
      !error.message.includes('Bearer'),
  );
});

test('browser rejects non-string provider content instead of returning an invalid response type', async () => {
  clearMocks();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: [{ type: 'text', text: 'unexpected content part' }] },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  await assert.rejects(
    createRealClient().generate(request),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('内容格式无效') &&
      !error.message.includes('unexpected content part'),
  );
});

test('browser fetch transport uses global timers when no window global exists', async () => {
  clearMocks();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'headless response' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
      { status: 200 },
    )) as typeof fetch;

  Reflect.deleteProperty(globalThis, 'window');
  try {
    const result = await createRealClient().generate(request);
    assert.equal(result.text, 'headless response');
    assert.equal(result.tokenTotal, 5);
  } finally {
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  }
});

test('browser streaming emits ordered UTF-8 deltas before returning the exact aggregate', async () => {
  clearMocks();
  const encoder = new TextEncoder();
  const source = [
    'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"好🌙"},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  const bytes = encoder.encode(source);
  const chunks: Uint8Array[] = [];
  const widths = [1, 2, 5, 3, 11, 4, 7];
  for (let offset = 0, index = 0; offset < bytes.length; index += 1) {
    const end = Math.min(bytes.length, offset + widths[index % widths.length]);
    chunks.push(bytes.slice(offset, end));
    offset = end;
  }
  let postedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }) as typeof fetch;

  const events: AiStreamEvent[] = [];
  let settled = false;
  const resultPromise = createRealClient().generate(request, {
    stream: true,
    requestId: 'browser-stream-order',
    onStreamEvent(event) {
      if (event.type === 'delta') assert.equal(settled, false);
      events.push(event);
    },
  });
  void resultPromise.finally(() => {
    settled = true;
  });
  const result = await resultPromise;

  assert.equal(postedBody?.stream, true);
  assert.equal(result.text, '你好🌙');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(
    events.filter((event) => event.type === 'delta'),
    [
      { type: 'delta', requestId: 'browser-stream-order', sequence: 1, text: '你' },
      { type: 'delta', requestId: 'browser-stream-order', sequence: 2, text: '好🌙' },
    ],
  );
  assert.ok(events.some((event) => event.type === 'started'));
  assert.ok(events.some((event) => event.type === 'usage' && event.tokenTotal === 10));
  assert.ok(events.some((event) => event.type === 'completed'));
});

test('browser streaming rejects an unmarked EOF and never reports completion', async () => {
  clearMocks();
  globalThis.fetch = (async () =>
    new Response(
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"未完成"},"finish_reason":null}]}\n\n',
      ),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )) as typeof fetch;
  const events: AiStreamEvent[] = [];

  await assert.rejects(
    createRealClient().generate(request, {
      stream: true,
      onStreamEvent: (event) => events.push(event),
    }),
    (error: unknown) => error instanceof Error && error.message.includes('完成标记前中断'),
  );
  assert.ok(events.some((event) => event.type === 'delta'));
  assert.ok(events.some((event) => event.type === 'error'));
  assert.equal(
    events.some((event) => event.type === 'completed'),
    false,
  );
});

test('Mock AI abort removes a paused waiter and remains released safely', async () => {
  const baseline = mockModule.getMockAiGateStateForE2e().requestCount;
  mockModule.pauseMockAiForE2e();
  const controller = new AbortController();
  const result = new mockModule.MockAiClient().generate(request, { signal: controller.signal });

  await waitForCondition(
    () => mockModule.getMockAiGateStateForE2e().waitingRequests === 1,
    'Mock AI request did not enter the pause gate',
  );
  controller.abort();

  await assert.rejects(result, (error: unknown) => cancellationModule.isAiRequestCancelled(error));
  assert.deepEqual(mockModule.getMockAiGateStateForE2e(), {
    paused: true,
    waitingRequests: 0,
    requestCount: baseline + 1,
  });
  assert.deepEqual(mockModule.releaseMockAiForE2e(), {
    paused: false,
    waitingRequests: 0,
    requestCount: baseline + 1,
  });
});

test('Mock AI abort also interrupts the post-gate response delay', async () => {
  const baseline = mockModule.getMockAiGateStateForE2e().requestCount;
  const controller = new AbortController();
  const result = new mockModule.MockAiClient().generate(request, { signal: controller.signal });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(mockModule.getMockAiGateStateForE2e().requestCount, baseline + 1);
  controller.abort();

  await assert.rejects(result, (error: unknown) => cancellationModule.isAiRequestCancelled(error));
  assert.equal(mockModule.getMockAiGateStateForE2e().waitingRequests, 0);
});

test('quality check cancellation records the AI task as cancelled', async () => {
  mockModule.pauseMockAiForE2e();
  const controller = new AbortController();
  const result = qualityModule.qualityCheckAiService.runCheck(
    {
      novelId: 'novel-cancel-test',
      chapterId: 'chapter-cancel-test',
      draftId: 'draft-cancel-test',
      draftContent: '等待取消的质量检查正文。',
      chapterTitle: '取消测试章节',
    },
    {
      signal: controller.signal,
      requestId: 'quality-cancel-test',
      cancel: () => controller.abort(),
    },
  );

  await waitForCondition(
    () => mockModule.getMockAiGateStateForE2e().waitingRequests === 1,
    'Quality check did not enter the Mock AI pause gate',
  );
  const runningTasks = await taskModule.aiTaskService.getByChapterId('chapter-cancel-test');
  assert.equal(runningTasks.length, 1);
  assert.equal(runningTasks[0]?.status, 'running');
  assert.equal(taskModule.aiTaskService.getActiveExecutionState(runningTasks[0].id), 'active');
  assert.equal(taskModule.aiTaskService.cancelActiveExecution(runningTasks[0].id), 'requested');
  assert.equal(controller.signal.aborted, true);
  await assert.rejects(result, (error: unknown) => cancellationModule.isAiRequestCancelled(error));

  const tasks = await taskModule.aiTaskService.getByChapterId('chapter-cancel-test');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.status, 'cancelled');
  assert.ok(tasks[0]?.finishedAt);

  await taskModule.aiTaskService.markSucceeded(tasks[0].id, { resultText: 'late result' });
  const afterLateSuccess = await taskModule.aiTaskService.getByChapterId('chapter-cancel-test');
  assert.equal(afterLateSuccess[0]?.status, 'cancelled');
  assert.equal(taskModule.aiTaskService.getActiveExecutionState(tasks[0].id), 'inactive');
});

test('task-center cancellation reaches every concurrent owner for the same formal task', () => {
  let firstCancelled = 0;
  let secondCancelled = 0;
  const releaseFirst = taskModule.aiTaskService.registerActiveExecution('shared-task', () => {
    firstCancelled += 1;
  });
  const releaseSecond = taskModule.aiTaskService.registerActiveExecution('shared-task', () => {
    secondCancelled += 1;
  });

  assert.equal(taskModule.aiTaskService.getActiveExecutionState('shared-task'), 'active');
  assert.equal(taskModule.aiTaskService.cancelActiveExecution('shared-task'), 'requested');
  assert.equal(firstCancelled, 1);
  assert.equal(secondCancelled, 1);
  assert.equal(taskModule.aiTaskService.getActiveExecutionState('shared-task'), 'cancelling');
  assert.equal(taskModule.aiTaskService.cancelActiveExecution('shared-task'), 'already_requested');

  releaseFirst();
  assert.equal(taskModule.aiTaskService.getActiveExecutionState('shared-task'), 'cancelling');
  releaseSecond();
  assert.equal(taskModule.aiTaskService.getActiveExecutionState('shared-task'), 'inactive');
});

test('LocalStorage task cost freezes pricing and survives successful round-trip', async () => {
  const pricing: AiPricingSnapshot = {
    currency: 'USD',
    source: 'user_configured',
    inputPricePerMillionTokens: 2,
    outputPricePerMillionTokens: 8,
  };
  const created = await taskModule.aiTaskService.create('chapter_generate', {
    novelId: 'novel-cost-test',
    chapterId: 'chapter-cost-test',
    runtimeMode: 'api',
    provider: 'openai_compatible',
    modelName: 'cost-model',
    pricing,
  });

  assert.deepEqual(
    {
      inputPricePerMillionTokens: created.inputPricePerMillionTokens,
      outputPricePerMillionTokens: created.outputPricePerMillionTokens,
      costCurrency: created.costCurrency,
      pricingSource: created.pricingSource,
    },
    {
      inputPricePerMillionTokens: 2,
      outputPricePerMillionTokens: 8,
      costCurrency: 'USD',
      pricingSource: 'user_configured',
    },
  );

  // Mutating the caller-owned object after creation must not change the durable snapshot.
  pricing.inputPricePerMillionTokens = 999;
  pricing.outputPricePerMillionTokens = 999;
  await taskModule.aiTaskService.markSucceeded(created.id, {
    resultText: 'metered result',
    tokenInput: 250_000,
    tokenOutput: 125_000,
  });

  const roundTripped = await taskModule.aiTaskService.getByChapterId('chapter-cost-test');
  assert.equal(roundTripped.length, 1);
  assert.deepEqual(
    {
      status: roundTripped[0]?.status,
      tokenInput: roundTripped[0]?.tokenInput,
      tokenOutput: roundTripped[0]?.tokenOutput,
      inputPricePerMillionTokens: roundTripped[0]?.inputPricePerMillionTokens,
      outputPricePerMillionTokens: roundTripped[0]?.outputPricePerMillionTokens,
      costEstimate: roundTripped[0]?.costEstimate,
      costCurrency: roundTripped[0]?.costCurrency,
      costStatus: roundTripped[0]?.costStatus,
      pricingSource: roundTripped[0]?.pricingSource,
    },
    {
      status: 'succeeded',
      tokenInput: 250_000,
      tokenOutput: 125_000,
      inputPricePerMillionTokens: 2,
      outputPricePerMillionTokens: 8,
      costEstimate: 1.5,
      costCurrency: 'USD',
      costStatus: 'complete',
      pricingSource: 'user_configured',
    },
  );

  const serialized = storage.getItem('ai_novel_studio_ai_tasks');
  assert.ok(serialized);
  const persisted = JSON.parse(serialized) as AiTaskRecord[];
  const persistedTask = persisted.find((item) => item.id === created.id);
  assert.equal(persistedTask?.costEstimate, 1.5);
  assert.equal(persistedTask?.inputPricePerMillionTokens, 2);
  assert.equal(persistedTask?.outputPricePerMillionTokens, 8);
});

test('LocalStorage projection replay preserves identity and rejects conflicting ownership', async () => {
  const first = await taskModule.aiTaskService.create('chapter_generate', {
    id: 'projection-identity-test',
    novelId: 'novel-identity',
    chapterId: 'chapter-identity',
    runtimeMode: 'mock',
    provider: 'mock',
    modelName: 'Mock',
    pricing: {
      currency: 'USD',
      source: 'mock',
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    },
  });
  const replay = await taskModule.aiTaskService.create('chapter_generate', {
    id: first.id,
    novelId: 'novel-identity',
    chapterId: 'chapter-identity',
    runtimeMode: 'mock',
    provider: 'mock',
    modelName: 'Mock',
    pricing: {
      currency: 'USD',
      source: 'mock',
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    },
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.createdAt, first.createdAt);
  await assert.rejects(
    () =>
      taskModule.aiTaskService.create('chapter_generate', {
        id: first.id,
        novelId: 'other-novel',
        chapterId: 'chapter-identity',
        runtimeMode: 'mock',
        provider: 'mock',
        modelName: 'Mock',
        pricing: {
          currency: 'USD',
          source: 'mock',
          inputPricePerMillionTokens: 0,
          outputPricePerMillionTokens: 0,
        },
      }),
    /身份冲突/,
  );
  await taskModule.aiTaskService.markFailed(first.id, 'retryable');
  assert.equal(
    (await taskModule.aiTaskService.getByChapterId('chapter-identity'))[0]?.status,
    'failed',
  );
  await taskModule.aiTaskService.markRunningForRetry(first.id);
  assert.equal(
    (await taskModule.aiTaskService.getByChapterId('chapter-identity'))[0]?.status,
    'running',
  );
  await taskModule.aiTaskService.markCancelled(first.id);
});

test('LocalStorage deletion keeps running task provenance until terminal settlement', async () => {
  const running = await taskModule.aiTaskService.create('chapter_generate', {
    id: 'running-delete-test',
    novelId: 'novel-delete',
    chapterId: 'chapter-delete',
    runtimeMode: 'mock',
    provider: 'mock',
    modelName: 'Mock',
    pricing: {
      currency: 'USD',
      source: 'mock',
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    },
  });
  await assert.rejects(() => taskModule.aiTaskService.deleteOne(running.id), /不能删除/);
  await assert.rejects(() => taskModule.aiTaskService.deleteMany([running.id]), /包含运行中/);
  await assert.rejects(() => taskModule.aiTaskService.clearAll(), /请先停止/);
  assert.equal((await taskModule.aiTaskService.getByChapterId('chapter-delete')).length, 1);

  await taskModule.aiTaskService.markCancelled(running.id);
  assert.equal((await taskModule.aiTaskService.deleteOne(running.id)).deletedCount, 1);
  assert.equal((await taskModule.aiTaskService.getByChapterId('chapter-delete')).length, 0);
});
