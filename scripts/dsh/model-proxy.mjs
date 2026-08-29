// AI Novel Studio v3.1.0 — local OpenAI-compatible model gateway proxy (design doc 4.3 option A).
// DSH runtime -> this proxy -> an OpenAI-compatible upstream. Streaming passthrough plus
// request/usage accounting — the hook point for the ANS budget ledger (v3.2).
//
// Env:
//   PROXY_PORT            listen port (default 8787; the Rust command passes a free one)
//   PROXY_UPSTREAM        upstream origin (default https://api.deepseek.com)
//   PROXY_UPSTREAM_KEY    upstream credential (the ONLY place the key lives)
//
// Security: the downstream (DSH) credential is ignored; the proxy holds the
// upstream key exclusively. Normal runtime writes nothing to disk. Explicit
// real-E2E runs may persist hash-only request evidence with no message content.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const UPSTREAM = process.env.PROXY_UPSTREAM ?? 'https://api.deepseek.com';
const UPSTREAM_KEY = process.env.PROXY_UPSTREAM_KEY ?? process.env.DEEPSEEK_API_KEY;
const POLICY_URL = process.env.PROXY_POLICY_URL;
const REQUEST_PREFIX = process.env.PROXY_REQUEST_PREFIX ?? 'dsh';
const REAL_E2E_PROVIDER_EVIDENCE_ENV = {
  enabled: 'AI_NOVEL_STUDIO_REAL_E2E',
  directory: 'AI_NOVEL_STUDIO_REAL_E2E_PROVIDER_EVIDENCE_DIR',
  fixtureCanaries: 'AI_NOVEL_STUDIO_REAL_E2E_PREPARED_FIXTURE_CANARIES_JSON',
};
const CREATIVE_BRIEF_MARKER = '[[ANS_CREATIVE_BRIEF:v1]]';
const AUTOMATIC_ASSET_TURN_MARKER = '[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]';
const PROVIDER_EVIDENCE_SCHEMA_VERSION = 'real_conversation_provider_request_evidence_v1';
const PROVIDER_EVIDENCE_HASH_ALGORITHM = 'sha256';
const PROVIDER_EVIDENCE_MESSAGE_SERIALIZATION = 'json_stringify_messages_v1';
const AUTOMATIC_ASSET_INSTRUCTIONS = [
  ['生成世界与规则设定候选', 'world_setting'],
  ['生成世界设定候选', 'world_setting'],
  ['生成规则设定候选', 'rule_system'],
  ['生成主角候选', 'protagonist'],
  ['生成全书规划候选', 'story_plan'],
  ['生成本章大纲候选', 'chapter_outline'],
];

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function providerEvidenceConfiguration(environment) {
  if (environment[REAL_E2E_PROVIDER_EVIDENCE_ENV.enabled] !== '1') return undefined;
  const directory = String(environment[REAL_E2E_PROVIDER_EVIDENCE_ENV.directory] ?? '').trim();
  const serializedCanaries = String(
    environment[REAL_E2E_PROVIDER_EVIDENCE_ENV.fixtureCanaries] ?? '',
  ).trim();
  if (!directory || !serializedCanaries) {
    throw new Error('real-E2E Provider evidence configuration is incomplete');
  }

  let parsedCanaries;
  try {
    parsedCanaries = JSON.parse(serializedCanaries);
  } catch {
    throw new Error('real-E2E prepared-fixture canaries are not valid JSON');
  }
  if (!Array.isArray(parsedCanaries) || parsedCanaries.length === 0 || parsedCanaries.length > 32) {
    throw new Error('real-E2E prepared-fixture canaries must be a non-empty bounded array');
  }
  const canaries = parsedCanaries.map((candidate) => {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    const value = typeof candidate?.value === 'string' ? candidate.value : '';
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(id) || !value.trim() || value.length > 8_192) {
      throw new Error('real-E2E prepared-fixture canary has an invalid shape');
    }
    return { id, value };
  });
  if (new Set(canaries.map((canary) => canary.id)).size !== canaries.length) {
    throw new Error('real-E2E prepared-fixture canary identifiers must be unique');
  }

  const resolvedDirectory = path.resolve(directory);
  let directoryStatus;
  try {
    directoryStatus = fs.statSync(resolvedDirectory);
  } catch {
    throw new Error('real-E2E Provider evidence directory is unavailable');
  }
  if (!directoryStatus.isDirectory()) {
    throw new Error('real-E2E Provider evidence path is not a directory');
  }
  return { directory: resolvedDirectory, canaries };
}

