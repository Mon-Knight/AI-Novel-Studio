//! Client-writable model snapshot validation and canonical comparison.
import type { TaskModelSnapshot } from '../../types/conversation';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isModelSnapshotSecretField(key: string): boolean {
  const normalized = key
    .split('')
    .filter((character) => /[a-z0-9]/i.test(character))
    .join('')
    .toLowerCase();
  return (
    normalized.endsWith('apikey') ||
    normalized.endsWith('authorization') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('authtoken') ||
    normalized.endsWith('apitoken') ||
    normalized.endsWith('bearertoken') ||
    normalized.endsWith('sessiontoken') ||
    normalized.endsWith('password') ||
    normalized.endsWith('passphrase') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('credentials') ||
    normalized.endsWith('cookie') ||
    normalized.endsWith('cookies') ||
    normalized.endsWith('privatekey')
  );
}

function containsModelSnapshotSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsModelSnapshotSecret);
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('bearer ') ||
      lower.includes('authorization:') ||
      lower.includes('x-api-key') ||
      lower.includes('x_api_key') ||
      lower.includes('xapikey') ||
      lower.includes('openaiapikey') ||
      lower.includes('api_key=') ||
      lower.includes('apikey=') ||
      lower.includes('api-key=') ||
      lower.includes('credentials=') ||
      lower.includes('"credentials"') ||
      lower.includes('-----begin private key-----') ||
      value
        .split(/[\s"'=:,;()[\]{}]+/)
        .some(
          (token) =>
            (token.startsWith('sk-') && token.length >= 19) || /^AKIA[A-Z0-9]{16}$/.test(token),
        )
    );
  }
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => isModelSnapshotSecretField(key) || containsModelSnapshotSecret(child),
  );
}

export function assertSafeModelSnapshot(
  value: unknown,
  label: string,
): asserts value is TaskModelSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  if (containsModelSnapshotSecret(value)) {
    throw new Error(`${label}不得包含 API Key 或其他凭据`);
  }
}

export function assertClientWritableModelSnapshot(value: TaskModelSnapshot, label: string): void {
  const runtime = value.runtime as Record<string, unknown> | undefined;
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, 'toolCallingAttestation')) {
    const error = new Error(
      `${label}不得声明模型工具认证；该证明只能由 DSH 运行时写入`,
    ) as Error & { code: string };
    error.code = 'MODEL_ATTESTATION_UNTRUSTED';
    throw error;
  }
}

export function modelSnapshotFrom(
  value: TaskModelSnapshot | undefined,
): TaskModelSnapshot | undefined {
  if (!value) return undefined;
  assertSafeModelSnapshot(value, '模型快照');
  return clone(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function sameModelSnapshot(left: TaskModelSnapshot, right: TaskModelSnapshot): boolean {
  const lockProjection = (snapshot: TaskModelSnapshot) => {
    const projected = clone(snapshot);
    if (projected.runtime) delete projected.runtime.toolCallingAttestation;
    return projected;
  };
  return stableJson(lockProjection(left)) === stableJson(lockProjection(right));
}

export function isLocalConversationalSnapshot(snapshot: TaskModelSnapshot): boolean {
  return (
    snapshot.providerId === 'ans-local' &&
    snapshot.runtime?.adapterProtocol === 'ans_local_conversation_v1'
  );
}
