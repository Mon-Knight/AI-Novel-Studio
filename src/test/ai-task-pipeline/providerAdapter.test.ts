import { describe, expect, it, vi } from 'vitest';
import { providerAdapter, normalizeProviderError } from '../../services/ai-tasks/providerAdapter';
import { unifiedAiPipeline } from '../../services/ai-tasks/unifiedAiPipeline';
import { aiTaskStore } from '../../store/aiTaskStore';
import type { AiClient, AiGenerateResponse } from '../../types/ai';

describe('provider adapter', () => {
  it('returns only response metadata hashes and lengths', async () => {
    const client: AiClient = { generate: vi.fn().mockResolvedValue({ text: 'OK', tokenTotal: 3 }) };
    const result = await providerAdapter.execute(
      'attempt-success', client, { messages: [{ role: 'user', content: 'test' }] }, 1000,
    );
    expect(result.response.text).toBe('OK');
    expect(result.metadata).toEqual(expect.objectContaining({
      responseLength: 2,
      responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      tokenTotal: 3,
    }));
    expect(result.metadata).not.toHaveProperty('text');
  });

  it('normalizes retry decisions by code instead of localized message parsing downstream', () => {
    expect(normalizeProviderError(new Error('HTTP 429 Rate Limit'))).toEqual(expect.objectContaining({
      code: 'AI_PROVIDER_RATE_LIMITED', retryable: true,
    }));
    expect(normalizeProviderError(new Error('HTTP 500'))).toEqual(expect.objectContaining({
      code: 'AI_PROVIDER_SERVER_ERROR', retryable: true,
    }));
  });

  it('aborts a controllable provider request', async () => {
    const client: AiClient = {
      generate: vi.fn((request) => new Promise<AiGenerateResponse>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      })),
    };
    const pending = providerAdapter.execute(
      'attempt-cancel', client, { messages: [{ role: 'user', content: 'test' }] }, 5000,
    );
    expect(providerAdapter.cancel('attempt-cancel')).toBe(true);
    await expect(pending).rejects.toEqual(expect.objectContaining({
      code: 'AI_PROVIDER_CANCELLED', retryable: false,
    }));
  });

  it('classifies deadline aborts as retryable timeouts', async () => {
    const client: AiClient = {
      generate: vi.fn((request) => new Promise<AiGenerateResponse>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError')));
      })),
    };
    await expect(providerAdapter.execute(
      'attempt-timeout', client, { messages: [{ role: 'user', content: 'test' }] }, 1,
    )).rejects.toEqual(expect.objectContaining({
      code: 'AI_PROVIDER_TIMEOUT', retryable: true,
    }));
  });

  it('finalizes an aborted unified task as cancelled', async () => {
    let taskId = '';
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const client: AiClient = {
      generate: (request) => new Promise<AiGenerateResponse>((_resolve, reject) => {
        notifyStarted?.();
        request.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
      }),
    };
    const run = unifiedAiPipeline.run({
      taskType: 'connection_test',
      novelId: 'system',
      scopeType: 'system',
      inputSnapshot: { schemaVersion: 1, inputType: 'test', payloadJson: {} },
      contextSnapshot: {
        schemaVersion: 1, sourceManifestJson: {}, budgetJson: {}, compilerVersion: 'test',
      },
      constraintSnapshot: {
        schemaVersion: 1,
        payloadJson: {},
        promptTemplateId: 'test',
        promptTemplateVersion: '1',
        promptTemplateHash: 'hash',
        providerOptionsJson: {},
      },
      artifactType: 'generic_text',
      timeoutMs: 5000,
      client,
      request: { messages: [{ role: 'user', content: 'test' }] },
      onTaskCreated: (task) => { taskId = task.taskId; },
    });
    await started;
    await unifiedAiPipeline.cancel(taskId);
    await expect(run).rejects.toEqual(expect.objectContaining({ code: 'AI_PROVIDER_CANCELLED' }));
    expect(aiTaskStore.get(taskId)).toEqual(expect.objectContaining({ status: 'cancelled' }));
  });
});
