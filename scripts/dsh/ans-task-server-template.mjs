/**
 * AI Novel Studio persistent task bridge for the pinned DeepSeek Harness.
 *
 * This file is a render-time template. `{CHECKOUT}` becomes the absolute,
 * slash-normalized checkout/runtime-payload path before Cordis imports it.
 * Stdout is reserved exclusively for newline-delimited JSON-RPC frames.
 *
 * The only Harness seams used below are public exports from commit
 * 47f943859bef60e4160492346772ded9b24f765a. Agent Loop, inbox, Session, and
 * persistence behavior stay owned by the fixed carrier; this plugin only
 * retains public AgentHandle capabilities and adapts them to ANS JSON-RPC.
 */

import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { JsonRpcLineTransport } from 'file:///{CHECKOUT}/packages/sdk/protocol/lib/index.js';
import { installModelSelection } from 'file:///{CHECKOUT}/packages/core/agent/lib/index.js';
import { createUserMessage } from 'file:///{CHECKOUT}/packages/llm/llm/lib/index.js';
import { SessionId } from 'file:///{CHECKOUT}/packages/core/session/lib/index.js';

const SOURCE_COMMIT = '{SOURCE_COMMIT}';
const PROTOCOL = '{PROTOCOL}';
const SERVER_NAME = 'ai-novel-studio-dsh-task-runtime';
const SERVER_VERSION = '1.0.0';
const MAX_ID_LENGTH = 200;
const MAX_ROUTE_LENGTH = 256;
const MAX_PATH_LENGTH = 4096;
const MAX_CONTENT_BLOCKS = 16;
const MAX_PROMPT_CHARS = 2_000_000;
const MODEL_TOOL_ATTESTATION_PROTOCOL = 'ans_model_tool_attestation_v1';
const MODEL_TOOL_ATTESTATION_NAME = 'ans_runtime_attest_tool_call_v1';
const MODEL_TOOL_ATTESTATION_TIMEOUT_MS = 30_000;
const MODEL_TOOL_ATTESTATION_MAX_TOKENS = 128;
const MODEL_TOOL_ATTESTATION_TTL_MS = 10 * 60_000;

const INITIALIZE_KEYS = new Set([
  'cwd',
  'provider',
  'model',
  'reasoningEffort',
  'maxTokens',
  'sourceCommit',
  'protocol',
]);
const PROMPT_KEYS = new Set(['sessionId', 'contentBlocks', 'route', 'selection']);
const SELECTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens']);
const CANCEL_KEYS = new Set(['sessionId']);
const MODEL_TOOL_ATTESTATION_KEYS = new Set(['provider', 'model', 'nonce']);
const TEXT_BLOCK_KEYS = new Set(['type', 'text']);
const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'token',
  'password',
  'secret',
  'credential',
  'credentials',
  'cookie',
  'setcookie',
]);

const SAFE_EVENT_TYPES = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'assistant/message',
  'tool/call',
  'tool/result',
  'todo/write',
  'request/context',
  'session/end-seed',
]);
const NOVEL_MCP_TOOL_IDENTITIES = [
  {
    canonical: 'novel.read_context',
    publicNamePrefix: 'mcp__novel__novel_read_context_',
  },
  {
    canonical: 'chapter.read_outline',
    publicNamePrefix: 'mcp__novel__chapter_read_outline_',
  },
  { canonical: 'search_memory', publicName: 'mcp__novel__search_memory' },
  { canonical: 'get_character_states', publicName: 'mcp__novel__get_character_states' },
  { canonical: 'generate_chapter', publicName: 'mcp__novel__generate_chapter' },
];
const AGENT_SPINE_SERVICES = [
  'agents',
  'agentLoop',
  'sessions',
  'llm',
  'tools',
  'systemPrompt',
  'sessionTitle',
  'jobs',
  'invariants',
];

export const name = 'ans-task-jsonrpc-server';
export const inject = ['agents', 'sessionPersistence'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedKey(key) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function assertNoSensitiveKeys(value, label) {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSensitiveKeys(entry, label);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(normalizedKey(key))) {
      throw new TypeError(`${label} must not contain credential fields`);
    }
    assertNoSensitiveKeys(entry, label);
  }
}