const REAL_E2E_PROVIDER_EVIDENCE = (() => {
  try {
    return providerEvidenceConfiguration(process.env);
  } catch (error) {
    console.error(`[model-proxy] ${error.message}`);
    process.exit(2);
  }
})();
// The catalog is only a test/probe projection. It never changes the model
// request and it deliberately exposes no credentials or upstream details.
function proxyModelFromEnvironment(value) {
  const model = String(value ?? 'deepseek-v4-flash').trim();
  if (!model || model.length > 256 || /[\u0000-\u001f\u007f]/u.test(model)) {
    throw new Error('PROXY_MODEL must be a non-empty model identity');
  }
  return model;
}

const PROXY_MODEL = (() => {
  try {
    return proxyModelFromEnvironment(process.env.PROXY_MODEL);
  } catch (error) {
    console.error(`[model-proxy] ${error.message}`);
    process.exit(2);
  }
})();
const configuredTimeoutMs = Number(process.env.PROXY_REQUEST_TIMEOUT_MS ?? 120_000);
const REQUEST_TIMEOUT_MS =
  Number.isSafeInteger(configuredTimeoutMs) && configuredTimeoutMs >= 1_000
    ? Math.min(configuredTimeoutMs, 30 * 60_000)
    : 120_000;
let requestSequence = 0;
if (!UPSTREAM_KEY) {
  console.error('[model-proxy] set PROXY_UPSTREAM_KEY (or DEEPSEEK_API_KEY) for the proxy process');
  process.exit(2);
}

async function policyCall(path, payload) {
  if (!POLICY_URL) return undefined;
  const response = await fetch(POLICY_URL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? 'AI request policy rejected the DSH request');
    error.status = response.status;
    throw error;
  }
  return body;
}

function safePolicyErrorCode(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const governedCode = /^([A-Z][A-Z0-9_]{2,63}):/u.exec(message)?.[1];
  if (governedCode) return governedCode;
  const transportCode = error?.cause?.code;
  if (typeof transportCode === 'string' && /^[A-Z0-9_]{2,32}$/u.test(transportCode)) {
    return `AI_REQUEST_POLICY_${transportCode}`;
  }
  return Number(error?.status) > 0 ? 'AI_REQUEST_POLICY_REJECTED' : 'AI_REQUEST_POLICY_UNAVAILABLE';
}

function parseUsage(raw) {
  const candidates = [];
  for (const line of raw.split(/\r?\n/)) {
    const value = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!value || value === '[DONE]' || !value.startsWith('{')) continue;
    try {
      candidates.push(JSON.parse(value));
    } catch {
      // Streaming chunks can split lines; the complete JSON fallback below handles non-SSE bodies.
    }
  }
  if (raw.trim().startsWith('{')) {
    try {
      candidates.push(JSON.parse(raw));
    } catch {
      // The response was an SSE stream, not one JSON document.
    }
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const usage = candidates[index]?.usage;
    const tokenInput = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    const tokenOutput = Number(usage?.completion_tokens ?? usage?.output_tokens);
    if (
      Number.isSafeInteger(tokenInput) &&
      tokenInput >= 0 &&
      Number.isSafeInteger(tokenOutput) &&
      tokenOutput >= 0
    ) {
      return { tokenInput, tokenOutput };
    }
  }
  return {};
}

function inspectSseTermination(raw) {
  let sawDone = false;
  let sawFinishReason = false;
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      sawDone = true;
      continue;
    }
    if (!payload.startsWith('{')) continue;
    try {
      const chunk = JSON.parse(payload);
      if (
        Array.isArray(chunk?.choices) &&
        chunk.choices.some(
          (choice) => typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0,
        )
      ) {
        sawFinishReason = true;
      }
    } catch {
      // A partial or malformed terminal event must remain fail-closed downstream.
    }
  }
  return { sawDone, sawFinishReason };
}

function toolNameFromDefinition(tool) {
  const candidate = tool?.function?.name ?? tool?.name;
  return typeof candidate === 'string' ? candidate : '';
}

function inspectRequestShape(parsed) {
  const tools = Array.isArray(parsed?.tools) ? parsed.tools : [];
  const names = tools.map(toolNameFromDefinition);
  return {
    messageCount: Array.isArray(parsed?.messages) ? parsed.messages.length : 0,
    toolCount: tools.length,
    invalidToolNameCount: names.filter((name) => !/^[A-Za-z0-9_-]{1,128}$/u.test(name)).length,
    thinkingType: typeof parsed?.thinking?.type === 'string' ? parsed.thinking.type : 'unspecified',
    reasoningEffort:
      typeof parsed?.reasoning_effort === 'string' ? parsed.reasoning_effort : 'unspecified',
  };
}

