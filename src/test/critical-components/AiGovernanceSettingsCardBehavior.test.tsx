import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '../../types/ai';
import AiGovernanceSettingsCard from '../../components/settings/AiGovernanceSettingsCard';

const policy = vi.hoisted(() => ({
  snapshot: vi.fn(),
  snapshotCurrent: vi.fn(),
}));

vi.mock('../../services/ai/aiRequestPolicyService', () => ({
  aiRequestPolicyService: policy,
}));

function settings(patch: Partial<AiSettings> = {}): AiSettings {
  return {
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://provider.invalid/v1',
    apiKey: 'fixture-key',
    modelName: 'fixture-model',
    mockMode: false,
    maxRequestsPerMinute: 12,
    maxConcurrentAiRequests: 2,
    budgetWarningPercent: 80,
    ...patch,
  };
}

const emptySnapshot = {
  day: '2026-07-30',
  requestsLastMinute: 0,
  activeRequests: 0,
  tokenUsed: 0,
  reservedTokens: 0,
  costUsedUsd: 0,
  reservedCostUsd: 0,
  usageMissingCount: 0,
  warningPercent: 80,
  warning: false,
};

describe('AiGovernanceSettingsCard policy baseline', () => {
  beforeEach(() => {
    policy.snapshot.mockReset().mockReturnValue(emptySnapshot);
    policy.snapshotCurrent.mockReset().mockResolvedValue({
      ...emptySnapshot,
      policy: {
        revision: 4,
        policyHash: 'policy-4',
        maxRequestsPerMinute: 20,
        maxConcurrentRequests: 3,
        dailyTokenBudget: 100_000,
        dailyCostBudgetUsd: 5,
        inputPricePerMillionTokens: 1.25,
        outputPricePerMillionTokens: 2.5,
        warningPercent: 75,
      },
    });
  });

  it('hydrates authoritative policy once and refreshes only after an explicit save version', async () => {
    const onChange = vi.fn();
    const props = {
      settings: settings(),
      onChange,
      onSave: vi.fn(),
      refreshVersion: 0,
    };
    const view = render(<AiGovernanceSettingsCard {...props} />);

    await waitFor(() => expect(policy.snapshotCurrent).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      maxRequestsPerMinute: 20,
      maxConcurrentAiRequests: 3,
      dailyTokenBudget: 100_000,
      dailyCostBudgetUsd: 5,
      inputPricePerMillionTokens: 1.25,
      outputPricePerMillionTokens: 2.5,
      budgetWarningPercent: 75,
    });

    view.rerender(
      <AiGovernanceSettingsCard {...props} settings={settings({ maxRequestsPerMinute: 19 })} />,
    );
    expect(policy.snapshotCurrent).toHaveBeenCalledTimes(1);

    view.rerender(
      <AiGovernanceSettingsCard
        {...props}
        settings={settings({ maxRequestsPerMinute: 20 })}
        refreshVersion={1}
      />,
    );
    await waitFor(() => expect(policy.snapshotCurrent).toHaveBeenCalledTimes(2));
  });
});
