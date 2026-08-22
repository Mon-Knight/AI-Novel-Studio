export type E2eNetworkTransport = 'fetch' | 'xhr' | 'websocket' | 'eventsource' | 'beacon';

export interface E2eNetworkAttempt {
  transport: E2eNetworkTransport;
  protocol: string;
  at: string;
}

export interface E2eNetworkAttempts {
  installed: true;
  total: number;
  byTransport: Record<E2eNetworkTransport, number>;
  attempts: E2eNetworkAttempt[];
}

export interface E2eNetworkGuard {
  getAttempts: () => E2eNetworkAttempts;
  clear: () => void;
}

interface E2eNetworkTarget {
  location: { href: string };
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: typeof WebSocket;
  EventSource?: typeof EventSource;
  navigator?: { sendBeacon?: Navigator['sendBeacon'] };
}

const MAX_RECORDED_ATTEMPTS = 100;
const guards = new WeakMap<object, E2eNetworkGuard>();

function emptyCounts(): Record<E2eNetworkTransport, number> {
  return { fetch: 0, xhr: 0, websocket: 0, eventsource: 0, beacon: 0 };
}

function targetText(target: unknown): string | undefined {
  if (typeof target === 'string') return target;
  if (typeof URL !== 'undefined' && target instanceof URL) return target.href;
  if (!target || typeof target !== 'object') return undefined;
  try {
    const url = Reflect.get(target, 'url');
    return typeof url === 'string' ? url : undefined;
  } catch {
    return undefined;
  }
}

function parseTarget(target: unknown, baseHref: string): URL | undefined {
  const text = targetText(target);
  if (!text) return undefined;
  try {
    return new URL(text, baseHref);
  } catch {
    return undefined;
  }
}

function protocolOf(target: unknown, baseHref: string): string {
  return parseTarget(target, baseHref)?.protocol.toLowerCase() || 'invalid';
}

function sameEndpoint(target: URL, base: URL): boolean {
  return (
    target.protocol === base.protocol &&
    target.hostname === base.hostname &&
    target.port === base.port
  );
}

function isExternalTarget(target: unknown, baseHref: string): boolean {
  const parsed = parseTarget(target, baseHref);
  if (!parsed) return true;
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:')
    return false;
  try {
    return !sameEndpoint(parsed, new URL(baseHref));
  } catch {
    return true;
  }
}

function replaceProperty(target: object, key: PropertyKey, value: unknown): void {
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value,
    });
  } catch {
    if (!Reflect.set(target, key, value)) {
      throw new Error(`E2E network guard could not secure ${String(key)}`);
    }
  }
  if (Reflect.get(target, key) !== value) {
    throw new Error(`E2E network guard could not verify ${String(key)}`);
  }
}

function blockedError(transport: E2eNetworkTransport): TypeError {
  return new TypeError(`External ${transport} request blocked by E2E network guard`);
}

export function installE2eNetworkGuard(target: E2eNetworkTarget): E2eNetworkGuard {
  const existing = guards.get(target);
  if (existing) return existing;

  const baseHref = target.location.href;
  let total = 0;
  let byTransport = emptyCounts();
  let attempts: E2eNetworkAttempt[] = [];

  const record = (transport: E2eNetworkTransport, requestTarget: unknown) => {
    total += 1;
    byTransport[transport] += 1;
    attempts = [
      ...attempts,
      {
        transport,
        protocol: protocolOf(requestTarget, baseHref),
        at: new Date().toISOString(),
      },
    ].slice(-MAX_RECORDED_ATTEMPTS);
  };

  const guard: E2eNetworkGuard = {
    getAttempts: () => ({
      installed: true,
      total,
      byTransport: { ...byTransport },
      attempts: attempts.map((attempt) => ({ ...attempt })),
    }),
    clear: () => {
      total = 0;
      byTransport = emptyCounts();
      attempts = [];
    },
  };
  guards.set(target, guard);

  if (typeof target.fetch === 'function') {
    const originalFetch = target.fetch;
    const guardedFetch: typeof fetch = function (input, init) {
      if (isExternalTarget(input, baseHref)) {
        record('fetch', input);
        return Promise.reject(blockedError('fetch'));
      }
      return Reflect.apply(originalFetch, target, [input, init]);
    };
    replaceProperty(target, 'fetch', guardedFetch);
  }

  const xhrPrototype = target.XMLHttpRequest?.prototype;
  if (xhrPrototype && typeof xhrPrototype.open === 'function') {
    const originalOpen = xhrPrototype.open;
    const guardedOpen = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      if (isExternalTarget(url, baseHref)) {
        record('xhr', url);
        throw blockedError('xhr');
      }
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    replaceProperty(xhrPrototype, 'open', guardedOpen);
  }

  if (typeof target.WebSocket === 'function') {
    const originalWebSocket = target.WebSocket;
    const guardedWebSocket = new Proxy(originalWebSocket, {
      apply(_constructor, _thisArg, args) {
        record('websocket', args[0]);
        throw blockedError('websocket');
      },
      construct(_constructor, args) {
        record('websocket', args[0]);
        throw blockedError('websocket');
      },
    });
    replaceProperty(target, 'WebSocket', guardedWebSocket);
  }

  if (typeof target.EventSource === 'function') {
    const originalEventSource = target.EventSource;
    const guardedEventSource = new Proxy(originalEventSource, {
      apply(_constructor, _thisArg, args) {
        record('eventsource', args[0]);
        throw blockedError('eventsource');
      },
      construct(_constructor, args) {
        record('eventsource', args[0]);
        throw blockedError('eventsource');
      },
    });
    replaceProperty(target, 'EventSource', guardedEventSource);
  }

  if (typeof target.navigator?.sendBeacon === 'function') {
    const guardedBeacon: Navigator['sendBeacon'] = (url) => {
      record('beacon', url);
      return false;
    };
    replaceProperty(target.navigator, 'sendBeacon', guardedBeacon);
  }

  return guard;
}
