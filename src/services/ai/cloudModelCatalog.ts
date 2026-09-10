import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';

export function buildOpenAiModelsUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/u, '');
  if (clean.endsWith('/models')) return clean;
  if (clean.endsWith('/chat/completions')) {
    return `${clean.slice(0, -'/chat/completions'.length)}/models`;
  }
  if (clean.endsWith('/v1')) return `${clean}/models`;
  return `${clean}/v1/models`;
}

export function parseOpenAiModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  const buckets = [record.data, record.models];
  const ids: string[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      const id =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object'
            ? ['id', 'model', 'name']
                .map((field) => (item as Record<string, unknown>)[field])
                .find((value): value is string => typeof value === 'string')
            : undefined;
      const trimmed = id?.trim();
      if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
    }
  }
  return ids;
}

function describeCatalogFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return '获取上游模型失败。';
}

async function listCloudModelsInBrowser(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(buildOpenAiModelsUrl(baseUrl), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('上游拒绝了鉴权，请检查 API 密钥。');
    }
    throw new Error(`获取上游模型返回 HTTP ${response.status}。`);
  }
  return parseOpenAiModelIds(await response.json());
}

export async function listCloudModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const baseUrl = input.baseUrl.trim();
  const apiKey = input.apiKey.trim();
  if (!baseUrl) throw new Error('缺少 API 地址，无法获取上游模型。');
  if (!apiKey) throw new Error('缺少 API 密钥，无法获取上游模型。');
  try {
    if (isTauriRuntime()) {
      return await tauriInvoke<string[]>('list_cloud_models', {
        request: { baseUrl, apiKey },
      });
    }
    return await listCloudModelsInBrowser(baseUrl, apiKey);
  } catch (error) {
    throw new Error(describeCatalogFailure(error));
  }
}

export function mergeFetchedModelIds(
  current: Array<{ modelName: string }>,
  fetchedIds: string[],
): string[] {
  const existing = current.map((model) => model.modelName.trim()).filter(Boolean);
  const merged = [...existing];
  for (const id of fetchedIds) {
    const trimmed = id.trim();
    if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
  }
  return merged;
}

export function formatTokenBudget(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}K`;
  return String(Math.round(value));
}

export function parseTokenBudget(value: string, fallback: number): number {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return fallback;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)K$/u);
  if (match) {
    const parsed = Number(match[1]) * 1000;
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}
