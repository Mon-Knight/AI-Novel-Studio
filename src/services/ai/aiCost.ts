import type {
  AiGenerateResponse,
  AiPricingSnapshot,
  AiSettings,
  AiUsageCost,
} from '../../types/ai';

const MAX_PRICE_PER_MILLION_TOKENS = 1_000_000;
const TOKENS_PER_MILLION = 1_000_000;

function optionalRate(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_PRICE_PER_MILLION_TOKENS) {
    return undefined;
  }
  return numeric;
}

export function normalizeAiTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function createAiPricingSnapshot(settings: AiSettings): AiPricingSnapshot {
  if (settings.runtimeMode === 'mock') {
    return {
      currency: 'USD',
      source: 'mock',
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    };
  }

  const inputPricePerMillionTokens = optionalRate(settings.inputPricePerMillionTokens);
  const outputPricePerMillionTokens = optionalRate(settings.outputPricePerMillionTokens);
  const configured =
    inputPricePerMillionTokens !== undefined && outputPricePerMillionTokens !== undefined;
  if (!configured) {
    return {
      currency: 'USD',
      source: 'unconfigured',
    };
  }
  return {
    currency: 'USD',
    source: 'user_configured',
    inputPricePerMillionTokens,
    outputPricePerMillionTokens,
  };
}

export function calculateAiUsageCost(
  pricing: AiPricingSnapshot,
  tokenInput: unknown,
  tokenOutput: unknown,
): AiUsageCost {
  if (pricing.source === 'mock') {
    return { ...pricing, status: 'mock', estimatedCost: 0 };
  }

  if (
    pricing.source !== 'user_configured' ||
    pricing.inputPricePerMillionTokens === undefined ||
    pricing.outputPricePerMillionTokens === undefined
  ) {
    return { ...pricing, status: 'unpriced' };
  }

  const input = normalizeAiTokenCount(tokenInput);
  const output = normalizeAiTokenCount(tokenOutput);
  if (input === undefined || output === undefined) {
    return { ...pricing, status: 'usage_missing' };
  }

  const estimatedCost =
    (input * pricing.inputPricePerMillionTokens + output * pricing.outputPricePerMillionTokens) /
    TOKENS_PER_MILLION;
  return {
    ...pricing,
    status: 'complete',
    estimatedCost: Math.round(estimatedCost * 100_000_000) / 100_000_000,
  };
}

export function attachAiUsageCost(
  response: AiGenerateResponse,
  settings: AiSettings,
): AiGenerateResponse {
  return {
    ...response,
    usageCost: calculateAiUsageCost(
      createAiPricingSnapshot(settings),
      response.tokenInput,
      response.tokenOutput,
    ),
  };
}
