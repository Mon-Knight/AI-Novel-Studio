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
if (!UPSTREAM_KEY) {
  console.error('[model-proxy] set PROXY_UPSTREAM_KEY (or DEEPSEEK_API_KEY) for the proxy process');
  process.exit(2);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
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
  const started = Date.now();
  console.log(
    '[model-proxy] request model=' +
      model +
      ' stream=' +
      (parsed.stream ?? false) +
      ' promptChars=' +
      body.length,
  );
  try {
    const upstream = await fetch(UPSTREAM + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + UPSTREAM_KEY,
      },
      body,
    });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    let usageSeen = '';
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!usageSeen && text.includes('"usage"')) {
        const match = text.match(/"usage"\s*:\s*\{[^}]*\}/);
        if (match) usageSeen = match[0];
      }
      res.write(value);
    }
    res.end();
    console.log(
      '[model-proxy] done model=' +
        model +
        ' status=' +
        upstream.status +
        ' ms=' +
        (Date.now() - started) +
        ' usage=' +
        (usageSeen || 'n/a'),
    );
  } catch (error) {
    console.error('[model-proxy] upstream error: ' + error.message);
    if (!res.headersSent) res.writeHead(502);
    res.end(JSON.stringify({ error: { message: error.message } }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[model-proxy] listening on 127.0.0.1:' + PORT + ' upstream=' + UPSTREAM);
});
