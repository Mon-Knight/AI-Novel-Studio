import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creativeIntentService,
  isCreativeIntentConcurrencyConflict,
} from '../../services/ai-tasks/creativeIntentService';
import type { FreezeCreativeIntentCommandInput } from '../../types/creativeIntent';

function request(novelId = 'novel-a'): FreezeCreativeIntentCommandInput {
  return {
    novelId,
    expectedRevision: 0,
    statements: [{
      statementId: 'goal-1',
      kind: 'goal',
      knowledgeClass: 'author_explicit',
      value: '写一部长篇东方奇幻小说',
      confidence: 1,
      evidence: [],
      confirmation: { status: 'confirmed' },
    }],
  };
}

describe('creativeIntentService browser fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI__');
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Reflect.deleteProperty(window, '__TAURI_IPC__');
  });

  it('freezes, restores and idempotently replays r1 without cross-novel leakage', async () => {
    const input = request();
    const first = await creativeIntentService.freeze(input);
    expect(first.intent.revision).toBe(1);
    expect(first.intent.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.idempotentReplay).toBe(false);

    const restored = await creativeIntentService.getLatest('novel-a');
    expect(restored?.intent.contentHash).toBe(first.intent.contentHash);
    expect(await creativeIntentService.getLatest('novel-b')).toBeNull();

    const replay = await creativeIntentService.freeze(input);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.taskId).toBe(first.taskId);
  });

  it('creates an immutable r2 and rejects stale expected hashes', async () => {
    const first = await creativeIntentService.freeze(request());
    const stale = request();
    stale.expectedRevision = 1;
    stale.expectedContentHash = 'stale';
    await expect(creativeIntentService.freeze(stale)).rejects.toMatchObject({
      code: 'DOCUMENT_VERSION_CONFLICT',
    });

    const secondInput = request();
    secondInput.expectedRevision = 1;
    secondInput.expectedContentHash = first.intent.contentHash;
    secondInput.statements[0].value = '写一部长篇东方奇幻成长小说';
    const second = await creativeIntentService.freeze(secondInput);
    expect(second.intent.revision).toBe(2);
    expect(second.intent.parentIntentId).toBe(first.intent.intentId);
    expect(second.intent.contentHash).not.toBe(first.intent.contentHash);
  });

  it('rejects different content for the same deterministic revision operation', async () => {
    await creativeIntentService.freeze(request());
    const changed = request();
    changed.statements[0].value = '不同目标';
    await expect(creativeIntentService.freeze(changed)).rejects.toMatchObject({
      code: 'OPERATION_PAYLOAD_CONFLICT',
    });
  });

  it('keeps pending inferred preferences separate from author confirmation', async () => {
    const input = request();
    input.statements.push({
      statementId: 'preference-1',
      kind: 'preference',
      knowledgeClass: 'inferred_preference',
      value: '偏好克制感情线',
      confidence: 0.7,
      evidence: [{ evidenceId: 'evidence-1', sourceType: 'author_input', excerpt: '作者强调克制' }],
      confirmation: { status: 'pending' },
    });
    const result = await creativeIntentService.freeze(input);
    expect(result.intent.statements[1].confirmation).toEqual({ status: 'pending' });
  });

  it('does not report success when browser persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await expect(creativeIntentService.freeze(request())).rejects.toMatchObject({
      code: 'DATABASE_TRANSACTION_FAILED',
    });
    expect(await creativeIntentService.getLatest('novel-a')).toBeNull();
  });

  it('serializes concurrent browser CAS so different r1 payloads cannot both succeed', async () => {
    const first = request();
    const second = request();
    second.statements[0].value = '并发的不同目标';

    const results = await Promise.allSettled([
      creativeIntentService.freeze(first),
      creativeIntentService.freeze(second),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'OPERATION_PAYLOAD_CONFLICT' },
    });
    const latest = await creativeIntentService.getLatest('novel-a');
    expect(latest?.intent.revision).toBe(1);
  });

  it('rejects empty content and credential text at the service boundary', async () => {
    const empty = request();
    empty.statements[0].value = '   ';
    await expect(creativeIntentService.freeze(empty)).rejects.toMatchObject({
      code: 'OPERATION_PAYLOAD_CONFLICT',
    });

    const secret = request();
    secret.statements[0].value = 'Authorization: Bearer abcdefghijklmnop';
    await expect(creativeIntentService.freeze(secret)).rejects.toMatchObject({
      code: 'OPERATION_PAYLOAD_CONFLICT',
    });
    expect(localStorage.length).toBe(0);
  });

  it('fails closed instead of replacing a corrupted browser history with a new r1', async () => {
    const key = 'ai_novel_studio_creative_intents_v1_novel-a';
    localStorage.setItem(key, '{broken');
    await expect(creativeIntentService.getLatest('novel-a')).rejects.toMatchObject({
      code: 'ARTIFACT_VALIDATION_FAILED',
    });
    await expect(creativeIntentService.freeze(request())).rejects.toMatchObject({
      code: 'ARTIFACT_VALIDATION_FAILED',
    });
    expect(localStorage.getItem(key)).toBe('{broken');
  });

  it('distinguishes concurrency conflicts from local payload validation errors', () => {
    expect(isCreativeIntentConcurrencyConflict(Object.assign(
      new Error('创作意图已在其他窗口更新，请重新读取'),
      { code: 'DOCUMENT_VERSION_CONFLICT' },
    ))).toBe(true);
    expect(isCreativeIntentConcurrencyConflict(Object.assign(
      new Error('同一创作意图 revision 对应不同内容'),
      { code: 'OPERATION_PAYLOAD_CONFLICT' },
    ))).toBe(true);
    expect(isCreativeIntentConcurrencyConflict(Object.assign(
      new Error('创作意图 Snapshot 禁止包含 API Key 或授权信息'),
      { code: 'OPERATION_PAYLOAD_CONFLICT' },
    ))).toBe(false);
  });
});
