import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiGenerateRequest, AiSettings } from '../../types/ai';
import { aiRequestPolicyService, AiRequestPolicyError } from './aiRequestPolicyService';

const request: AiGenerateRequest = {
  messages: [{ role: 'user', content: '测试请求内容' }],
  maxTokens: 100,
};

function settings(patch: Partial<AiSettings> = {}): AiSettings {
  return {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'test-key',
    modelName: 'test-model',
    mockMode: false,
    maxTokens: 100,
    maxRequestsPerMinute: 2,
    maxConcurrentAiRequests: 1,
    inputPricePerMillionTokens: 1,
    outputPricePerMillionTokens: 2,
    ...patch,
  };
}

describe('aiRequestPolicyService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T10:00:00+08:00'));
    aiRequestPolicyService.clearForTests();
  });

  it('enforces concurrent and rolling-minute limits before another provider call', () => {
    const config = settings();
    const first = aiRequestPolicyService.begin(config, request);
    expect(() => aiRequestPolicyService.begin(config, request)).toThrowError(
      expect.objectContaining({ code: 'AI_CONCURRENCY_LIMIT_EXCEEDED' }),
    );
    aiRequestPolicyService.settle(first, config, { text: 'ok', tokenInput: 10, tokenOutput: 20 });
    const second = aiRequestPolicyService.begin(config, request);
    aiRequestPolicyService.settle(second, config, { text: 'ok', tokenInput: 10, tokenOutput: 20 });
    expect(() => aiRequestPolicyService.begin(config, request)).toThrowError(
      expect.objectContaining({ code: 'AI_RATE_LIMIT_EXCEEDED' }),
    );
  });

  it('reserves worst-case tokens and blocks a request that would cross a hard budget', () => {
    const config = settings({ dailyTokenBudget: 50 });
    expect(() => aiRequestPolicyService.begin(config, request)).toThrowError(
      expect.objectContaining({ code: 'AI_DAILY_TOKEN_BUDGET_EXCEEDED' }),
    );
  });

  it('requires frozen pricing for a cost hard budget', () => {
    const config = settings({
      dailyCostBudgetUsd: 1,
      inputPricePerMillionTokens: undefined,
      outputPricePerMillionTokens: undefined,
    });
    expect(() => aiRequestPolicyService.begin(config, request)).toThrowError(AiRequestPolicyError);
    expect(() => aiRequestPolicyService.begin(config, request)).toThrowError(
      expect.objectContaining({ code: 'AI_BUDGET_PRICING_REQUIRED' }),
    );
  });

  it('settles actual usage and conservatively accounts for missing usage', () => {
    const config = settings({ maxConcurrentAiRequests: 2, maxRequestsPerMinute: 10 });
    const complete = aiRequestPolicyService.begin(config, request);
    aiRequestPolicyService.settle(complete, config, {
      text: 'ok',
      tokenInput: 100,
      tokenOutput: 200,
    });
    const missing = aiRequestPolicyService.begin(config, request);
    aiRequestPolicyService.settle(missing, config, { text: 'ok' });
    const snapshot = aiRequestPolicyService.snapshot(config);
    expect(snapshot.tokenUsed).toBeGreaterThanOrEqual(400);
    expect(snapshot.usageMissingCount).toBe(1);
    expect(snapshot.activeRequests).toBe(0);
    expect(snapshot.costUsedUsd).toBeGreaterThan(0);
  });
});
