import { describe, expect, it } from 'vitest';
import { safeFailureMessage } from '../../features/co-creation/useCoCreationController';

describe('co-creation controller failure summaries', () => {
  it('normalizes and bounds provider errors by Unicode characters', () => {
    expect(safeFailureMessage('  provider\n  temporarily unavailable  '))
      .toBe('provider temporarily unavailable');

    const summary = safeFailureMessage('失败😀'.repeat(600));
    expect(Array.from(summary)).toHaveLength(900);
    expect(Array.from(summary).length).toBeLessThanOrEqual(1_000);
  });

  it.each([
    'provider error: api_key=sk-live-secret-value',
    'provider error: {"authorization":"Bearer abcdefghijklmnop"}',
    'request failed with Bearer abcdefghijklmnop',
    'prefixbearer abcdefghijklmnop',
    'request failed for sk-project-secret-token',
    'prefixsk-abcdefghijk',
    'access_token=top-secret-token',
    'https://writer:private-password@example.test/v1',
    '-----BEGIN PRIVATE KEY----- private material',
  ])('redacts credential-bearing details: %s', (message) => {
    const summary = safeFailureMessage(message);
    expect(summary).toBe('共创对话任务失败');
    expect(summary).not.toContain('secret');
    expect(summary).not.toContain('private-password');
  });

  it('uses a non-empty safe fallback for blank provider errors', () => {
    expect(safeFailureMessage('\u0000\n\t')).toBe('共创对话任务失败');
  });
});