function collectStringLeaves(value, target) {
  if (typeof value === 'string') {
    target.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, target);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringLeaves(item, target);
  }
}

function countOccurrences(value, marker) {
  let count = 0;
  let offset = 0;
  for (;;) {
    const index = value.indexOf(marker, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + marker.length;
  }
}

function latestUserMessageText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const content = [];
    collectStringLeaves(message.content, content);
    return content.join('\n');
  }
  return '';
}

function automaticAssetKind(latestUserMessage) {
  return (
    AUTOMATIC_ASSET_INSTRUCTIONS.find(([instruction]) =>
      latestUserMessage.includes(`用户意图：${instruction}`),
    )?.[1] ?? null
  );
}

function parseCreativeBrief(latestUserMessage) {
  const markerIndex = latestUserMessage.lastIndexOf(CREATIVE_BRIEF_MARKER);
  if (markerIndex < 0) return { status: 'absent', value: null };
  const serialized = latestUserMessage
    .slice(markerIndex + CREATIVE_BRIEF_MARKER.length)
    .replace(/^\s*/u, '')
    .split(/\r?\n/u, 1)[0];
  try {
    const parsed = JSON.parse(serialized);
    if (
      parsed?.schema !== 'ans_core_asset_creative_brief_v1' ||
      parsed?.source !== 'original_user_goal' ||
      typeof parsed?.content !== 'string' ||
      !parsed.content.trim()
    ) {
      return { status: 'invalid', value: null };
    }
    return {
      status: 'valid',
      value: {
        schema: parsed.schema,
        source: parsed.source,
        contentSha256: sha256(parsed.content),
        contentLength: parsed.content.length,
      },
    };
  } catch {
    return { status: 'invalid', value: null };
  }
}

function writeRealE2eProviderEvidence(providerRequestId, body, parsed) {
  if (!REAL_E2E_PROVIDER_EVIDENCE) return;
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const messageStrings = [];
  collectStringLeaves(messages, messageStrings);
  const latestUserMessage = latestUserMessageText(messages);
  const assetKind = automaticAssetKind(latestUserMessage);
  const creativeBrief = parseCreativeBrief(latestUserMessage);
  const turnOrigin = latestUserMessage.includes(AUTOMATIC_ASSET_TURN_MARKER)
    ? 'workbench_asset_preparation'
    : null;
  const configuredCanaryIds = REAL_E2E_PROVIDER_EVIDENCE.canaries.map((canary) => canary.id);
  const matchedCanaryIds = REAL_E2E_PROVIDER_EVIDENCE.canaries
    .filter((canary) => messageStrings.some((value) => value.includes(canary.value)))
    .map((canary) => canary.id);
  const providerRequestIdSha256 = sha256(providerRequestId);
  const evidence = {
    schemaVersion: PROVIDER_EVIDENCE_SCHEMA_VERSION,
    captureMode: 'hash_only',
    hashAlgorithm: PROVIDER_EVIDENCE_HASH_ALGORITHM,
    messagesSerialization: PROVIDER_EVIDENCE_MESSAGE_SERIALIZATION,
    providerRequestIdSha256,
    requestBodySha256: sha256(body),
    messagesSha256: sha256(JSON.stringify(messages)),
    messageCount: messages.length,
    messageTextSha256: sha256(JSON.stringify(messageStrings)),
    messageTextCount: messageStrings.length,
    latestUserMessageSha256: sha256(latestUserMessage),
    latestUserMessageLength: latestUserMessage.length,
    classification:
      assetKind && creativeBrief.status === 'valid' && turnOrigin
        ? 'automatic_asset_preparation'
        : 'other',
    turnOrigin,
    assetKind,
    creativeBriefParseStatus: creativeBrief.status,
    creativeBrief: creativeBrief.value,
    creativeBriefMarkerCount: messageStrings.reduce(
      (sum, value) => sum + countOccurrences(value, CREATIVE_BRIEF_MARKER),
      0,
    ),
    latestUserCreativeBriefMarkerCount: countOccurrences(latestUserMessage, CREATIVE_BRIEF_MARKER),
    configuredPreparedFixtureCanaryIds: configuredCanaryIds,
    matchedPreparedFixtureCanaryIds: matchedCanaryIds,
    rawMessageContentPersisted: false,
  };
  fs.writeFileSync(
    path.join(REAL_E2E_PROVIDER_EVIDENCE.directory, `${providerRequestIdSha256}.json`),
    JSON.stringify(evidence, null, 2),
    { encoding: 'utf8', flag: 'wx' },
  );
}