function assertObject(value, allowedKeys, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  assertNoSensitiveKeys(value, label);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`${label} contains an unsupported field`);
  }
  return value;
}

function requiredString(value, label, maxLength, { allowControls = false } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new TypeError(`${label} is too long`);
  if (
    !allowControls &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new TypeError(`${label} contains control characters`);
  }
  if (allowControls && value.includes('\u0000'))
    throw new TypeError(`${label} contains a NUL character`);
  return value;
}

function optionalPositiveInteger(value, label) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function parseSessionId(value) {
  const id = requiredString(value, 'sessionId', MAX_ID_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) {
    throw new TypeError('sessionId contains unsupported characters');
  }
  return id;
}

function parseSelection(value, label) {
  const input = assertObject(value, SELECTION_KEYS, label);
  const provider = requiredString(input.provider, `${label}.provider`, MAX_ROUTE_LENGTH);
  const model = requiredString(input.model, `${label}.model`, MAX_ROUTE_LENGTH);
  const reasoningEffort =
    input.reasoningEffort === undefined || input.reasoningEffort === null
      ? undefined
      : requiredString(input.reasoningEffort, `${label}.reasoningEffort`, MAX_ROUTE_LENGTH);
  const maxTokens = optionalPositiveInteger(input.maxTokens, `${label}.maxTokens`);
  return {
    selection: Object.freeze({
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    }),
    maxTokens,
  };
}

function parseInitialize(params) {
  const input = assertObject(params, INITIALIZE_KEYS, 'initialize params');
  const cwdInput = requiredString(input.cwd, 'initialize.cwd', MAX_PATH_LENGTH);
  if (!isAbsolute(cwdInput)) throw new TypeError('initialize.cwd must be an absolute path');
  if (
    input.sourceCommit !== undefined &&
    requiredString(input.sourceCommit, 'initialize.sourceCommit', 128) !== SOURCE_COMMIT
  ) {
    throw new TypeError('initialize.sourceCommit does not match the loaded carrier');
  }
  if (
    input.protocol !== undefined &&
    requiredString(input.protocol, 'initialize.protocol', 128) !== PROTOCOL
  ) {
    throw new TypeError('initialize.protocol is not supported by this bridge');
  }
  const route = parseSelection(
    {
      provider: input.provider,
      model: input.model,
      ...(input.reasoningEffort === undefined || input.reasoningEffort === null
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    },
    'initialize params',
  );
  return { cwd: resolve(cwdInput), ...route };
}

function parseContentBlocks(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONTENT_BLOCKS) {
    throw new TypeError(
      `contentBlocks must contain between 1 and ${MAX_CONTENT_BLOCKS} text blocks`,
    );
  }
  let totalChars = 0;
  const blocks = value.map((value, index) => {
    const block = assertObject(value, TEXT_BLOCK_KEYS, `contentBlocks[${index}]`);
    if (block.type !== 'text') throw new TypeError(`contentBlocks[${index}].type must be "text"`);
    const text = requiredString(block.text, `contentBlocks[${index}].text`, MAX_PROMPT_CHARS, {
      allowControls: true,
    });
    totalChars += text.length;
    if (totalChars > MAX_PROMPT_CHARS) throw new TypeError('contentBlocks are too large');
    return Object.freeze({ type: 'text', text });
  });
  return Object.freeze(blocks);
}

function parsePrompt(params) {
  const input = assertObject(params, PROMPT_KEYS, 'session/prompt params');
  if (input.route !== undefined && input.selection !== undefined) {
    throw new TypeError('session/prompt accepts either route or selection, not both');
  }
  const routeInput = input.route ?? input.selection;
  return {
    sessionId: parseSessionId(input.sessionId),
    contentBlocks: parseContentBlocks(input.contentBlocks),
    route:
      routeInput === undefined
        ? undefined
        : parseSelection(routeInput, input.route === undefined ? 'selection' : 'route'),
  };
}

