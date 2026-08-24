// AI Novel Studio v3.1.0 — local OpenAI-compatible model gateway proxy (design doc 4.3 option A).
// DSH runtime -> this proxy -> upstream DeepSeek API. Streaming passthrough plus
// request/usage accounting — the hook point for the ANS budget ledger (v3.2).
//
// Env:
//   PROXY_PORT            listen port (default 8787; the Rust command passes a free one)
//   PROXY_UPSTREAM        upstream origin (default https://api.deepseek.com)
//   PROXY_UPSTREAM_KEY    upstream credential (the ONLY place the key lives)
//
// Security: the downstream (DSH) credential is ignored; the proxy holds the
// upstream key exclusively. Nothing is written to disk.
import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const UPSTREAM = process.env.PROXY_UPSTREAM ?? 'https://api.deepseek.com';
const UPSTREAM_KEY = process.env.PROXY_UPSTREAM_KEY ?? process.env.DEEPSEEK_API_KEY;
const POLICY_URL = process.env.PROXY_POLICY_URL;
const REQUEST_PREFIX = process.env.PROXY_REQUEST_PREFIX ?? 'dsh';
// The catalog is only a test/probe projection. It never changes the model
// request and it deliberately exposes no credentials or upstream details.
const PROXY_MODEL = process.env.PROXY_MODEL ?? 'deepseek-v4-flash';
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
    res.writeHead(Number(error.status) || 429, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: { message: error.message, code: 'AI_REQUEST_POLICY_REJECTED' } }),
    );
    return;
  }
  console.log(
    '[model-proxy] request model=' +
      model +
      ' stream=' +
      (parsed.stream ?? false) +
      ' promptChars=' +
      body.length,
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
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
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
