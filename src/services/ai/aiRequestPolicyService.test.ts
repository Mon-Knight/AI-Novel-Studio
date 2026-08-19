import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiGenerateRequest, AiSettings } from '../../types/ai';
import { aiRequestPolicyService, AiRequestPolicyError } from './aiRequestPolicyService';

const tauriRuntime = vi.hoisted(() => ({
  enabled: false,
  invoke: vi.fn(),
}));

vi.mock('../tauri/runtime', () => ({
  isTauriRuntime: () => tauriRuntime.enabled,
  tauriInvoke: (...args: unknown[]) => tauriRuntime.invoke(...args),
}));

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
    tauriRuntime.enabled = false;
    tauriRuntime.invoke.mockReset();
    aiRequestPolicyService.clearForTests();
  });

  it('uses SQLite reservation and idempotent settlement IPC in Tauri without local fallback', async () => {
    tauriRuntime.enabled = true;
    tauriRuntime.invoke
      .mockResolvedValueOnce({
        reservationId: 'reservation-1',
        ownerId: 'webview-owner-1',
        providerRequestId: 'provider-request-1',
        leaseToken: 'lease-token-1',
        expiresAtMs: Date.now() + 120_000,
        policyRevision: 3,
        estimatedInputTokens: 10,
        estimatedOutputTokens: 100,
        estimatedTokens: 110,
        estimatedCostUsd: 0.001,
        inputPricePerMillionTokens: 1,
        outputPricePerMillionTokens: 2,
      })
      .mockResolvedValueOnce({
        reservationId: 'reservation-1',
        status: 'settled',
        replayed: false,
      });

    const lease = await aiRequestPolicyService.beginRequest(
      settings(),
      request,
      'provider-request-1',
    );
    expect(lease).toMatchObject({
      id: 'reservation-1',
      storage: 'sqlite',
      ownerId: 'webview-owner-1',
      providerRequestId: 'provider-request-1',
      leaseToken: 'lease-token-1',
      policyRevision: 3,
    });
    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(
      1,
      'reserve_ai_request',
      expect.objectContaining({
        input: expect.objectContaining({
          maxConcurrentRequests: 1,
          maxRequestsPerMinute: 2,
          providerRequestId: 'provider-request-1',
          estimatedOutputTokens: 100,
        }),
      }),
    );

    await aiRequestPolicyService.settleRequest(lease, settings(), {
      text: 'ok',
      tokenInput: 10,
      tokenOutput: 20,
    });
    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(2, 'settle_ai_request', {
      input: {
        reservationId: 'reservation-1',
        ownerId: 'webview-owner-1',
        leaseToken: 'lease-token-1',
        outcome: 'succeeded',
        tokenInput: 10,
        tokenOutput: 20,
      },
    });
    expect(localStorage.getItem('ai_novel_studio_ai_request_ledger_v1')).toBeNull();
  });

  it('fails closed when desktop reservation IPC rejects', async () => {
    tauriRuntime.enabled = true;
    tauriRuntime.invoke.mockRejectedValueOnce({
      code: 'DATABASE_BUSY',
      message: 'database busy',
      retryable: true,
    });
    await expect(
      aiRequestPolicyService.beginRequest(settings(), request, 'provider-request-2'),
    ).rejects.toMatchObject({ code: 'DATABASE_BUSY' });
    expect(localStorage.getItem('ai_novel_studio_ai_request_ledger_v1')).toBeNull();
  });

  it('pins the first observed policy revision until a successful CAS save', async () => {
    tauriRuntime.enabled = true;
    tauriRuntime.invoke
      .mockResolvedValueOnce({
        policy: { revision: 7, policyHash: 'policy-7' },
        day: '2026-07-28',
        requestsLastMinute: 0,
        activeRequests: 0,
        tokenUsed: 0,
        reservedTokens: 0,
        costUsedUsd: 0,
        reservedCostUsd: 0,
        usageMissingCount: 0,
        warningPercent: 80,
        warning: false,
      })
      .mockResolvedValueOnce({
        policy: { revision: 8, policyHash: 'policy-8' },
        day: '2026-07-28',
      })
      .mockResolvedValueOnce({ revision: 9, policyHash: 'policy-9' })
      .mockResolvedValueOnce({ revision: 10, policyHash: 'policy-10' });

    await aiRequestPolicyService.snapshotCurrent(settings());
    await aiRequestPolicyService.snapshotCurrent(settings({ maxRequestsPerMinute: 3 }));
    await aiRequestPolicyService.configureGlobalPolicy(settings({ maxRequestsPerMinute: 3 }));
    await aiRequestPolicyService.configureGlobalPolicy(settings({ maxRequestsPerMinute: 4 }));

    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(
      3,
      'configure_ai_request_policy',
      expect.objectContaining({ input: expect.objectContaining({ expectedRevision: 7 }) }),
    );
    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(
      4,
      'configure_ai_request_policy',
      expect.objectContaining({ input: expect.objectContaining({ expectedRevision: 9 }) }),
    );
    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(1, 'get_ai_request_policy_snapshot');
    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(2, 'get_ai_request_policy_snapshot');
  });

  it('pins an initially absent policy instead of absorbing a later cross-process insert', async () => {
    tauriRuntime.enabled = true;
    tauriRuntime.invoke
      .mockResolvedValueOnce({ day: '2026-07-28' })
      .mockResolvedValueOnce({ policy: { revision: 4, policyHash: 'policy-4' } })
      .mockResolvedValueOnce({ revision: 1, policyHash: 'new-policy' });

    await aiRequestPolicyService.snapshotCurrent(settings());
    await aiRequestPolicyService.snapshotCurrent(settings());
    await aiRequestPolicyService.configureGlobalPolicy(settings());

    expect(tauriRuntime.invoke).toHaveBeenNthCalledWith(
      3,
      'configure_ai_request_policy',
      expect.objectContaining({ input: expect.objectContaining({ expectedRevision: undefined }) }),
    );
  });

  it('does not silently authorize an unseen desktop policy before the first CAS save', async () => {
    tauriRuntime.enabled = true;
    tauriRuntime.invoke.mockResolvedValueOnce({ revision: 1, policyHash: 'policy-1' });

    await aiRequestPolicyService.configureGlobalPolicy(settings());

    expect(tauriRuntime.invoke).toHaveBeenCalledTimes(1);
    expect(tauriRuntime.invoke).toHaveBeenCalledWith(
      'configure_ai_request_policy',
      expect.objectContaining({ input: expect.objectContaining({ expectedRevision: undefined }) }),
    );
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

  it('uses a UTF-8 byte upper bound plus chat envelopes for input reservation', () => {
    const content = '汉字🙂abc';
    const boundedRequest: AiGenerateRequest = {
      messages: [{ role: 'user', content }],
      maxTokens: 1,
    };
    const lease = aiRequestPolicyService.begin(settings({ maxTokens: 1 }), boundedRequest);
    const payloadBytes = new TextEncoder().encode(`user${content}`).byteLength;
    expect(lease.estimatedTokens - 1).toBeGreaterThanOrEqual(payloadBytes + 64 + 256);
  });

  it('conservatively accounts browser provider failures instead of only releasing the lease', () => {
    const config = settings({ maxRequestsPerMinute: 10 });
    const lease = aiRequestPolicyService.begin(config, request);
    aiRequestPolicyService.settle(lease, config);
    const snapshot = aiRequestPolicyService.snapshot(config);
    expect(snapshot).toMatchObject({
      activeRequests: 0,
      tokenUsed: lease.estimatedTokens,
      usageMissingCount: 1,
      failedRequestCount: 1,
    });
  });

  it('conservatively accounts expired browser reservations exactly once', () => {
    const config = settings({ maxRequestsPerMinute: 10 });
    const now = Date.now();
    const lease = aiRequestPolicyService.begin(config, request, now);
    const first = aiRequestPolicyService.snapshot(config, now + 31 * 60_000);
    const replay = aiRequestPolicyService.snapshot(config, now + 32 * 60_000);
    expect(first).toMatchObject({
      activeRequests: 0,
      tokenUsed: lease.estimatedTokens,
      usageMissingCount: 1,
      expiredRequestCount: 1,
    });
    expect(replay.tokenUsed).toBe(first.tokenUsed);
    expect(replay.expiredRequestCount).toBe(1);
  });

  it('carries an active browser reservation across local midnight instead of dropping it', () => {
    const config = settings({ maxRequestsPerMinute: 10 });
    const beforeMidnight = new Date(2026, 6, 28, 23, 59, 50).getTime();
    const afterMidnight = beforeMidnight + 20_000;
    const lease = aiRequestPolicyService.begin(config, request, beforeMidnight);
    const active = aiRequestPolicyService.snapshot(config, afterMidnight);
    expect(active.activeRequests).toBe(1);
    expect(active.reservedTokens).toBe(lease.estimatedTokens);

    aiRequestPolicyService.settle(lease, config, undefined, afterMidnight + 1_000);
    const settled = aiRequestPolicyService.snapshot(config, afterMidnight + 2_000);
    expect(settled.activeRequests).toBe(0);
    expect(settled.tokenUsed).toBe(lease.estimatedTokens);
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