function parseCancel(params) {
  const input = assertObject(params, CANCEL_KEYS, 'session/cancel params');
  return { sessionId: parseSessionId(input.sessionId) };
}

function parseModelToolAttestation(params) {
  const input = assertObject(
    params,
    MODEL_TOOL_ATTESTATION_KEYS,
    'runtime/attest-model-tools params',
  );
  const nonce = requiredString(input.nonce, 'runtime/attest-model-tools.nonce', 200);
  if (!/^[A-Za-z0-9_-]+$/u.test(nonce)) {
    throw new TypeError('runtime/attest-model-tools.nonce contains unsupported characters');
  }
  return {
    provider: requiredString(
      input.provider,
      'runtime/attest-model-tools.provider',
      MAX_ROUTE_LENGTH,
    ),
    model: requiredString(input.model, 'runtime/attest-model-tools.model', MAX_ROUTE_LENGTH),
    nonce,
  };
}

function assertEmptyParams(params, label) {
  if (params === undefined || params === null) return;
  assertObject(params, new Set(), label);
}

function redactText(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, 'Bearer [redacted]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token)=)[^&#\s]+/giu, '$1[redacted]');
}

function sanitizeJson(value) {
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (!isRecord(value)) return typeof value === 'string' ? redactText(value) : value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEYS.has(normalizedKey(key)) ? '[redacted]' : sanitizeJson(entry);
  }
  return output;
}

/**
 * Produce the ANS-safe projection of one durable Harness event.
 * Raw chunks can carry private reasoning, request/header carries the rendered
 * system prompt, and user/message can include injected hidden context, so none
 * of those bodies cross the stdio boundary. Unknown plugin events retain only
 * their envelope; ANS can still project a stable generic event without
 * persisting an unreviewed body.
 */
function safeSessionEvent(event) {
  if (!isRecord(event) || typeof event.type !== 'string') return undefined;
  if (
    event.type === 'assistant/chunk' ||
    event.type === 'request/header' ||
    event.type === 'user/message'
  ) {
    return undefined;
  }
  if (!SAFE_EVENT_TYPES.has(event.type)) {
    return {
      type: event.type,
      ...(Number.isSafeInteger(event.seq) ? { seq: event.seq } : {}),
      ...(Number.isFinite(event.time) ? { time: event.time } : {}),
      ...(event.ignorable === true ? { ignorable: true } : {}),
      data: { omittedByAnsBridge: true },
    };
  }
  const safe = sanitizeJson(event);
  if (event.type !== 'assistant/message') return safe;
  const content = safe?.data?.message?.content;
  if (!Array.isArray(content)) return safe;
  safe.data.message.content = content.filter(
    (block) => !isRecord(block) || block.type !== 'reasoning',
  );
  return safe;
}

function safeExternalError(prefix, error) {
  const detail = error instanceof Error ? redactText(error.message) : 'unknown error';
  return new Error(`${prefix}: ${detail.slice(0, 500)}`);
}

class AnsTaskServer {
  constructor(ctx, transport) {
    this.ctx = ctx;
    this.transport = transport;
    this.cwd = process.cwd();
    this.defaultRoute = undefined;
    this.initialized = false;
    this.loaderSettled = false;
    this.shuttingDown = false;
    this.transportHealthy = true;
    this.sessions = new Map();
    this.activations = new Map();
    this.modelToolAttestations = new Map();
    this.shutdownTask = undefined;
    this.disposers = [
      ctx.on('session/event', (session, event) => {
        const projected = safeSessionEvent(event);
        if (projected === undefined) return;
        this.notify('session.event', { sessionId: String(session.id), event: projected });
      }),
      ctx.on('agent/status', ({ agent, status }) => {
        if (status === 'idle') {
          const record = this.sessions.get(String(agent.session.id));
          if (record?.handle.agent === agent) record.inflight = undefined;
        }
        this.notify('session.status', { sessionId: String(agent.session.id), status });
      }),
    ];
  }

  notify(method, params) {
    try {
      this.transport.notify(method, params);
    } catch {
      // A broken observer must not veto a Session append or alter Agent state.
      this.transportHealthy = false;
    }
  }

