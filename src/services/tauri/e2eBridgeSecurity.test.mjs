import assert from 'node:assert/strict';
import test from 'node:test';

const { installE2eNetworkGuard } = await import('./e2eNetworkGuard.ts');
const { sanitizeDiagnosticValue, serializeConsoleArguments } =
  await import('./e2eDiagnosticSanitizer.ts');
const { isE2eBridgeCommandAllowed } = await import('./e2eBridgePolicy.ts');

test('closed-loop E2E additions expose queries but not adoption mutations', () => {
  for (const command of [
    'get_review_authorization',
    'get_e2e_agent_closed_loop_state',
    'get_task_conversation',
    'get_result_artifact',
  ]) {
    assert.equal(isE2eBridgeCommandAllowed(command), true, command);
  }

  for (const command of [
    'adopt_review_authorized_draft',
    'consume_review_authorization',
    'create_task_conversation',
    'delete_chapter_draft',
    'save_chapter_draft',
  ]) {
    assert.equal(isE2eBridgeCommandAllowed(command), false, command);
  }
});

function createWindow() {
  const calls = { fetch: [], xhr: [], websocket: 0, eventsource: 0, beacon: 0 };

  class FakeXMLHttpRequest {
    open(method, url) {
      calls.xhr.push([method, String(url)]);
    }
  }
  class FakeWebSocket {
    constructor() {
      calls.websocket += 1;
    }
  }
  class FakeEventSource {
    constructor() {
      calls.eventsource += 1;
    }
  }

  const fakeWindow = {
    location: { href: 'https://tauri.localhost/index.html' },
    fetch(input) {
      calls.fetch.push(String(input));
      return Promise.resolve({ ok: true });
    },
    XMLHttpRequest: FakeXMLHttpRequest,
    WebSocket: FakeWebSocket,
    EventSource: FakeEventSource,
    navigator: {
      sendBeacon() {
        calls.beacon += 1;
        return true;
      },
    },
  };
  return { fakeWindow, calls };
}

test('E2E network guard permits app-local assets and blocks external transports', async () => {
  const { fakeWindow, calls } = createWindow();
  const guard = installE2eNetworkGuard(fakeWindow);

  await fakeWindow.fetch('/prompts/style.md');
  const xhr = new fakeWindow.XMLHttpRequest();
  xhr.open('GET', '/local.json');
  assert.deepEqual(calls.fetch, ['/prompts/style.md']);
  assert.deepEqual(calls.xhr, [['GET', '/local.json']]);

  await assert.rejects(
    fakeWindow.fetch('https://secret.example/api?api_key=never-store'),
    /blocked/,
  );
  assert.throws(() => xhr.open('POST', 'https://secret.example/private'), /blocked/);
  assert.throws(
    () => new fakeWindow.WebSocket('wss://secret.example/socket?token=never-store'),
    /blocked/,
  );
  assert.throws(
    () => new fakeWindow.EventSource('https://secret.example/events?token=never-store'),
    /blocked/,
  );
  assert.equal(
    fakeWindow.navigator.sendBeacon(
      'https://secret.example/report?token=never-store',
      'private body',
    ),
    false,
  );

  assert.equal(calls.websocket, 0);
  assert.equal(calls.eventsource, 0);
  assert.equal(calls.beacon, 0);
  const diagnostics = guard.getAttempts();
  assert.equal(diagnostics.total, 5);
  assert.deepEqual(diagnostics.byTransport, {
    fetch: 1,
    xhr: 1,
    websocket: 1,
    eventsource: 1,
    beacon: 1,
  });
  assert.deepEqual(
    diagnostics.attempts.map((attempt) => attempt.transport),
    ['fetch', 'xhr', 'websocket', 'eventsource', 'beacon'],
  );
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /secret\.example|never-store|private/);

  guard.clear();
  assert.equal(guard.getAttempts().total, 0);
});

test('E2E network guard installation is idempotent', () => {
  const { fakeWindow } = createWindow();
  assert.equal(installE2eNetworkGuard(fakeWindow), installE2eNetworkGuard(fakeWindow));
});

test('console diagnostics retain safe context and redact sensitive fields in every argument', () => {
  const text = serializeConsoleArguments([
    'AI command failed',
    {
      command: 'generate_chapter',
      errorMessage: 'provider unavailable',
      args: { chapterId: 'chapter-1' },
      prompt: 'private manuscript text',
      headers: { Authorization: 'Bearer secret' },
      body: 'private body',
      token: 'secret-token',
      nested: { apiKey: 'sk-abcdefghijklmnop', content: 'private content' },
    },
    new Error('request failed'),
  ]);

  assert.match(text, /AI command failed/);
  assert.match(text, /generate_chapter/);
  assert.match(text, /provider unavailable/);
  assert.match(text, /request failed/);
  assert.doesNotMatch(
    text,
    /chapter-1|manuscript|Bearer secret|private body|secret-token|abcdefghijklmnop|private content/,
  );
  assert.equal((text.match(/\[REDACTED\]/g) ?? []).length >= 6, true);
});

test('console label arguments redact the following value and handle cycles', () => {
  const cyclic = { command: 'save_chapter' };
  cyclic.self = cyclic;
  const text = serializeConsoleArguments(['prompt:', 'full private prompt', cyclic]);
  assert.doesNotMatch(text, /full private prompt/);
  assert.match(text, /save_chapter/);
  assert.match(text, /Circular/);

  assert.deepEqual(
    sanitizeDiagnosticValue({
      command: 'save',
      errorMessage: 'timeout',
      auth: 'secret',
    }),
    {
      command: 'save',
      errorMessage: 'timeout',
      auth: '[REDACTED]',
    },
  );

  const throwingProxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('private proxy data');
      },
    },
  );
  assert.equal(
    serializeConsoleArguments(['proxy', throwingProxy]),
    '["proxy","[Uninspectable Object]"]',
  );
});
