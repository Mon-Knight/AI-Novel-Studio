import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiSettings } from '../../types/ai';
import { attachAiUsageCost, calculateAiUsageCost, createAiPricingSnapshot } from './aiCost';

function settings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'test-key',
    modelName: 'test-model',
    mockMode: false,
    ...overrides,
  };
}

test('configured pricing produces a deterministic USD estimate', () => {
  const pricing = createAiPricingSnapshot(
    settings({
      inputPricePerMillionTokens: 2,
      outputPricePerMillionTokens: 8,
    }),
  );
  assert.deepEqual(calculateAiUsageCost(pricing, 250_000, 125_000), {
    currency: 'USD',
    source: 'user_configured',
    inputPricePerMillionTokens: 2,
    outputPricePerMillionTokens: 8,
    status: 'complete',
    estimatedCost: 1.5,
  });
});

test('unconfigured pricing and missing usage remain explicit instead of reporting zero', () => {
  const unpriced = createAiPricingSnapshot(settings());
  assert.equal(calculateAiUsageCost(unpriced, 10, 20).status, 'unpriced');
  const configured = createAiPricingSnapshot(
    settings({
      inputPricePerMillionTokens: 1,
      outputPricePerMillionTokens: 2,
    }),
  );
  assert.equal(calculateAiUsageCost(configured, undefined, 20).status, 'usage_missing');
  assert.equal(calculateAiUsageCost(configured, -1, 20).status, 'usage_missing');
  assert.equal(
    calculateAiUsageCost(configured, Number.MAX_SAFE_INTEGER + 1, 20).status,
    'usage_missing',
  );
});

test('single-sided pricing is discarded as an unconfigured snapshot', () => {
  assert.deepEqual(
    createAiPricingSnapshot(
      settings({
        inputPricePerMillionTokens: 2,
      }),
    ),
    {
      currency: 'USD',
      source: 'unconfigured',
    },
  );
  assert.deepEqual(
    createAiPricingSnapshot(
      settings({
        outputPricePerMillionTokens: 8,
      }),
    ),
    {
      currency: 'USD',
      source: 'unconfigured',
    },
  );
});

test('mock responses are metered as zero without requiring usage fields', () => {
  const result = attachAiUsageCost(
    { text: 'mock response' },
    settings({ runtimeMode: 'mock', provider: 'mock', mockMode: true }),
  );
  assert.deepEqual(result.usageCost, {
    currency: 'USD',
    source: 'mock',
    inputPricePerMillionTokens: 0,
    outputPricePerMillionTokens: 0,
    status: 'mock',
    estimatedCost: 0,
  });
});
