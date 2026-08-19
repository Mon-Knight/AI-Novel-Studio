interface CryptoIdSource {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

let fallbackTime = 0;
let fallbackSequence = 0;

function defaultCryptoSource(): CryptoIdSource | null {
  if (typeof globalThis.crypto === 'undefined') return null;
  return {
    randomUUID:
      typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
        : undefined,
    getRandomValues:
      typeof globalThis.crypto.getRandomValues === 'function'
        ? (bytes) => globalThis.crypto.getRandomValues(bytes)
        : undefined,
  };
}

function uuidFromRandomBytes(source: CryptoIdSource): string | null {
  if (!source.getRandomValues) return null;
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function monotonicFallbackId(): string {
  const now = Date.now();
  if (now > fallbackTime) {
    fallbackTime = now;
    fallbackSequence = 0;
  } else {
    fallbackSequence += 1;
  }
  return `fallback-${fallbackTime.toString(36)}-${fallbackSequence.toString(36)}`;
}

/**
 * Creates an opaque identifier with Web Crypto when available. The deterministic
 * monotonic fallback exists only for runtimes that expose neither crypto API.
 */
export function createUniqueId(source: CryptoIdSource | null = defaultCryptoSource()): string {
  const uuid = source?.randomUUID?.();
  if (uuid) return uuid;
  return (source && uuidFromRandomBytes(source)) || monotonicFallbackId();
}
