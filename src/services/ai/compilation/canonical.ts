import { computeContentSha256 } from '../../../utils/contentIntegrity.ts';

export function normalizeCompilationText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function estimateTokens(value: string): number {
  const bytes = utf8Length(value);
  return bytes === 0 ? 0 : Math.ceil(bytes / 3);
}

export function compareCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function stableCanonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(record[key])}`)
    .join(',')}}`;
}

export async function sha256(value: string): Promise<string> {
  const hash = await computeContentSha256(value);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('Web Crypto SHA-256 is required for formal AI compilation.');
  }
  return hash;
}

export async function canonicalHash(value: unknown): Promise<string> {
  return sha256(stableCanonicalJson(value));
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
