/**
 * Canonical identity helpers shared by settings, Workbench selection and the
 * DSH Runtime projection.  Runtime/provider aliases are normalized here so a
 * saved model, a frozen task snapshot and a Runtime row use one key.
 */
export function canonicalModelProviderId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (
    normalized === 'deepseek' ||
    normalized === 'deepseek_official' ||
    normalized === 'deepseek-official'
  ) {
    return 'deepseek-official';
  }
  if (normalized === 'openai_compatible' || normalized === 'openai-compatible') {
    return 'openai_compatible';
  }
  return normalized;
}

export function normalizeModelId(modelId: string): string {
  return modelId.trim();
}

export function normalizeModelBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export interface ModelIdentityInput {
  providerId: string;
  modelId: string;
  baseUrl?: string;
}

export function modelIdentityKey(model: ModelIdentityInput): string {
  const providerId = canonicalModelProviderId(model.providerId);
  const modelId = normalizeModelId(model.modelId);
  const baseUrl = model.baseUrl === undefined ? '' : normalizeModelBaseUrl(model.baseUrl);
  return `${providerId}\u0000${modelId}\u0000${baseUrl}`;
}

export function modelRouteKey(model: ModelIdentityInput): string {
  return `${canonicalModelProviderId(model.providerId)}:${normalizeModelId(model.modelId)}`;
}
