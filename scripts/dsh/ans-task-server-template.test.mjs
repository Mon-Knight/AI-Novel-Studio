import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers';
import test from 'node:test';

const SOURCE_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';
const PROTOCOL = 'ans_task_session_v2';
const checkout = resolve(process.env.DSH_CHECKOUT ?? 'F:/dsh-v320-clean');
const publicProtocol = resolve(checkout, 'packages/sdk/protocol/lib/index.js');
const carrierUnavailable = !existsSync(publicProtocol);

async function loadPlugin() {
  const encodedCheckout = pathToFileURL(checkout).href.slice('file:///'.length);
  const source = readFileSync(new URL('./ans-task-server-template.mjs', import.meta.url), 'utf8')
    .replaceAll('{CHECKOUT}', encodedCheckout)
    .replaceAll('{SOURCE_COMMIT}', SOURCE_COMMIT)
    .replaceAll('{PROTOCOL}', PROTOCOL);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function createHarness(plugin, { persisted = false, attestationMode = 'valid' } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const listeners = new Map();
  const effects = [];
  const frames = [];
  const liveAgents = new Map();
  const requestConfigs = [];
  let outputBuffer = '';
  let createCount = 0;
  let resumeCount = 0;
  let followupCount = 0;
  let cancelCount = 0;
  let disposeCount = 0;
  let llmStreamCount = 0;
  let exitCode;

  output.on('data', (chunk) => {
    outputBuffer += chunk.toString();
    for (;;) {
      const newline = outputBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = outputBuffer.slice(0, newline).trim();
      outputBuffer = outputBuffer.slice(newline + 1);
      if (line !== '') frames.push(JSON.parse(line));
    }
  });

  const emit = (event, ...args) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const waterfall = (entries, args, terminal) => {
    const dispatch = (index) =>
      index === entries.length
        ? Promise.resolve(terminal)
        : entries[index](...args, () => dispatch(index + 1));
    return dispatch(0);
  };
  const makeHandle = async (options) => {
    const scopedListeners = new Map();
    const agentCtx = {
      on(event, listener) {
        const entries = scopedListeners.get(event) ?? [];
        entries.push(listener);
        scopedListeners.set(event, entries);
        return () => {
          const index = entries.indexOf(listener);
          if (index >= 0) entries.splice(index, 1);
        };
      },
    };
    options.setup(agentCtx);
    const id = String(options.sessionId ?? options.resumeSessionId);
    const agent = {
      id,
      session: { id },
      activity: Promise.resolve(),
      followup() {
        followupCount += 1;
        emit('agent/status', { agent, status: 'running' });
        agent.activity = (async () => {
          await waterfall(scopedListeners.get('system-prompt/assemble') ?? [], [{}, {}], {
            variables: {},
          });
          requestConfigs.push(
            await waterfall(
              scopedListeners.get('agent/request') ?? [],
              [
                {
                  agent,
                  turn: followupCount,
                  step: 1,
                  signal: new AbortController().signal,
                },
              ],
              { provider: 'old', model: 'old', reasoningEffort: 'old', maxTokens: 1 },
            ),
          );
          emit('agent/status', { agent, status: 'idle' });
        })();
      },
      cancel() {
        cancelCount += 1;
      },
      whenIdle() {
        return agent.activity;
      },
    };
    liveAgents.set(id, agent);
    return {
      agent,
      async dispose() {
        disposeCount += 1;
        liveAgents.delete(id);
      },
    };
  };

  const agents = {
    get(id) {
      return liveAgents.get(String(id));
    },
    async create(options) {
      createCount += 1;
      return makeHandle(options);
    },
    async resume(options) {
      resumeCount += 1;
      return makeHandle(options);
    },
  };
  const novelTools = [
    'mcp__novel__novel_read_context_1e2b3adf9a19',
    'mcp__novel__chapter_read_outline_68634582eb55',
    'mcp__novel__get_character_states',
    'mcp__novel__generate_chapter',
    'mcp__novel__search_memory',
  ];
  const services = new Map(
    [
      'agentLoop',
      'sessions',
      'systemPrompt',
      'sessionTitle',
      'jobs',
      'invariants',
      'tokenMeter',
      'compaction',
    ].map((service) => [service, {}]),
  );
  const llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async (provider) => [
      {
        provider,
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        inputModalities: ['text'],
      },
    ],
    async *stream(options) {
      llmStreamCount += 1;
      const tool = options.tools?.[0];
      const nonce = tool?.parameters?.properties?.nonce?.enum?.[0];
      if (attestationMode === 'valid') {
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: `attestation-${llmStreamCount}`,
            name: tool?.name,
            arguments: JSON.stringify({ nonce }),
          },
        };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      if (attestationMode === 'wrong-nonce') {
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: `attestation-${llmStreamCount}`,
            name: tool?.name,
            arguments: JSON.stringify({ nonce: 'wrong' }),
          },
        };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
        return;
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'no tool call' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const tools = {
    schemas: () => novelTools.map((name) => ({ name })),
  };
  const sessionPersistence = {
    async list(signal) {
      if (signal?.aborted) throw signal.reason;
      return persisted ? [{ id: 'session-a' }] : [];
    },
  };
  const ctx = {
    agents,
    sessionPersistence,
    root: {
      fiber: {
        async dispose() {
          const pending = effects.splice(0);
          await Promise.allSettled(pending.map((dispose) => dispose?.()));
        },
      },
    },
    get(service) {
      if (service === 'loader') return { async await() {} };
      if (service === 'agents') return agents;
      if (service === 'llm') return llm;
      if (service === 'tools') return tools;
      return services.get(service);
    },
    on(event, listener) {
      const entries = listeners.get(event) ?? [];
      entries.push(listener);
      listeners.set(event, entries);
      return () => {
        const index = entries.indexOf(listener);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    effect(start) {
      effects.push(start());
    },
  };
  plugin.apply(ctx, {
    input,
    output,
    exit(code) {
      exitCode = code;
    },
  });

  let nextId = 1;
  async function rpc(method, params, { omitParams = false } = {}) {
    const id = nextId;
    nextId += 1;
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(omitParams ? {} : { params: params ?? {} }),
      })}\n`,
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      const frame = frames.find((candidate) => candidate.id === id);
      if (frame !== undefined) {
        if (frame.error !== undefined) throw new Error(frame.error.message);
        return frame.result;
      }
    }
    throw new Error(`RPC timeout: ${method}`);
  }

  return {
    rpc,
    emit,
    frames,
    stats: () => ({
      createCount,
      resumeCount,
      followupCount,
      cancelCount,
      disposeCount,
      llmStreamCount,
      exitCode,
      requestConfigs,
    }),
  };
}

test(
  'model tool attestation proves a native nonce call without creating a session and caches only success',
  { skip: carrierUnavailable },
  async () => {
    const plugin = await loadPlugin();
    const harness = createHarness(plugin);
    await harness.rpc('initialize', initializeParams);

    const first = await harness.rpc('runtime/attest-model-tools', {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      nonce: 'nonce_a',
    });
    const second = await harness.rpc('runtime/attest-model-tools', {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      nonce: 'nonce_b',
    });
    const health = await harness.rpc('runtime/health', undefined, { omitParams: true });

    assert.equal(first.protocol, 'ans_model_tool_attestation_v1');
    assert.equal(first.verified, true);
    assert.equal(first.cached, false);
    assert.equal(first.cacheTtlMs, 600_000);
    assert.equal(Date.parse(first.expiresAt) - Date.parse(first.verifiedAt), 600_000);
    assert.equal(second.verified, true);
    assert.equal(second.cached, true);
    assert.equal(second.finishKind, 'tool-calls');
    assert.equal(second.observedToolCalls, 1);
    assert.equal(second.verifiedAt, first.verifiedAt);
    assert.equal(second.expiresAt, first.expiresAt);
    assert.equal(second.cacheTtlMs, 600_000);
    assert.equal(harness.stats().llmStreamCount, 1);
    assert.equal(harness.stats().createCount, 0);
    assert.equal(harness.stats().resumeCount, 0);
    assert.equal(harness.stats().followupCount, 0);
    assert.deepEqual(health.modelToolAttestations, [
      {
        protocol: 'ans_model_tool_attestation_v1',
        provider: 'deepseek-official',
        model: 'deepseek-chat',
        verified: true,
        cached: false,
        verifiedAt: first.verifiedAt,
        expiresAt: first.expiresAt,
        cacheTtlMs: 600_000,
        finishKind: 'tool-calls',
        observedToolCalls: 1,
      },
    ]);
  },
);

test(
  'model tool attestation rejects the wrong nonce and does not cache a failed probe',
  { skip: carrierUnavailable },
  async () => {
    const plugin = await loadPlugin();
    const harness = createHarness(plugin, { attestationMode: 'wrong-nonce' });
    await harness.rpc('initialize', initializeParams);

    const first = await harness.rpc('runtime/attest-model-tools', {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      nonce: 'nonce_a',
    });
    const second = await harness.rpc('runtime/attest-model-tools', {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      nonce: 'nonce_b',
    });

    assert.equal(first.verified, false);
    assert.equal(first.failureCode, 'INVALID_TOOL_CALL');
    assert.equal(second.verified, false);
    assert.equal(second.cached, false);
    assert.equal(harness.stats().llmStreamCount, 2);
    assert.equal(harness.stats().createCount, 0);
  },
);

const initializeParams = {
  cwd: resolve('.'),
  provider: 'deepseek-official',
  model: 'deepseek-chat',
  maxTokens: 100,
  sourceCommit: SOURCE_COMMIT,
  protocol: PROTOCOL,
};

for (const persisted of [false, true]) {
  test(
    `persistent ${persisted ? 'resume' : 'create'} keeps one handle and switches later turns`,
    { skip: carrierUnavailable },
    async () => {
      const plugin = await loadPlugin();
      const harness = createHarness(plugin, { persisted });
      const firstInitialize = await harness.rpc('initialize', initializeParams);
      const secondInitialize = await harness.rpc('initialize', {
        ...initializeParams,
        model: 'deepseek-reasoner',
      });
      assert.equal(firstInitialize.reinitialized, false);
      assert.equal(secondInitialize.reinitialized, true);

      const first = await harness.rpc('session/prompt', {
        sessionId: 'session-a',
        contentBlocks: [{ type: 'text', text: 'first' }],
        route: {
          provider: 'deepseek-official',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
          maxTokens: 222,
        },
      });
      const second = await harness.rpc('session/prompt', {
        sessionId: 'session-a',
        contentBlocks: [{ type: 'text', text: 'follow-up' }],
        route: {
          provider: 'deepseek-official',
          model: 'deepseek-reasoner',
          reasoningEffort: null,
          maxTokens: 333,
        },
      });
      const cancelled = await harness.rpc('session/cancel', { sessionId: 'session-a' });
      const health = await harness.rpc('runtime/health', undefined, { omitParams: true });
      const stats = harness.stats();

      assert.equal(first.lifecycle, persisted ? 'resumed' : 'created');
      assert.equal(second.lifecycle, 'continued');
      assert.equal(first.sessionId, 'session-a');
      assert.equal(first.agentId, 'session-a');
      assert.deepEqual([stats.createCount, stats.resumeCount], persisted ? [0, 1] : [1, 0]);
      assert.equal(stats.followupCount, 2);
      assert.equal(cancelled.cancelled, true);
      assert.equal(stats.cancelCount, 1);
      assert.deepEqual(stats.requestConfigs.at(-1), {
        provider: 'deepseek-official',
        model: 'deepseek-reasoner',
        maxTokens: 333,
      });
      assert.equal(health.ready, true);
      assert.equal(health.protocol, PROTOCOL);
      assert.equal(health.composition.length, 7);
      assert.ok(health.composition.some((entry) => entry.id === 'compaction-basic'));
      assert.ok(health.composition.every((entry) => entry.status === 'loaded'));
      assert.equal(health.providers[0].models[0].id, 'deepseek-chat');
      assert.equal(health.toolsProjection, 'public-scoped-registry');
      assert.deepEqual(health.tools.global, [
        'mcp__novel__chapter_read_outline_68634582eb55',
        'mcp__novel__generate_chapter',
        'mcp__novel__get_character_states',
        'mcp__novel__novel_read_context_1e2b3adf9a19',
        'mcp__novel__search_memory',
      ]);
    },
  );
}

test(
  'wire validation and notification projection do not expose hidden prompt or reasoning',
  {
    skip: carrierUnavailable,
  },
  async () => {
    const plugin = await loadPlugin();
    const harness = createHarness(plugin);
    await assert.rejects(
      harness.rpc('initialize', { ...initializeParams, sourceCommit: 'wrong' }),
      /sourceCommit/,
    );
    await harness.rpc('initialize', initializeParams);
    await assert.rejects(
      harness.rpc('session/prompt', {
        sessionId: 'session-a',
        contentBlocks: [{ type: 'text', text: 'task', apiKey: 'must-not-cross-wire' }],
      }),
      /credential fields|unsupported field/,
    );

    const session = { id: 'session-a' };
    harness.emit('session/event', session, {
      type: 'request/header',
      seq: 1,
      time: 1,
      data: { header: { system: 'hidden system prompt' } },
    });
    harness.emit('session/event', session, {
      type: 'assistant/message',
      seq: 2,
      time: 2,
      data: {
        message: {
          content: [
            { type: 'reasoning', text: 'private chain of thought' },
            { type: 'text', text: 'visible answer' },
          ],
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const serialized = JSON.stringify(harness.frames);
    assert.doesNotMatch(
      serialized,
      /hidden system prompt|private chain of thought|must-not-cross-wire/,
    );
    assert.match(serialized, /visible answer/);
  },
);

test(
  'health and shutdown accept omitted params and shutdown flushes before exit',
  {
    skip: carrierUnavailable,
  },
  async () => {
    const plugin = await loadPlugin();
    const harness = createHarness(plugin);
    await harness.rpc('initialize', initializeParams);
    const health = await harness.rpc('runtime/health', undefined, { omitParams: true });
    assert.equal(health.ready, true);
    assert.deepEqual(await harness.rpc('shutdown', undefined, { omitParams: true }), {});
    for (let attempt = 0; attempt < 100 && harness.stats().exitCode === undefined; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(harness.stats().exitCode, 0);
  },
);
