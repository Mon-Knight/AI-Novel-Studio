import { computeContentSha256 } from '../../utils/contentIntegrity';

export interface WorkbenchAssetScopeEvidence {
  source: string;
  revision?: string;
  fingerprint?: string;
}

export function safeUpdatedAt(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ? `更新 ${match[1]}` : undefined;
}

export function latestUpdatedAt(values: Array<string | undefined>): string | undefined {
  const dates = values
    .flatMap((value) => value?.trim().match(/^(\d{4}-\d{2}-\d{2})/u)?.[1] ?? [])
    .sort();
  return dates.length > 0 ? `更新 ${dates[dates.length - 1]}` : undefined;
}

export function safeVersion(value: number | undefined): string | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? `v${value}` : undefined;
}

export function compactSha256(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized)
    ? `sha256:${normalized.slice(0, 8)}...${normalized.slice(-4)}`
    : undefined;
}

export async function fingerprint(material: unknown): Promise<string | undefined> {
  if (material === undefined || material === null || material === '') return undefined;
  try {
    return compactSha256(await computeContentSha256(JSON.stringify(material)));
  } catch {
    return undefined;
  }
}

export async function assetEvidence(
  source: string,
  material: unknown,
  revision?: string,
): Promise<WorkbenchAssetScopeEvidence> {
  const contentFingerprint = await fingerprint(material);
  return {
    source,
    ...(revision ? { revision } : {}),
    ...(contentFingerprint ? { fingerprint: contentFingerprint } : {}),
  };
}

export function formatCount(value: number): string {
  return value.toLocaleString('zh-CN');
}