function inspectResponseShape(raw) {
  const payloads = [];
  let sawDone = false;
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5).trim();
    if (value === '[DONE]') {
      sawDone = true;
      continue;
    }
    if (!value.startsWith('{')) continue;
    try {
      payloads.push(JSON.parse(value));
    } catch {
      // A malformed or partial payload is counted below through the missing terminal evidence.
    }
  }
  if (payloads.length === 0 && raw.trim().startsWith('{')) {
    try {
      payloads.push(JSON.parse(raw));
    } catch {
      // Keep the shape empty; never log the response body.
    }
  }

  let choiceCount = 0;
  let contentChars = 0;
  let reasoningChars = 0;
  let alternateReasoningChars = 0;
  let toolCallParts = 0;
  let legacyFunctionCallParts = 0;
  const toolNames = new Set();
  const finishReasons = new Set();
  const messageKeys = new Set();
  for (const payload of payloads) {
    if (!Array.isArray(payload?.choices)) continue;
    choiceCount += payload.choices.length;
    for (const choice of payload.choices) {
      const message = choice?.delta ?? choice?.message ?? {};
      if (message !== null && typeof message === 'object') {
        for (const key of Object.keys(message)) messageKeys.add(key);
      }
      if (typeof message?.content === 'string') contentChars += message.content.length;
      if (typeof message?.reasoning_content === 'string') {
        reasoningChars += message.reasoning_content.length;
      }
      for (const candidate of [message?.reasoning, message?.analysis, message?.thinking]) {
        if (typeof candidate === 'string') alternateReasoningChars += candidate.length;
      }
      const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      toolCallParts += calls.length;
      for (const call of calls) {
        const name = call?.function?.name;
        if (typeof name === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(name)) {
          toolNames.add(name);
        }
      }
      if (message?.function_call !== undefined && message?.function_call !== null) {
        legacyFunctionCallParts += 1;
      }
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReasons.add(choice.finish_reason);
      }
    }
  }
  return {
    payloadCount: payloads.length,
    choiceCount,
    contentChars,
    reasoningChars,
    alternateReasoningChars,
    toolCallParts,
    legacyFunctionCallParts,
    toolNames: [...toolNames].slice(0, 24),
    finishReasons: [...finishReasons].slice(0, 8),
    messageKeys: [...messageKeys].filter((key) => /^[A-Za-z0-9_-]{1,64}$/u.test(key)).slice(0, 16),
    sawDone,
  };
}