  async initialize(params) {
    if (this.shuttingDown) throw new Error('runtime is shutting down');
    const parsed = parseInitialize(params);
    try {
      await this.ctx.get('loader')?.await();
      this.loaderSettled = true;
      await this.ctx.sessionPersistence.list();
    } catch (error) {
      throw safeExternalError('runtime initialization failed', error);
    }
    const providers = this.ctx.get('llm')?.listProviders() ?? [];
    if (!providers.some((provider) => provider.id === parsed.selection.provider)) {
      throw new Error('runtime initialization failed: selected provider is not loaded');
    }
    this.cwd = parsed.cwd;
    this.defaultRoute = { selection: parsed.selection, maxTokens: parsed.maxTokens };
    const wasInitialized = this.initialized;
    this.initialized = true;
    return {
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        sourceCommit: SOURCE_COMMIT,
        protocol: PROTOCOL,
      },
      capabilities: {
        persistentSessions: true,
        resume: true,
        perTurnModelSelection: true,
        cancel: true,
      },
      reinitialized: wasInitialized,
    };
  }

  assertReady() {
    if (!this.initialized || !this.loaderSettled || this.defaultRoute === undefined) {
      throw new Error('runtime is not initialized');
    }
    if (this.shuttingDown) throw new Error('runtime is shutting down');
  }

  hasService(service) {
    try {
      return this.ctx.get(service) !== undefined;
    } catch {
      return false;
    }
  }

  /** Read the fixed carrier's public Provider/Model directory without probing a model request. */
  async modelDirectory() {
    let llm;
    try {
      llm = this.ctx.get('llm');
    } catch {
      return { providers: [], models: [], available: false };
    }
    if (llm === undefined) return { providers: [], models: [], available: false };
    let registered;
    try {
      registered = llm.listProviders();
    } catch {
      return { providers: [], models: [], available: false };
    }
    const providers = await Promise.all(
      registered.map(async (provider) => {
        try {
          const models = (await llm.listModels(provider.id)).map((model) =>
            sanitizeJson({
              provider: model.provider,
              id: model.id,
              name: model.name,
              ...(model.description === undefined ? {} : { description: model.description }),
              ...(model.inputModalities === undefined
                ? {}
                : { inputModalities: model.inputModalities }),
            }),
          );
          return { id: provider.id, name: provider.name, status: 'loaded', models };
        } catch {
          return {
            id: provider.id,
            name: provider.name,
            status: 'failed',
            models: [],
            error: 'model catalog unavailable',
          };
        }
      }),
    );
    return {
      providers,
      models: providers.flatMap((provider) => provider.models),
      available: true,
    };
  }

  /** Read only public schema names; definitions, arguments, and tool results never enter health. */
  toolDirectory() {
    let tools;
    try {
      tools = this.ctx.get('tools');
    } catch {
      return {
        toolsProjection: 'session-only',
        globalTools: [],
        sessionTools: [],
        available: false,
      };
    }
    if (tools === undefined) {
      return {
        toolsProjection: 'session-only',
        globalTools: [],
        sessionTools: [],
        available: false,
      };
    }
    try {
      const names = (scope) =>
        [...new Set(tools.schemas(scope).map((schema) => schema.name))].sort();
      const globalTools = names(undefined);
      const sessionTools = [...this.sessions.entries()]
        .filter(([, record]) => this.ctx.agents.get(record.handle.agent.id) === record.handle.agent)
        .map(([sessionId, record]) => ({
          sessionId,
          tools: names(record.handle.agent),
        }))
        .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
      return {
        toolsProjection: 'public-scoped-registry',
        globalTools,
        sessionTools,
        available: true,
      };
    } catch {
      return {
        toolsProjection: 'session-only',
        globalTools: [],
        sessionTools: [],
        available: false,
      };
    }
  }

  compositionDirectory({ persistence, providerDirectory, toolDirectory }) {
    const status = (loaded) => (!this.loaderSettled ? 'unavailable' : loaded ? 'loaded' : 'failed');
    const deepSeekProvider = providerDirectory.providers.find(
      (provider) => provider.id === 'deepseek-official',
    );
    const missingSpineServices = AGENT_SPINE_SERVICES.filter(
      (service) => !this.hasService(service),
    );
    const registeredTools = toolDirectory.globalTools;
    const missingNovelTools = NOVEL_MCP_TOOL_IDENTITIES.filter((identity) =>
      identity.publicName === undefined
        ? !registeredTools.some((tool) => tool.startsWith(identity.publicNamePrefix))
        : !registeredTools.includes(identity.publicName),
    ).map((identity) => identity.canonical);
    return [
      {
        id: 'sdk-jsonrpc-server',
        plugin: name,
        kind: 'runtime',
        status: status(this.initialized && this.transportHealthy),
        checks: ['initialize', 'loader', 'transport'],
      },
      {
        id: 'llm-deepseek',
        plugin: 'llm-deepseek',
        kind: 'model',
        status: status(providerDirectory.available && deepSeekProvider?.status === 'loaded'),
        checks: ['llm.listProviders', 'llm.listModels'],
      },
      {
        id: 'agent-spine',
        plugin: 'agent-spine-demo',
        kind: 'runtime',
        status: status(missingSpineServices.length === 0),
        checks: AGENT_SPINE_SERVICES,
        ...(missingSpineServices.length === 0 ? {} : { missingServices: missingSpineServices }),
      },
      {
        id: 'sessions',
        plugin: 'session-persistence-jsonl',
        kind: 'storage',
        status: status(persistence === 'ready'),
        checks: ['sessionPersistence.list'],
      },
      {
        id: 'token-meter',
        plugin: 'token-meter',
        kind: 'runtime',
        status: status(this.hasService('tokenMeter')),
        checks: ['ctx.tokenMeter'],
      },
      {
        id: 'compaction-basic',
        plugin: 'compaction-basic',
        kind: 'runtime',
        status: status(this.hasService('compaction')),
        checks: ['ctx.compaction'],
      },
      {
        id: 'mcp-novel',
        plugin: 'mcp-client',
        kind: 'tool',
        status: status(toolDirectory.available && missingNovelTools.length === 0),
        checks: ['tools.schemas'],
        ...(missingNovelTools.length === 0 ? {} : { missingTools: missingNovelTools }),
      },
    ];
  }

  activeModelToolAttestations() {
    const active = [];
    const currentTime = Date.now();
    for (const [key, attestation] of this.modelToolAttestations) {
      if (Date.parse(attestation.expiresAt) <= currentTime) {
        this.modelToolAttestations.delete(key);
        continue;
      }
      active.push({
        protocol: attestation.protocol,
        provider: attestation.provider,
        model: attestation.model,
        verified: true,
        cached: attestation.cached,
        verifiedAt: attestation.verifiedAt,
        expiresAt: attestation.expiresAt,
        cacheTtlMs: attestation.cacheTtlMs,
        finishKind: attestation.finishKind,
        observedToolCalls: attestation.observedToolCalls,
      });
    }
    return active;
  }

  async health(params) {
    assertEmptyParams(params, 'runtime/health params');
    let persistence = 'ready';
    try {
      await this.ctx.sessionPersistence.list();
    } catch {
      persistence = 'failed';
    }
    const providerDirectory = await this.modelDirectory();
    const toolDirectory = this.toolDirectory();
    const composition = this.compositionDirectory({
      persistence,
      providerDirectory,
      toolDirectory,
    });
    const ready =
      this.initialized &&
      this.loaderSettled &&
      !this.shuttingDown &&
      persistence === 'ready' &&
      this.transportHealthy &&
      composition.every((entry) => entry.status === 'loaded');
    return {
      ok: ready,
      ready,
      state: this.shuttingDown ? 'shutting_down' : ready ? 'ready' : 'starting',
      initialized: this.initialized,
      loaderSettled: this.loaderSettled,
      persistence,
      transport: this.transportHealthy ? 'ready' : 'failed',
      sourceCommit: SOURCE_COMMIT,
      protocol: PROTOCOL,
      route: this.defaultRoute?.selection,
      liveSessions: this.sessions.size,
      activatingSessions: this.activations.size,
      providers: providerDirectory.providers,
      models: providerDirectory.models,
      composition,
      toolsProjection: toolDirectory.toolsProjection,
      tools: {
        global: toolDirectory.globalTools,
        sessions: toolDirectory.sessionTools,
      },
      modelToolAttestations: this.activeModelToolAttestations(),
    };
  }

  /**
   * Prove that the exact provider/model route can emit a native tool-call block.
   * This is a direct one-shot LLM request: it creates no Agent/Session, executes
   * no tool body, and writes no Harness persistence or ANS domain fact.
   */
  async attestModelTools(params) {
    this.assertReady();
    const parsed = parseModelToolAttestation(params);
    const cacheKey = `${parsed.provider}\u0000${parsed.model}`;
    const cached = this.modelToolAttestations.get(cacheKey);
    if (cached !== undefined && Date.parse(cached.expiresAt) > Date.now()) {
      return { ...cached, cached: true };
    }
    if (cached !== undefined) this.modelToolAttestations.delete(cacheKey);

    const llm = this.ctx.get('llm');
    if (llm === undefined || !llm.listProviders().some((entry) => entry.id === parsed.provider)) {
      return {
        protocol: MODEL_TOOL_ATTESTATION_PROTOCOL,
        provider: parsed.provider,
        model: parsed.model,
        verified: false,
        cached: false,
        failureCode: 'PROVIDER_NOT_LOADED',
      };
    }

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(new Error('model tool attestation timed out')),
      MODEL_TOOL_ATTESTATION_TIMEOUT_MS,
    );
    const toolCalls = [];
    let finishKind = 'missing';
    let usage;
    let failureCode;
    let providerFailureCode;
    try {
      const message = createUserMessage({
        content: [
          {
            type: 'text',
            text: `Call ${MODEL_TOOL_ATTESTATION_NAME} exactly once with nonce ${parsed.nonce}. Do not answer with text.`,
          },
        ],
        source: { kind: 'user' },
      });
      for await (const chunk of llm.stream({
        provider: parsed.provider,
        model: parsed.model,
        reasoningEffort: 'off',
        messages: [message],
        system:
          'This is a capability attestation. Call the single provided function exactly once, copy its nonce exactly, and emit no prose.',
        tools: [
          {
            name: MODEL_TOOL_ATTESTATION_NAME,
            description:
              'Side-effect-free capability marker. Its body is never executed by this attestation.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              required: ['nonce'],
              properties: {
                nonce: { type: 'string', enum: [parsed.nonce] },
              },
            },
          },
        ],
        temperature: 0,
        maxTokens: MODEL_TOOL_ATTESTATION_MAX_TOKENS,
        signal: controller.signal,
      })) {
        if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') {
          toolCalls.push({ name: chunk.block.name, arguments: chunk.block.arguments });
        } else if (chunk.type === 'usage') {
          usage = sanitizeJson(chunk.usage);
        } else if (chunk.type === 'finish') {
          finishKind = chunk.reason?.kind ?? 'unknown';
          if (finishKind === 'error') {
            failureCode = 'PROVIDER_ERROR';
            const candidate = chunk.reason?.failure?.code;
            if (typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/u.test(candidate)) {
              providerFailureCode = candidate;
            }
          }
          if (finishKind === 'aborted') failureCode = 'PROBE_ABORTED';
        }
      }
    } catch {
      failureCode = controller.signal.aborted ? 'PROBE_TIMEOUT' : 'PROBE_INTERNAL_ERROR';
    } finally {
      globalThis.clearTimeout(timeout);
    }

    let exactCall = false;
    if (toolCalls.length === 1 && toolCalls[0].name === MODEL_TOOL_ATTESTATION_NAME) {
      try {
        const args = JSON.parse(toolCalls[0].arguments);
        exactCall = isRecord(args) && Object.keys(args).length === 1 && args.nonce === parsed.nonce;
      } catch {
        exactCall = false;
      }
    }
    const verified = finishKind === 'tool-calls' && exactCall;
    const verifiedAt = verified ? new Date() : undefined;
    const result = {
      protocol: MODEL_TOOL_ATTESTATION_PROTOCOL,
      provider: parsed.provider,
      model: parsed.model,
      verified,
      cached: false,
      finishKind,
      observedToolCalls: toolCalls.length,
      ...(usage === undefined ? {} : { usage }),
      ...(providerFailureCode === undefined ? {} : { providerFailureCode }),
      ...(verified
        ? {
            verifiedAt: verifiedAt.toISOString(),
            expiresAt: new Date(verifiedAt.getTime() + MODEL_TOOL_ATTESTATION_TTL_MS).toISOString(),
            cacheTtlMs: MODEL_TOOL_ATTESTATION_TTL_MS,
          }
        : {
            failureCode:
              failureCode ?? (toolCalls.length === 0 ? 'NO_TOOL_CALL' : 'INVALID_TOOL_CALL'),
          }),
    };
    if (verified) this.modelToolAttestations.set(cacheKey, result);
    return result;
  }

  async getOrActivateSession(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (
      existing !== undefined &&
      this.ctx.agents.get(existing.handle.agent.id) === existing.handle.agent
    ) {
      return existing;
    }
    if (existing !== undefined) {
      this.sessions.delete(sessionId);
      await Promise.resolve(existing.handle.dispose()).catch(() => {});
    }
    const pending = this.activations.get(sessionId);
    if (pending !== undefined) return pending.promise;

    const controller = new AbortController();
    const promise = this.activateSession(sessionId, controller.signal);
    this.activations.set(sessionId, { controller, promise });
    void promise
      .finally(() => {
        if (this.activations.get(sessionId)?.promise === promise)
          this.activations.delete(sessionId);
      })
      .catch(() => {});
    return promise;
  }

  async activateSession(sessionId, signal) {
    const defaultRoute = this.defaultRoute;
    if (defaultRoute === undefined) throw new Error('runtime is not initialized');
    let headers;
    try {
      headers = await this.ctx.sessionPersistence.list(signal);
    } catch (error) {
      throw safeExternalError('session persistence lookup failed', error);
    }
    if (signal.aborted || this.shuttingDown) throw new Error('session activation cancelled');

    const selection = { current: defaultRoute.selection, assembled: undefined };
    const maxTokens = { current: defaultRoute.maxTokens };
    const setup = (agentCtx) => {
      installModelSelection(agentCtx, selection);
      agentCtx.on('agent/request', async (_payload, next) => {
        const resolved = await next();
        const { maxTokens: _inheritedMaxTokens, ...withoutInheritedMaxTokens } = resolved;
        return maxTokens.current === undefined
          ? withoutInheritedMaxTokens
          : { ...withoutInheritedMaxTokens, maxTokens: maxTokens.current };
      });
    };
    const id = SessionId(sessionId);
    const agentOptions = {
      provider: defaultRoute.selection.provider,
      model: defaultRoute.selection.model,
      ...(defaultRoute.maxTokens === undefined ? {} : { maxTokens: defaultRoute.maxTokens }),
    };
    const persisted = headers.some((header) => String(header.id) === sessionId);
    let handle;
    try {
      handle = persisted
        ? await this.ctx.agents.resume({
            resumeSessionId: id,
            agentOptions,
            setup,
            signal,
          })
        : await this.ctx.agents.create({
            sessionId: id,
            meta: { cwd: this.cwd },
            agentOptions,
            setup,
            signal,
          });
    } catch (error) {
      throw safeExternalError('session activation failed', error);
    }
    if (signal.aborted || this.shuttingDown) {
      await Promise.resolve(handle.dispose()).catch(() => {});
      throw new Error('session activation cancelled');
    }
    const record = {
      handle,
      selection,
      maxTokens,
      inflight: undefined,
      nextLifecycle: persisted ? 'resumed' : 'created',
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  async prompt(params) {
    this.assertReady();
    const parsed = parsePrompt(params);
    const record = await this.getOrActivateSession(parsed.sessionId);
    if (record.inflight !== undefined)
      throw new Error('a prompt is already in flight for this session');
    if (this.ctx.agents.get(record.handle.agent.id) !== record.handle.agent) {
      throw new Error('session agent is no longer live');
    }

    const route = parsed.route ?? this.defaultRoute;
    const previousSelection = record.selection.current;
    const previousMaxTokens = record.maxTokens.current;
    record.selection.current = route.selection;
    record.maxTokens.current = route.maxTokens;
    const message = createUserMessage({
      content: parsed.contentBlocks,
      source: { kind: 'user' },
    });
    const inflight = { messageId: message.id };
    record.inflight = inflight;
    const lifecycle = record.nextLifecycle;
    try {
      record.handle.agent.followup(message);
    } catch (error) {
      record.inflight = undefined;
      record.selection.current = previousSelection;
      record.maxTokens.current = previousMaxTokens;
      throw safeExternalError('prompt was not queued', error);
    }
    record.nextLifecycle = 'continued';
    void record.handle.agent.whenIdle().then(
      () => {
        if (record.inflight === inflight) record.inflight = undefined;
      },
      () => {
        if (record.inflight === inflight) record.inflight = undefined;
      },
    );
    return {
      messageId: message.id,
      sessionId: parsed.sessionId,
      agentId: parsed.sessionId,
      lifecycle,
    };
  }

  async cancel(params) {
    this.assertReady();
    const { sessionId } = parseCancel(params);
    let cancelled = false;
    const activation = this.activations.get(sessionId);
    if (activation !== undefined) {
      activation.controller.abort(new Error('session activation cancelled by user'));
      cancelled = true;
    }
    const record = this.sessions.get(sessionId);
    if (
      record !== undefined &&
      this.ctx.agents.get(record.handle.agent.id) === record.handle.agent
    ) {
      record.handle.agent.cancel({ kind: 'user' });
      cancelled = true;
    }
    return { cancelled };
  }

  shutdown(params) {
    assertEmptyParams(params, 'shutdown params');
    this.shutdownTask ??= this.performShutdown();
    return this.shutdownTask;
  }

  async performShutdown() {
    this.shuttingDown = true;
    for (const activation of this.activations.values()) {
      activation.controller.abort(new Error('runtime shutdown'));
    }
    await Promise.allSettled([...this.activations.values()].map((entry) => entry.promise));
    this.activations.clear();

    const records = [...this.sessions.values()];
    this.sessions.clear();
    for (const record of records) record.handle.agent.cancel({ kind: 'disposed' });
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.();
      } catch {
        // Continue releasing the remaining public capabilities.
      }
    }
    await Promise.allSettled(records.map((record) => Promise.resolve(record.handle.dispose())));
    return {};
  }

  async handleRequest(method, params) {
    switch (method) {
      case 'initialize':
        return this.initialize(params);
      case 'session/prompt':
        return this.prompt(params);
      case 'session/cancel':
        return this.cancel(params);
      case 'runtime/health':
        return this.health(params);
      case 'runtime/attest-model-tools':
        return this.attestModelTools(params);
      case 'shutdown':
        return this.shutdown(params);
      default:
        throw new Error('unknown ANS task runtime method');
    }
  }
}

/**
 * Mount the persistent bridge. The shutdown response is written first, then a
 * transport flush is awaited before the Cordis root and process are released.
 */
export function apply(ctx, config = {}) {
  const input = config.input ?? process.stdin;
  const output = config.output ?? process.stdout;
  const exit =
    config.exit ??
    ((code) => {
      process.exit(code);
    });
  const rootFiber = ctx.root.fiber;
  const transport = new JsonRpcLineTransport(input, output);
  const server = new AnsTaskServer(ctx, transport);
  let exitTask;

  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())]);
      transport.close();
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())]);
      exit(0);
    })();
    return exitTask;
  };

  transport.onRequest(async (method, params) => {
    const result = await server.handleRequest(method, params);
    if (method === 'shutdown')
      setImmediate(() => {
        void disposeAndExit();
      });
    return result;
  });

  ctx.effect(() => {
    transport.start();
    return async () => {
      await server.shutdown({});
      transport.close();
    };
  }, 'ansTaskJsonRpc.serve');
}
