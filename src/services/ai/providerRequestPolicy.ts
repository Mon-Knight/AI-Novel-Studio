import type { AiTaskType } from '../../types/ai';
import providerRequestPolicy from '../../constants/providerRequestPolicy.json';

export const CONNECTION_TEST_MAX_OUTPUT_TOKENS =
  providerRequestPolicy.connectionTest.maxOutputTokens;
export const CONNECTION_TEST_TEMPERATURE = providerRequestPolicy.connectionTest.temperature;
export const AUTONOMOUS_CHAPTER_BATCH_MIN_TIMEOUT_SECONDS =
  providerRequestPolicy.autonomousChapterBatch.minTimeoutSeconds;

const MAX_REQUEST_ID_BYTES = 128;
const REQUEST_ID_DIGEST_HEX_LENGTH = 16;

function normalizeRequestIdPart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function digestRequestIdPart(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`.slice(0, REQUEST_ID_DIGEST_HEX_LENGTH);
}

export function buildProviderTransportRequestId(logicalId: string, attemptId: string): string {
  const normalizedAttemptId = normalizeRequestIdPart(attemptId, 'attempt');
  const attemptDigest = digestRequestIdPart(attemptId);
  const digestSuffix = `-${attemptDigest}`;
  const maxSuffixLength = MAX_REQUEST_ID_BYTES - 2;
  const suffix = `${normalizedAttemptId.slice(0, maxSuffixLength - digestSuffix.length)}${
    digestSuffix
  }`;
  const prefix = normalizeRequestIdPart(logicalId, 'ai');
  const maxPrefixLength = Math.max(1, MAX_REQUEST_ID_BYTES - suffix.length - 1);
  return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
}

export function createProviderTransportRequestId(logicalId: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const attemptId = uuid ?? `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return buildProviderTransportRequestId(logicalId, attemptId);
}

export function resolveProviderTimeoutSeconds(
  taskType: AiTaskType | undefined,
  configuredTimeoutSeconds: number | undefined,
): number | undefined {
  if (taskType !== 'autonomous_chapter_batch') return configuredTimeoutSeconds;
  return Math.max(configuredTimeoutSeconds ?? 0, AUTONOMOUS_CHAPTER_BATCH_MIN_TIMEOUT_SECONDS);
}