function missingDoneSuffix(raw) {
  if (raw.endsWith('\r\n\r\n') || raw.endsWith('\n\n')) return 'data: [DONE]\n\n';
  if (raw.endsWith('\n')) return '\ndata: [DONE]\n\n';
  return '\n\ndata: [DONE]\n\n';
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = requestUrl.pathname;
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: PROXY_MODEL, object: 'model' }] }));
    return;
  }
  if (
    req.method !== 'POST' ||
    (pathname !== '/chat/completions' &&
      pathname !== '/v1/chat/completions' &&
      pathname !== '/responses' &&
      pathname !== '/v1/responses')
  ) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  let parsed = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* passthrough anyway */
  }
  const model = parsed.model ?? '?';
  const requestShape = inspectRequestShape(parsed);
  const providerRequestId = REQUEST_PREFIX + ':' + ++requestSequence;
  const started = Date.now();
  let policyTicket;
  try {
    const reservation = await policyCall('/reserve', {
      providerRequestId,
      estimatedInputTokens: Math.max(1, Math.ceil(body.length / 4)),
      estimatedOutputTokens: Number(parsed.max_tokens ?? parsed.max_completion_tokens ?? 8192),
    });
    policyTicket = reservation?.ticket;
  } catch (error) {
    const policyErrorCode = safePolicyErrorCode(error);
    console.error(`[model-proxy] policyReject code=${policyErrorCode}`);
    res.writeHead(Number(error.status) || 429, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'AI request policy rejected the DSH request',
          code: policyErrorCode,
        },
      }),
    );
    return;
  }
  console.log(
    '[model-proxy] request model=' +
      model +
      ' stream=' +
      (parsed.stream ?? false) +
      ' promptChars=' +
      body.length +
      ' messages=' +
      requestShape.messageCount +
      ' tools=' +
      requestShape.toolCount +
      ' invalidToolNames=' +
      requestShape.invalidToolNameCount +
      ' thinking=' +
      requestShape.thinkingType +
      ' effort=' +
      requestShape.reasoningEffort,
  );
  const upstreamAbort = new AbortController();
  let abortKind;
  const requestTimeout = setTimeout(() => {
    abortKind = 'timeout';
    upstreamAbort.abort();
  }, REQUEST_TIMEOUT_MS);
  requestTimeout.unref();
  res.once('close', () => {
    if (!res.writableEnded && !upstreamAbort.signal.aborted) {
      abortKind = 'cancelled';
      upstreamAbort.abort();
    }
  });
  try {
    const upstreamBase = new URL(UPSTREAM);
    const upstreamPath = pathname.replace(/^\/v1(?=\/)/, '');
    const basePath = upstreamBase.pathname.replace(/\/+$/, '');
    // Callers may provide either an origin or an OpenAI-compatible /v1 base.
    // Avoid producing /v1/v1 when the downstream already includes the prefix.
    const targetPath =
      basePath.endsWith('/v1') && upstreamPath.startsWith('/v1/')
        ? upstreamPath.slice(3)
        : basePath + upstreamPath;
    upstreamBase.pathname = targetPath || '/';
    upstreamBase.search = requestUrl.search;
    const upstream = await fetch(upstreamBase, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + UPSTREAM_KEY,
      },
      body,
      signal: upstreamAbort.signal,
    });
    writeRealE2eProviderEvidence(providerRequestId, body, parsed);
    const upstreamContentType = upstream.headers.get('content-type') ?? 'application/json';
    res.writeHead(upstream.status, { 'content-type': upstreamContentType });
    let responseBody = '';
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (responseBody.length < 8 * 1024 * 1024) responseBody += text;
      res.write(value);
    }
    if (responseBody.length < 8 * 1024 * 1024) responseBody += decoder.decode();
    const termination = inspectSseTermination(responseBody);
    if (
      upstream.ok &&
      parsed.stream === true &&
      upstreamContentType.toLowerCase().includes('text/event-stream') &&
      !termination.sawDone &&
      termination.sawFinishReason
    ) {
      const suffix = missingDoneSuffix(responseBody);
      res.write(suffix);
      responseBody += suffix;
      console.log('[model-proxy] normalized terminal SSE without [DONE]');
    }
    const responseShape = inspectResponseShape(responseBody);
    console.log(
      '[model-proxy] responseStats status=' +
        upstream.status +
        ' payloads=' +
        responseShape.payloadCount +
        ' choices=' +
        responseShape.choiceCount +
        ' contentChars=' +
        responseShape.contentChars +
        ' reasoningChars=' +
        responseShape.reasoningChars +
        ' alternateReasoningChars=' +
        responseShape.alternateReasoningChars +
        ' toolCallParts=' +
        responseShape.toolCallParts +
        ' legacyFunctionCallParts=' +
        responseShape.legacyFunctionCallParts +
        ' toolNames=' +
        (responseShape.toolNames.join(',') || 'none') +
        ' messageKeys=' +
        (responseShape.messageKeys.join(',') || 'none') +
        ' finish=' +
        (responseShape.finishReasons.join(',') || 'none') +
        ' done=' +
        responseShape.sawDone,
    );
    res.end();
    const usage = parseUsage(responseBody);
    await policyCall('/settle', {
      ticket: policyTicket,
      outcome: upstream.ok ? 'succeeded' : 'failed',
      ...(upstream.ok ? usage : {}),
    });
    console.log(
      '[model-proxy] done model=' +
        model +
        ' status=' +
        upstream.status +
        ' ms=' +
        (Date.now() - started) +
        ' usage=' +
        (Object.keys(usage).length > 0 ? JSON.stringify(usage) : 'n/a'),
    );
  } catch (error) {
    if (policyTicket) {
      await policyCall('/settle', { ticket: policyTicket, outcome: 'failed' }).catch(
        () => undefined,
      );
    }
    console.error('[model-proxy] upstream ' + (abortKind ?? 'failed'));
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(abortKind === 'timeout' ? 504 : 502, {
        'content-type': 'application/json',
      });
    }
    if (!res.destroyed) {
      res.end(
        JSON.stringify({
          error: {
            message:
              abortKind === 'timeout'
                ? 'upstream request timed out'
                : abortKind === 'cancelled'
                  ? 'downstream request cancelled'
                  : 'upstream request failed',
            code:
              abortKind === 'timeout'
                ? 'AI_REQUEST_TIMEOUT'
                : abortKind === 'cancelled'
                  ? 'AI_REQUEST_CANCELLED'
                  : 'AI_REQUEST_UPSTREAM_FAILED',
          },
        }),
      );
    }
  } finally {
    clearTimeout(requestTimeout);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const actualPort = server.address()?.port ?? PORT;
  console.log('[model-proxy] listening on 127.0.0.1:' + actualPort + ' upstream=' + UPSTREAM);
});
